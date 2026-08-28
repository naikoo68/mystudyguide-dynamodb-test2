import mongoose from "../db/odm.js";
import crypto from "crypto";
import TestSeries from "../models/TestSeries.js";
import Question from "../models/Question.js";
import Attempt from "../models/Attempt.js";
import PublicAttempt from "../models/PublicAttempt.js";
import User from "../models/User.js";
import { isTestVisibleToUser, findAccessEntry, isSharedWithUser, hasActiveSubscription } from "../utils/accessControl.js";
import { notifyNewContent } from "../utils/notify.js";
import { ownerValue, ownerFilter } from "../utils/ownership.js";
import PracticeStream from "../models/PracticeStream.js";
import PracticeSubject from "../models/PracticeSubject.js";
import PracticeTopic from "../models/PracticeTopic.js";
import Quiz from "../models/Quiz.js";
import Session from "../models/Session.js";
import Tenant from "../models/Tenant.js";
import { duplicateQuestions } from "../utils/duplicateQuestions.js";
import { byNatural } from "../utils/naturalSort.js";
import { runUnscoped, runWithTenant } from "../utils/tenantContext.js";
import { clientBaseFromReq } from "../config/clientUrl.js";
import { renderQuestionImage } from "../config/socialImage.js";

// A caller may manage a test/question only within their own space: clients only
// their own owned items; admins only the shared (ownerless) platform items.
const canManage = (req, doc) =>
  req.user?.role === "client" ? String(doc?.owner || "") === String(req.user._id) : !doc?.owner;

// Fields copied when pulling a question from the bank into a test.
const COPY_FIELDS = [
  "text", "type", "options", "correct", "difficulty", "explanation",
  "optionExplanations", "columnA", "columnB", "tableRows", "assertion", "reason", "image",
];

// POST /api/tests/:id/populate  (admin)
// Body: { quizPlan:[{subject,count}], practicePlan:[{practiceSubject,count}] }
// Pulls N questions per subject from the Quiz bank and per practice-subject
// from the Practice bank, COPIES them into this test as new question docs.
export async function populateTest(req, res) {
  const test = await TestSeries.findById(req.params.id);
  if (!test) return res.status(404).json({ message: "Test not found" });
  // Admin works on platform tests; a client only on their own test.
  if (!canManage(req, test)) return res.status(403).json({ message: "Not your content" });

  const quizPlan = Array.isArray(req.body?.quizPlan) ? req.body.quizPlan : [];
  const practicePlan = Array.isArray(req.body?.practicePlan) ? req.body.practicePlan : [];
  const owner = ownerValue(req); // stamp copies with the caller's space
  const scope = ownerFilter(req); // { owner: null } for admin, { owner: <id> } for a client

  const oid = (v) => (v ? String(v) : null);
  const sample = async (match, count) => {
    const n = Math.max(0, Math.min(200, parseInt(count, 10) || 0));
    if (!n) return [];
    return Question.aggregate([{ $match: match }, { $sample: { size: n } }]);
  };
  const toCopy = (q, section) => {
    const doc = { testSeries: test._id, status: "published", owner };
    if (section) doc.section = section;
    for (const f of COPY_FIELDS) if (q[f] !== undefined) doc[f] = q[f];
    return doc;
  };

  const copies = [];
  const pulled = {}; // subject name -> how many were actually pulled (weightage)

  // From the Quiz bank — quiz questions carry a `subject` and no `testSeries`.
  for (const row of quizPlan) {
    const sid = oid(row?.subject);
    if (!sid) continue;
    const qs = await sample({ subject: sid, testSeries: { $exists: false }, ...scope }, row.count);
    copies.push(...qs.map((q) => toCopy(q, row.section)));
    if (row.section) pulled[row.section] = (pulled[row.section] || 0) + qs.length;
  }

  // From the Practice bank — practice questions live inside practice items
  // (TestSeries) under a practice subject, scoped to the caller's space.
  for (const row of practicePlan) {
    const psid = oid(row?.practiceSubject);
    if (!psid) continue;
    const items = await TestSeries.find({ practice: true, practiceSubject: psid, ...scope }).select("_id").lean();
    const ids = items.map((i) => i._id);
    if (!ids.length) continue;
    const qs = await sample({ testSeries: { $in: ids }, ...scope }, row.count);
    copies.push(...qs.map((q) => toCopy(q, row.section)));
    if (row.section) pulled[row.section] = (pulled[row.section] || 0) + qs.length;
  }

  if (copies.length) {
    const created = await Question.insertMany(copies);
    // Reflect the chosen weightage in the test's subject plan so the
    // "questions by subject" view stays accurate.
    const plan = [...(test.subjectPlan || [])];
    for (const [subject, count] of Object.entries(pulled)) {
      const existing = plan.find((p) => (p.subject || "") === subject);
      if (existing) existing.count = (existing.count || 0) + count;
      else plan.push({ subject, count });
    }
    await TestSeries.findByIdAndUpdate(test._id, {
      $push: { questions: { $each: created.map((c) => c._id) } },
      $set: { subjectPlan: plan },
    });
  }
  res.json({ inserted: copies.length });
}

// POST /api/tests/:id/auto-build  (admin/client)
// Body: { blueprint: [ { subject, section?, topic?, type?, difficulty?, count } ] }
// Automatically PICKS questions from the existing Quiz bank matching each row's
// subject (+ optional topic / type / difficulty) and COPIES them into this test
// as new question docs. This is the richer sibling of populateTest — instead of
// just "N per subject", each row can also constrain the topic, question type and
// difficulty, so an admin can compose a blueprint like:
//   "10 Easy MCQs from Physics", "5 Hard Matching from Biology › Genetics", …
export async function autoBuildTest(req, res) {
  const test = await TestSeries.findById(req.params.id);
  if (!test) return res.status(404).json({ message: "Test not found" });
  if (!canManage(req, test)) return res.status(403).json({ message: "Not your content" });

  const rows = Array.isArray(req.body?.blueprint) ? req.body.blueprint : [];
  if (!rows.length) return res.status(400).json({ message: "Add at least one blueprint row." });

  const owner = ownerValue(req);
  const scope = ownerFilter(req);
  const ALLOWED_TYPES = ["mcq", "numericalmcq", "matching", "statement", "pair", "pairselect", "image", "table", "assertion", "journal", "ledger", "rearrange", "diagram"];
  const DIFFS = ["Easy", "Medium", "Hard"];
  const oid = (v) => (v ? String(v) : null);

  const toCopy = (q, section) => {
    const doc = { testSeries: test._id, status: "published", owner };
    if (section) doc.section = section;
    for (const f of COPY_FIELDS) if (q[f] !== undefined) doc[f] = q[f];
    return doc;
  };

  const copies = [];
  const pulled = {};       // section name -> how many were pulled (weightage)
  const report = [];       // per-row: what was requested vs actually found
  const usedIds = [];      // library question ids already picked THIS run (avoid duplicates across rows)

  for (const row of rows) {
    const count = Math.max(0, Math.min(500, parseInt(row?.count, 10) || 0));
    const section = String(row?.section || "").trim();
    if (!count) continue;

    const match = { testSeries: { $exists: false }, ...scope };

    if (row?.practiceSubject) {
      // PRACTICE source (My Tests) — pull from the caller's own My Quiz items
      // under the chosen practice subject (+ optional practice topic). Practice
      // questions live INSIDE practice quiz items (TestSeries), so resolve those
      // item ids and match questions belonging to them.
      const psid = oid(row.practiceSubject);
      if (!psid) continue;
      const itemFilter = { practice: true, practiceKind: "quiz", practiceSubject: psid, ...scope };
      const ptid = row?.practiceTopic ? oid(row.practiceTopic) : null;
      if (ptid) itemFilter.practiceTopic = ptid;
      const items = await TestSeries.find(itemFilter).select("_id").lean();
      const itemIds = items.map((i) => i._id);
      if (!itemIds.length) { report.push({ subject: section || "(subject)", topic: row?.practiceTopic || null, type: row?.type || null, difficulty: row?.difficulty || null, requested: count, got: 0 }); continue; }
      delete match.testSeries; // practice questions DO have a testSeries (their quiz item)
      match.testSeries = { $in: itemIds };
    } else {
      // CONTENT quiz-bank source (admin Test Series) — match by content Subject.
      const sid = oid(row?.subject);
      if (!sid) continue;
      match.subject = sid;
      // Optional TOPIC filter — Question.topic is a free string, so resolve the
      // topic to its sessions and match questions in those sessions (reliable).
      if (row?.topic) {
        const tid = oid(row.topic);
        const sessions = tid ? await Session.find({ topic: tid }).select("_id").lean() : [];
        match.session = { $in: sessions.map((s) => s._id) }; // empty → matches nothing (correctly yields 0)
      }
    }

    if (usedIds.length) match._id = { $nin: usedIds };
    // Type filter: a single "type", or a "types" array (match any of them).
    if (Array.isArray(row?.types)) {
      const valid = row.types.filter((t) => ALLOWED_TYPES.includes(t));
      if (valid.length) match.type = { $in: valid };
    } else if (row?.type && ALLOWED_TYPES.includes(row.type)) {
      match.type = row.type;
    }
    if (row?.difficulty && DIFFS.includes(row.difficulty)) match.difficulty = row.difficulty;

    const qs = await Question.aggregate([{ $match: match }, { $sample: { size: count } }]);
    for (const q of qs) usedIds.push(q._id);
    copies.push(...qs.map((q) => toCopy(q, section)));
    if (section) pulled[section] = (pulled[section] || 0) + qs.length;
    report.push({
      subject: section || "(subject)",
      topic: row?.topic || row?.practiceTopic || null,
      type: row?.type || null,
      difficulty: row?.difficulty || null,
      requested: count,
      got: qs.length,
    });
  }

  if (copies.length) {
    const created = await Question.insertMany(copies);
    // Fill questions INTO the test's existing (predefined) subjects — do NOT
    // change a predefined subject's planned target, and only add a plan entry
    // for a section that wasn't already defined (so ad-hoc pulls still appear).
    const plan = [...(test.subjectPlan || [])];
    for (const section of Object.keys(pulled)) {
      if (!plan.find((p) => (p.subject || "") === section)) plan.push({ subject: section, count: pulled[section] });
    }
    await TestSeries.findByIdAndUpdate(test._id, {
      $push: { questions: { $each: created.map((c) => c._id) } },
      $set: { subjectPlan: plan },
    });
  }
  res.json({ inserted: copies.length, report });
}

// GET /api/tests  — list published tests visible to the requesting user
export async function listTests(req, res) {
  const { category, post, exam } = req.query;
  const filter = { status: "published", practice: { $ne: true } };
  if (category && category !== "All") filter.category = category;
  if (post) filter.post = post;
  if (exam) filter.exam = exam;
  const tests = await TestSeries.find(filter).sort("-createdAt").lean();
  const enrolled = new Set((req.user?.enrolledTests || []).map(String));
  const userId = req.user?._id;
  res.json(
    tests
      .filter((t) => isTestVisibleToUser(t, userId))
      .map((t) => {
        const entry = findAccessEntry(t, userId);
        return {
          ...t,
          questionCount: t.questions?.length || 0,
          enrolled: enrolled.has(String(t._id)),
          validUntil: entry?.validUntil || null, // this user's access expiry, if any
          questions: undefined,
          access: undefined, // never expose the full access list to students
        };
      })
  );
}

// GET /api/tests/admin/all  (admin) — every test regardless of status
export async function listAllTests(req, res) {
  const filter = { practice: { $ne: true } };
  if (req.query.post) filter.post = req.query.post;
  // Populate exam + post NAMES so the UI can group tests as Exam → Post → Test.
  const tests = await TestSeries.find(filter)
    .populate("exam", "name")
    .populate("post", "name")
    .sort("-createdAt")
    .lean();
  res.json(tests.map((t) => ({ ...t, questionCount: t.questions?.length || 0, questions: undefined })));
}

// GET /api/tests/:id  (questions without correct answers for taking the test)
export async function getTest(req, res) {
  const test = await TestSeries.findById(req.params.id)
    .populate({ path: "questions", select: "-correct -explanation -optionExplanations" })
    .populate("exam", "name")
    .populate("post", "name");
  if (!test) return res.status(404).json({ message: "Test not found" });
  // Admins can always open a test; the owning client can open their own item;
  // students must have access (and it must not be hidden or past validity).
  const isOwner = req.user?.role === "client" && String(test.owner || "") === String(req.user._id);
  // Additive master grant for practice content: myQuizAccess unlocks all My-Quiz
  // items, myTestAccess unlocks all My-Test items.
  const masterGrant = test.practice === true && ((test.practiceKind === "quiz" || test.practiceKind === "paper") ? req.user?.myQuizAccess === true : req.user?.myTestAccess === true);
  // FREE preview: the first My-Test in a subject is attemptable by anyone (so a
  // logged-in user without a subscription can still open it via this path).
  const freePreviewOk = await isFreePreviewTest(test);
  // An active student subscription unlocks every test-series.
  if (req.user?.role !== "admin" && !isOwner && !masterGrant && !freePreviewOk && !hasActiveSubscription(req.user) && !isTestVisibleToUser(test.toObject(), req.user?._id) && !isSharedWithUser(test, req.user?._id)) {
    return res.status(403).json({ message: "A subscription is needed for this test. The first test in each subject is free." });
  }
  const obj = test.toObject();
  delete obj.access; // hide access list from students
  res.json(obj); // subject/question/option shuffling is done per-attempt on the client
}

// The FIRST published My-Test in a subject (natural name order) is a FREE
// preview anyone may attempt without login or subscription — mirrors the free
// first quiz per topic. (Hoisted function declaration so getTest can use it.)
async function isFreePreviewTest(test) {
  if (!test || test.practice !== true || test.practiceKind !== "test" || !test.practiceSubject) return false;
  const siblings = (await TestSeries.find({
    practice: true, practiceKind: "test", status: "published",
    practiceSubject: test.practiceSubject, owner: test.owner || null,
  }).select("_id name").lean()).sort(byNatural("name"));
  return siblings.length > 0 && String(siblings[0]._id) === String(test._id);
}

// GET /api/tests/:id/free — no-auth load of the FREE first test of a subject
// (exam-style, answers stripped). Any non-free test needs the normal auth path.
export async function getFreeTest(req, res) {
  const test = await TestSeries.findById(req.params.id)
    .populate({ path: "questions", select: "-correct -explanation -optionExplanations" });
  if (!test) return res.status(404).json({ message: "Test not found" });
  if (!(await isFreePreviewTest(test))) {
    return res.status(req.user ? 403 : 401).json({ message: "A subscription is needed for this test. The first test in each subject is free." });
  }
  const obj = test.toObject();
  delete obj.access;
  res.json(obj);
}

// POST /api/tests/:id/free-submit — grade the FREE first test for a guest. No
// account required (nothing stored against a user); only the free-preview test.
export async function submitFreeTest(req, res) {
  const { answers = {}, timeTaken = 0 } = req.body;
  const test = await TestSeries.findById(req.params.id).populate("questions");
  if (!test) return res.status(404).json({ message: "Test not found" });
  if (!(await isFreePreviewTest(test))) {
    return res.status(req.user ? 403 : 401).json({ message: "A subscription is needed for this test. The first test in each subject is free." });
  }
  const g = gradeSubmission(test, answers);
  await TestSeries.findByIdAndUpdate(test._id, { $inc: { attempts: 1 } });
  PublicAttempt.create({
    testSeries: test._id,
    total: g.total, attempted: g.attempted, correct: g.correct, incorrect: g.incorrect,
    skipped: g.skipped, score: g.score, maxScore: g.maxScore, percentage: g.percentage,
    timeTaken: Number(timeTaken) || 0,
  }).catch(() => {});
  res.status(201).json({
    total: g.total, attempted: g.attempted, skipped: g.skipped, correct: g.correct,
    incorrect: g.incorrect, score: g.score, maxScore: g.maxScore, percentage: g.percentage,
    timeTaken, review: g.review,
  });
}

// GET /api/tests/:id/access  (admin) — all users with their access to this test
export async function getTestAccess(req, res) {
  const test = await TestSeries.findById(req.params.id).lean();
  if (!test) return res.status(404).json({ message: "Test not found" });
  const users = await User.find({ role: "student" }).select("name email").sort("name").lean();
  const byUser = new Map((test.access || []).map((a) => [String(a.user), a]));
  res.json({
    testId: test._id,
    name: test.name,
    visibleToAll: test.visibleToAll === true,
    users: users.map((u) => {
      const entry = byUser.get(String(u._id));
      return {
        _id: u._id,
        name: u.name,
        email: u.email,
        // No entry → follows the test default (hidden unless visibleToAll).
        visible: entry ? entry.visible : test.visibleToAll === true,
        validUntil: entry?.validUntil || null,
      };
    }),
  });
}

// PUT /api/tests/:id/access  (admin) — replace the access list for this test
export async function updateTestAccess(req, res) {
  const test = await TestSeries.findById(req.params.id);
  if (!test) return res.status(404).json({ message: "Test not found" });

  if (typeof req.body.visibleToAll === "boolean") test.visibleToAll = req.body.visibleToAll;
  const globalVisible = test.visibleToAll === true;

  if (Array.isArray(req.body.users)) {
    // Keep only entries that DIFFER from the test's default state (to stay
    // compact). When the test is private, that means storing the granted
    // users; when public, storing the hidden ones. Time-limits are always kept.
    test.access = req.body.users
      .filter((u) => u && u.user)
      .map((u) => ({
        user: u.user,
        visible: u.visible !== false,
        validUntil: u.validUntil ? new Date(u.validUntil) : null,
      }))
      .filter((e) => !(e.visible === globalVisible && !e.validUntil));
  }

  await test.save();
  res.json({ message: "Access updated", access: test.access, visibleToAll: test.visibleToAll });
}

// POST /api/tests  (admin)
export async function createTest(req, res) {
  const test = await TestSeries.create(req.body);
  notifyNewContent("test", test); // fire-and-forget (respects admin toggle)
  res.status(201).json(test);
}

// PUT /api/tests/:id  (admin or owning client)
export async function updateTest(req, res) {
  const existing = await TestSeries.findById(req.params.id);
  if (!existing) return res.status(404).json({ message: "Test not found" });
  if (!canManage(req, existing)) return res.status(403).json({ message: "Not your content" });
  const patch = { ...req.body };
  delete patch.owner; // ownership is immutable from the client
  const test = await TestSeries.findByIdAndUpdate(req.params.id, patch, { new: true });
  res.json(test);
}

// PATCH /api/tests/:id/publish  (admin) — toggle publish/unpublish
export async function togglePublish(req, res) {
  const test = await TestSeries.findById(req.params.id);
  if (!test) return res.status(404).json({ message: "Test not found" });
  test.status = test.status === "published" ? "draft" : "published";
  await test.save();
  res.json(test);
}

// DELETE /api/tests/:id  (admin or owning client)
export async function deleteTest(req, res) {
  const test = await TestSeries.findById(req.params.id);
  if (!test) return res.status(404).json({ message: "Test not found" });
  if (!canManage(req, test)) return res.status(403).json({ message: "Not your content" });
  // Also remove the item's questions so nothing is orphaned.
  if (test.questions?.length) await Question.deleteMany({ _id: { $in: test.questions } });
  await TestSeries.findByIdAndDelete(req.params.id);
  res.json({ message: "Test deleted" });
}

// Grade a populated test against submitted answers. Returns the stored
// `responses` array + a rich `review` (with correct answers) and summary stats.
// Shared by the authenticated submit, the public (no-login) submit, and the CBT
// online-exam submit (see cbtController).
export function gradeSubmission(test, answers = {}) {
  const total = test.questions.length;
  let correct = 0;
  let attempted = 0;

  const responses = [];
  const review = test.questions.map((q) => {
    const raw = answers[q._id];
    const provided = raw !== undefined && raw !== null;
    // Both MCQ and matching are answered by picking one option index.
    const isCorrect = provided && raw === q.correct;
    if (provided) attempted += 1;
    if (isCorrect) correct += 1;
    responses.push({ question: q._id, chosen: provided ? raw : null, isCorrect });
    return {
      _id: q._id,
      type: q.type,
      section: q.section, // so the review can mirror the attempt's subject order
      text: q.text,
      image: q.image,
      options: q.options,
      columnA: q.columnA,
      columnB: q.columnB,
      tableRows: q.tableRows,
      assertion: q.assertion,
      reason: q.reason,
      correct: q.correct,
      explanation: q.explanation,
      optionExplanations: q.optionExplanations,
      chosen: provided ? raw : null,
      isCorrect,
    };
  });

  const skipped = total - attempted;
  const incorrect = attempted - correct;
  // Marks per question: use the test's configured total marks when set,
  // otherwise default to 1 mark per question. Practice quizzes leave `marks`
  // at 0 — previously that made every correct answer worth nothing while
  // negative marking still applied, producing a negative score out of 0
  // (e.g. "-1/0"). Defaulting to 1 mark/question makes the score sensible.
  const perQuestion = test.marks > 0 && total ? test.marks / total : 1;
  const round2 = (n) => Math.round(n * 100) / 100; // negative marking (e.g. 0.25) yields fractional scores
  const maxScore = round2(perQuestion * total);
  const score = round2(correct * perQuestion - incorrect * (test.negativeMarking || 0));
  const percentage = total ? Math.round((correct / total) * 100) : 0;

  return { responses, review, total, attempted, skipped, correct, incorrect, score, maxScore, percentage };
}

// POST /api/tests/:id/submit — grade a submitted test attempt (logged-in user)
export async function submitTest(req, res) {
  const { answers = {}, timeTaken = 0 } = req.body; // answers: { questionId: optionIndex }
  const test = await TestSeries.findById(req.params.id).populate("questions");
  if (!test) return res.status(404).json({ message: "Test not found" });

  const g = gradeSubmission(test, answers);

  const attempt = await Attempt.create({
    user: req.user._id,
    type: "test",
    testSeries: test._id,
    responses: g.responses,
    total: g.total,
    attempted: g.attempted,
    correct: g.correct,
    incorrect: g.incorrect,
    score: g.score,
    maxScore: g.maxScore,
    percentage: g.percentage,
    timeTaken,
  });

  await TestSeries.findByIdAndUpdate(test._id, { $inc: { attempts: 1 } });
  // Return the graded summary + full review (with correct answers) for the UI.
  res.status(201).json({
    _id: attempt._id,
    total: g.total,
    attempted: g.attempted,
    skipped: g.skipped,
    correct: g.correct,
    incorrect: g.incorrect,
    score: g.score,
    maxScore: g.maxScore,
    percentage: g.percentage,
    timeTaken,
    review: g.review,
  });
}

/* ---------------- Public share link (no account required) ---------------- */

// PATCH /api/tests/:id/public-link  (admin or owning client) — turn the public
// share link on/off. Enabling generates a token (once) that never changes so an
// existing link keeps working; disabling just flips the flag (token is kept so
// re-enabling restores the same link).
export async function togglePublicLink(req, res) {
  const test = await TestSeries.findById(req.params.id);
  if (!test) return res.status(404).json({ message: "Test not found" });
  if (!canManage(req, test)) return res.status(403).json({ message: "Not your content" });

  const enable = req.body?.enable !== false; // default: enable
  if (enable) {
    test.publicShare = true;
    if (!test.publicToken) test.publicToken = crypto.randomBytes(12).toString("hex");
  } else {
    test.publicShare = false;
  }

  // Optional expiry. An explicit value sets it; null/"" clears it (never
  // expires). Only touched when the key is present in the request.
  if ("expiresAt" in (req.body || {})) {
    if (!req.body.expiresAt) {
      test.publicExpiresAt = null;
    } else {
      const d = new Date(req.body.expiresAt);
      if (isNaN(d.getTime())) return res.status(400).json({ message: "Invalid expiry date" });
      test.publicExpiresAt = d;
    }
  }

  // Turning a link back ON must make it live again: if the (old or supplied)
  // expiry is already in the PAST, clear it — otherwise re-enabling would
  // immediately report the link as "expired". A future expiry is kept as-is.
  if (enable && test.publicExpiresAt && new Date(test.publicExpiresAt).getTime() < Date.now()) {
    test.publicExpiresAt = null;
  }

  await test.save();
  res.json({ publicShare: test.publicShare, publicToken: test.publicToken, publicExpiresAt: test.publicExpiresAt });
}

// Whether a public link is currently usable (shared, and not past its expiry).
function publicLinkExpired(test) {
  return test.publicExpiresAt && new Date(test.publicExpiresAt).getTime() < Date.now();
}

// GET /api/tests/public/:token — fetch a publicly shared test for taking. No
// auth required. Correct answers/explanations are stripped (like getTest).
export async function getPublicTest(req, res) {
  // The share token is globally unique and a public visitor has no reliable
  // tenant context — so look up UNSCOPED so the link works for ANY institute
  // (otherwise a tenant-scoped query returns "invalid" for another institute's
  // quiz). Safe: a random 12-byte token isn't guessable across tenants.
  const test = await runUnscoped(() =>
    TestSeries.findOne({ publicToken: req.params.token, publicShare: true }).populate("questions"));
  if (!test) return res.status(404).json({ message: "This test link is invalid or public sharing was turned off." });
  if (publicLinkExpired(test)) return res.status(403).json({ message: "This public test link has expired." });
  const obj = test.toObject();
  delete obj.access; // never expose the access list
  delete obj.publicToken; // already in the URL; no need to echo
  // An exam-style TEST hides the answers (anti-cheat). A shared QUIZ is played
  // reveal-style (the correct option + explanation show after each tap, exactly
  // like a student's My Quiz), so it KEEPS answers/explanations.
  if (obj.practiceKind !== "quiz" && obj.practiceKind !== "paper") {
    obj.questions = (obj.questions || []).map((q) => {
      const { correct, explanation, optionExplanations, ...rest } = q;
      return rest;
    });
  }
  res.json(obj);
}

// POST /api/tests/public/:token/submit — grade a public (guest) attempt. No
// account required, so nothing is stored against a user — the graded result is
// simply returned. The test's attempt counter is still incremented.
export async function submitPublicTest(req, res) {
  const { answers = {}, timeTaken = 0 } = req.body;
  const test = await runUnscoped(() =>
    TestSeries.findOne({ publicToken: req.params.token, publicShare: true }).populate("questions"));
  if (!test) return res.status(404).json({ message: "This test link is invalid or public sharing was turned off." });
  if (publicLinkExpired(test)) return res.status(403).json({ message: "This public test link has expired." });

  const g = gradeSubmission(test, answers);
  await runUnscoped(() => TestSeries.findByIdAndUpdate(test._id, { $inc: { attempts: 1 } }));
  // Record the anonymous completion so the admin can track shared-link usage.
  runUnscoped(() => PublicAttempt.create({
    testSeries: test._id,
    total: g.total, attempted: g.attempted, correct: g.correct, incorrect: g.incorrect,
    skipped: g.skipped, score: g.score, maxScore: g.maxScore, percentage: g.percentage,
    timeTaken: Number(timeTaken) || 0,
  }).catch(() => {})); // never let tracking break the taker's result
  res.status(201).json({
    total: g.total,
    attempted: g.attempted,
    skipped: g.skipped,
    correct: g.correct,
    incorrect: g.incorrect,
    score: g.score,
    maxScore: g.maxScore,
    percentage: g.percentage,
    timeTaken,
    review: g.review,
  });
}

// POST /api/tests/public/:token/view — count that someone OPENED the public
// link. No auth. The client calls this once per browser (localStorage-guarded)
// so it approximates unique opens rather than every page refresh. (This is the
// admin's reach/impressions metric; the user-facing "views" are counted by
// registerView on every open instead.)
export async function registerPublicView(req, res) {
  const test = await runUnscoped(() =>
    TestSeries.findOne({ publicToken: req.params.token, publicShare: true }).select("_id publicShare publicExpiresAt"));
  if (!test) return res.status(404).json({ message: "This test link is invalid or public sharing was turned off." });
  if (publicLinkExpired(test)) return res.status(403).json({ message: "This public test link has expired." });
  await runUnscoped(() => TestSeries.updateOne({ _id: test._id }, { $inc: { publicViews: 1 } }));
  res.json({ ok: true });
}

// POST /api/tests/:id/view — count a VISIT: every time someone opens this
// quiz/test to play it (any audience — student, client, free preview, or the
// public shared link). This is a TOTAL views/visits counter (NOT unique) so it
// climbs on every open. It also bumps each question's own views total. Returns
// the new quiz views count so the UI can show it live. optionalAuth: guests too.
export async function registerView(req, res) {
  const found = await runUnscoped(() => TestSeries.findById(req.params.id).select("_id questions"));
  if (!found) return res.status(404).json({ message: "Not found" });
  const ids = (found.questions || []).map((q) => (q && q._id) ? q._id : q).filter(Boolean);
  const updated = await runUnscoped(async () => {
    if (ids.length) await Question.updateMany({ _id: { $in: ids } }, { $inc: { views: 1 } });
    return TestSeries.findByIdAndUpdate(found._id, { $inc: { views: 1 } }, { new: true }).select("views");
  });
  res.json({ ok: true, views: updated?.views || 0 });
}

/* ------- Rich link preview for social apps (WhatsApp / Facebook / etc.) ------- */
// Social crawlers do NOT run JavaScript, so the SPA's static Open Graph card is
// the ONLY thing they ever see — which is why every shared quiz/test showed the
// same generic "My Study Guide" preview. This endpoint (GET /s/:token) instead
// returns REAL HTML whose og: tags describe THIS quiz/test — its subject, topic,
// name (e.g. "Quiz 1") and its FIRST question — so the WhatsApp/Facebook preview
// is meaningful. A human who taps the link is then redirected on to the actual
// in-app player (with the institute's ?t= slug so the right tenant loads).

// Escape a string for safe insertion into HTML text/attributes.
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Turn a question stem into a clean one-line preview: strip $…$ math delimiters,
// **bold** markers and stray LaTeX, collapse whitespace, then trim to length.
function stemPreview(t, max = 170) {
  let s = String(t ?? "")
    .replace(/\$\$?/g, "")
    .replace(/\*\*/g, "")
    .replace(/\\[a-zA-Z]+\s?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + "…";
  return s;
}

// Resolve the SITE base URL to use for the preview image and the human redirect.
// A /s/:token link is shared on the site's OWN domain and proxied to this API by
// Vercel, which forwards the original site host in x-forwarded-host (different
// from this API's own host). Using it keeps everything on the SAME site the
// visitor came from — the main app OR an institute's custom domain — with NO
// server env required. Falls back to CLIENT_URL, then the request origin.
function siteBaseFromReq(req) {
  const first = (h) => String(h || "").split(",")[0].trim();
  const xfh = first(req.headers["x-forwarded-host"]);
  const proto = first(req.headers["x-forwarded-proto"]) || "https";
  const host = first(req.headers.host);
  if (xfh && xfh !== host && !/^(localhost|127\.)/.test(xfh)) return `${proto}://${xfh}`.replace(/\/$/, "");
  const env = String(process.env.CLIENT_URL || "").replace(/\/$/, "");
  if (env) return env;
  return (clientBaseFromReq(req) || "").replace(/\/$/, "");
}

// GET /s/:token — server-rendered preview + redirect for a shared quiz/test.
export async function shareTestPreview(req, res) {
  const token = String(req.params.token || "");
  const clientBase = siteBaseFromReq(req);

  // The public token is globally unique, and this endpoint is hit by crawlers
  // with NO tenant header — so look the item up UNSCOPED to find it in ANY
  // institute. (Safe: a random 12-byte token isn't guessable across tenants.)
  let test = null;
  try {
    test = await runUnscoped(() =>
      TestSeries.findOne({ publicToken: token, publicShare: true })
        // Include the fields the first-question preview card needs (NOT "correct"
        // — the preview must never reveal the answer).
        .populate("questions", "text options type difficulty columnA columnB assertion reason")
        .populate("practiceSubject", "name")
        .populate("practiceTopic", "name")
        .populate("practiceStream", "name")
        .lean()
    );
  } catch { /* fall through to the generic redirect below */ }

  const expired = test && test.publicExpiresAt && new Date(test.publicExpiresAt).getTime() < Date.now();
  // Invalid / disabled / expired → send the visitor to the site home. Relative
  // "/" resolves to the site the link was opened on (via the transparent proxy).
  if (!test || expired) return res.redirect(302, "/");

  const tenant = test.tenantId
    ? await runUnscoped(() => Tenant.findById(test.tenantId).select("slug customDomain name isDefault").lean()).catch(() => null)
    : null;

  const kind = test.practiceKind === "quiz" ? "quiz" : "test";
  const kindLabel = kind === "quiz" ? "Quiz" : (test.practiceKind === "paper" ? "Paper" : "Test");
  const subject = test.practiceSubject?.name || test.practiceStream?.name || "";
  const topic = test.practiceTopic?.name || "";
  const count = Array.isArray(test.questions) ? test.questions.length : 0;
  const firstQ = count ? stemPreview(test.questions[0]?.text) : "";

  const crumb = [subject, topic].filter(Boolean).join(" › ");
  const title = [crumb, test.name].filter(Boolean).join(" — ") || `${kindLabel} — My Study Guide`;
  const descBits = [];
  if (count) descBits.push(`${kindLabel} · ${count} question${count === 1 ? "" : "s"}`);
  if (firstQ) descBits.push(`Q1: ${firstQ}`);
  const description = descBits.join(" — ") || "Tap to start on My Study Guide.";
  const siteName = tenant?.name || "My Study Guide";

  // Preview image: render a card of the FIRST question (so the card isn't the
  // generic logo). Rendering uploads to Cloudinary, so cache the URL on the item
  // and only re-render when the first question changes. Falls back to the
  // generic og-image when Cloudinary isn't configured or a render fails.
  let image = `${clientBase}/og-image.png`;
  const firstQObj = count ? test.questions[0] : null;
  if (firstQObj?.text) {
    // "v7" busts previously-cached images (landscape 1.91:1 card Facebook never
    // crops — full question always visible).
    const key = crypto.createHash("sha1").update(`v7|${test._id}|${firstQObj.text}`).digest("hex");
    if (test.publicPreviewImage && test.publicPreviewKey === key) {
      image = test.publicPreviewImage; // reuse the cached render
    } else {
      try {
        // Render within the item's OWN tenant context so the card uses that
        // institute's site name / brand colour.
        const rendered = await runWithTenant(
          { tenantId: test.tenantId || null, bypass: !test.tenantId },
          () => renderQuestionImage(firstQObj, {
            preview: true,
            subtitle: crumb,
            footer: `${kindLabel}${count ? ` · ${count} question${count === 1 ? "" : "s"}` : ""} · Tap to start`,
            hideCta: true,
            includeAnswer: false,
          })
        );
        if (rendered?.url) {
          image = rendered.url;
          // Cache for next time (best-effort; don't block the response on it).
          runUnscoped(() => TestSeries.updateOne(
            { _id: test._id },
            { $set: { publicPreviewImage: rendered.url, publicPreviewKey: key } }
          )).catch(() => {});
        }
      } catch { /* keep the generic fallback image */ }
    }
  }

  // Where a human should land — the real SPA player on the SAME site they came
  // from. Include the institute slug (?t=) for non-default tenants so the app
  // resolves the right institute (harmless on a custom domain, which resolves by
  // host anyway).
  // Institute slug as a QUERY param (?t=) so the app resolves the right tenant.
  const tQuery = (tenant && !tenant.isDefault && tenant.slug) ? `?t=${encodeURIComponent(tenant.slug)}` : "";
  // RELATIVE target for the human redirect: because Vercel serves this page
  // transparently under the site's own domain, a relative URL always resolves
  // to the correct site — even if we couldn't determine the absolute base. The
  // absolute form is used only for crawler metadata (og:url / canonical).
  // Path-based route (clean URL) with the tenant slug carried as a query string.
  const targetRel = `/public/${kind}/${token}${tQuery}`;

  // The canonical URL for crawlers must be THIS share page (which returns the
  // rich preview), NOT the SPA player. Facebook re-reads og:url as the object's
  // true address — if it pointed at the app it would show the app's GENERIC card
  // instead of our per-quiz preview (WhatsApp doesn't re-read, which is why it
  // worked there but Facebook didn't).
  const shareUrl = `${clientBase}/s/${token}`;

  // Only real browsers get auto-redirected to the player. A crawler must NOT be
  // redirected — otherwise it follows through to the SPA and reads its generic
  // card. This makes the rich preview work everywhere (Facebook, Telegram,
  // LinkedIn, Discord, Slack, X/Twitter, iMessage, …), not just WhatsApp.
  const ua = String(req.headers["user-agent"] || "");
  const isCrawler = /facebookexternalhit|facebot|twitterbot|whatsapp|telegrambot|linkedinbot|slackbot|discordbot|googlebot|bingbot|embedly|quora link preview|pinterest|redditbot|applebot|vkshare|w3c_validator|iframely|skypeuripreview|viber|line|tumblr|flipboard|nuzzel|bitlybot|bot|crawler|spider|preview/i.test(ua);
  const redirectTags = isCrawler
    ? ""
    : `<meta http-equiv="refresh" content="0; url=${escHtml(targetRel)}">\n<script>location.replace(${JSON.stringify(targetRel)});</script>`;

  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "public, max-age=300"); // let crawlers cache briefly
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escHtml(siteName)}">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(description)}">
<meta property="og:image" content="${escHtml(image)}">
<meta property="og:image:alt" content="${escHtml(title)}">
<meta property="og:url" content="${escHtml(shareUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(description)}">
<meta name="twitter:image" content="${escHtml(image)}">
<link rel="canonical" href="${escHtml(shareUrl)}">
${redirectTags}
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0b1220;color:#e5e7eb;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px}a{color:#93c5fd}</style>
</head>
<body>
<div>
<h1>${escHtml(title)}</h1>
<p>${escHtml(description)}</p>
<p>Opening… if it doesn't, <a href="${escHtml(targetRel)}">tap here to start</a>.</p>
</div>
</body>
</html>`);
}

// Turn OFF any public share link whose expiry has passed, so expired links drop
// off the tracker automatically and can no longer be reopened. (getPublicTest
// already blocks expired links from being taken.)
export async function disableExpiredPublicLinks() {
  try {
    await TestSeries.updateMany(
      { publicShare: true, publicExpiresAt: { $ne: null, $lte: new Date() } },
      { $set: { publicShare: false } }
    );
  } catch { /* ignore transient errors — the next sweep retries */ }
}
// Background sweep every 10 minutes (also runs lazily when the tracker loads).
setInterval(disableExpiredPublicLinks, 10 * 60 * 1000).unref();

// GET /api/tests/admin/shared  (admin) — every quiz/test with a public share
// link, plus how many people have opened / completed it, for the tracker.
export async function listSharedTests(req, res) {
  await disableExpiredPublicLinks(); // clear expired links before listing
  const tests = await TestSeries.find({ publicShare: true, ...ownerFilter(req) })
    .populate("exam", "name")
    .populate("post", "name")
    .populate("practiceStream", "name")
    .populate("practiceSubject", "name")
    .sort("-updatedAt")
    .lean();
  const ids = tests.map((t) => t._id);
  const counts = await PublicAttempt.aggregate([
    { $match: { testSeries: { $in: ids } } },
    { $group: { _id: "$testSeries", count: { $sum: 1 }, avg: { $avg: "$percentage" }, last: { $max: "$createdAt" } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c]));
  res.json(
    tests.map((t) => {
      const c = byId.get(String(t._id));
      return {
        _id: t._id,
        name: t.name,
        kind: t.practice ? (t.practiceKind === "quiz" ? "My Quiz" : "My Test") : "Test Series",
        publicToken: t.publicToken,
        publicShare: t.publicShare,
        publicExpiresAt: t.publicExpiresAt || null,
        questionCount: t.questions?.length || 0,
        context: t.practice
          ? [t.practiceStream?.name, t.practiceSubject?.name].filter(Boolean).join(" › ")
          : [t.exam?.name, t.post?.name].filter(Boolean).join(" › "),
        opens: t.publicViews || 0,
        completions: c?.count || 0,
        avgPercentage: c?.avg != null ? Math.round(c.avg) : null,
        lastCompletedAt: c?.last || null,
      };
    })
  );
}

// GET /api/tests/:id/public-attempts  (admin) — the anonymous completions for
// one shared quiz/test (score / % / time / when), newest first.
export async function listPublicAttempts(req, res) {
  const test = await TestSeries.findOne({ _id: req.params.id, ...ownerFilter(req) }).select("name").lean();
  if (!test) return res.status(404).json({ message: "Not found (or not your content)." });
  const attempts = await PublicAttempt.find({ testSeries: req.params.id }).sort("-createdAt").limit(500).lean();
  res.json({
    name: test.name,
    total: attempts.length,
    attempts: attempts.map((a) => ({
      score: a.score, maxScore: a.maxScore, percentage: a.percentage,
      correct: a.correct, incorrect: a.incorrect, attempted: a.attempted, totalQ: a.total,
      timeTaken: a.timeTaken, at: a.createdAt,
    })),
  });
}

/* ---------------- Test questions (admin) ---------------- */

// ---- Migration (ADMIN only, on platform / own content) ----

// PATCH /api/tests/:id/to-test-series — My Test (practice) → platform Test Series.
export async function toTestSeries(req, res) {
  const item = await TestSeries.findOne({ _id: req.params.id, owner: null });
  if (!item || !item.practice || item.practiceKind !== "test") return res.status(404).json({ message: "My Test not found" });
  const { exam, post, category, copy } = req.body;
  if (!exam || !post) return res.status(400).json({ message: "Choose an exam and post." });

  if (copy) {
    const newTest = await TestSeries.create({
      name: `${item.name} (copy)`, owner: null, practice: false,
      exam, post, category: category || item.category || "Full-Length",
      duration: item.duration, marks: item.marks, difficulty: item.difficulty,
      status: item.status || "draft", visibleToAll: item.visibleToAll ?? false,
    });
    const created = await duplicateQuestions({ testSeries: item._id }, { testSeries: newTest._id, owner: null });
    if (created.length) await TestSeries.findByIdAndUpdate(newTest._id, { $push: { questions: { $each: created.map((c) => c._id) } } });
    return res.json({ message: "Copied to Test Series", _id: newTest._id });
  }

  item.practice = false;
  item.practiceKind = undefined;
  item.practiceStream = undefined;
  item.practiceSubject = undefined;
  item.practiceTopic = undefined;
  item.exam = exam;
  item.post = post;
  if (category) item.category = category;
  await item.save();
  res.json({ message: "Migrated to Test Series", _id: item._id });
}

// PATCH /api/tests/:id/to-my-test — platform Test Series → My Test (practice).
export async function toMyTest(req, res) {
  const test = await TestSeries.findOne({ _id: req.params.id, owner: null });
  if (!test || test.practice) return res.status(404).json({ message: "Test Series not found" });
  const stream = await PracticeStream.findOne({ _id: req.body.practiceStream, owner: null });
  const subject = await PracticeSubject.findOne({ _id: req.body.practiceSubject, owner: null });
  if (!stream || !subject) return res.status(400).json({ message: "Choose a My Test stream and subject." });

  if (req.body.copy) {
    const newItem = await TestSeries.create({
      name: `${test.name} (copy)`, owner: null, practice: true, practiceKind: "test",
      practiceStream: stream._id, practiceSubject: subject._id,
      category: "Full-Length", duration: test.duration, marks: test.marks, difficulty: test.difficulty,
      status: "published", visibleToAll: false,
    });
    const created = await duplicateQuestions({ testSeries: test._id }, { testSeries: newItem._id, owner: null });
    if (created.length) await TestSeries.findByIdAndUpdate(newItem._id, { $push: { questions: { $each: created.map((c) => c._id) } } });
    return res.json({ message: "Copied to My Test", _id: newItem._id });
  }

  test.practice = true;
  test.practiceKind = "test";
  test.practiceStream = stream._id;
  test.practiceSubject = subject._id;
  test.practiceTopic = undefined;
  test.exam = undefined;
  test.post = undefined;
  test.visibleToAll = false;
  await test.save();
  res.json({ message: "Migrated to My Test", _id: test._id });
}

// PATCH /api/tests/:id/move-series — move a platform Test Series to another Exam/Post.
export async function moveTestSeries(req, res) {
  const test = await TestSeries.findOne({ _id: req.params.id, owner: null, practice: { $ne: true } });
  if (!test) return res.status(404).json({ message: "Test Series not found" });
  const { exam, post, copy } = req.body;
  if (!exam || !post) return res.status(400).json({ message: "Choose an exam and post." });

  if (copy) {
    const newTest = await TestSeries.create({
      name: `${test.name} (copy)`, owner: null, practice: false, exam, post,
      category: test.category || "Full-Length", duration: test.duration, marks: test.marks, difficulty: test.difficulty,
      status: test.status || "draft", visibleToAll: test.visibleToAll ?? false,
    });
    const created = await duplicateQuestions({ testSeries: test._id }, { testSeries: newTest._id, owner: null });
    if (created.length) await TestSeries.findByIdAndUpdate(newTest._id, { $push: { questions: { $each: created.map((c) => c._id) } } });
    return res.json({ message: "Copied", _id: newTest._id });
  }

  test.exam = exam;
  test.post = post;
  await test.save();
  res.json({ message: "Migrated", _id: test._id });
}

// PATCH /api/tests/:id/to-quiz — My Quiz (practice) → platform Quiz under a Session.
export async function toQuiz(req, res) {
  const item = await TestSeries.findOne({ _id: req.params.id, owner: null, practice: true, practiceKind: "quiz" });
  if (!item) return res.status(404).json({ message: "My Quiz not found" });
  const session = await Session.findById(req.body.session);
  if (!session) return res.status(400).json({ message: "Choose a destination session." });
  const index = await Quiz.countDocuments({ session: session._id });
  const quiz = await Quiz.create({ title: item.name, subject: session.subject, session: session._id, index });

  if (req.body.copy) {
    await duplicateQuestions({ testSeries: item._id }, { quiz: quiz._id, subject: session.subject, session: session._id });
    return res.json({ message: "Copied to Quiz", _id: quiz._id });
  }

  await Question.updateMany(
    { testSeries: item._id },
    { $set: { quiz: quiz._id, subject: session.subject, session: session._id }, $unset: { testSeries: "" } },
    { timestamps: false } // conversion = association only, don't bump questions' updatedAt
  );
  await TestSeries.findByIdAndDelete(item._id);
  res.json({ message: "Migrated to Quiz", _id: quiz._id });
}

// PATCH /api/tests/from-quiz/:id/to-my-quiz — platform Quiz → My Quiz (practice).
export async function quizToMyQuiz(req, res) {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });
  const stream = await PracticeStream.findOne({ _id: req.body.practiceStream, owner: null });
  const subject = await PracticeSubject.findOne({ _id: req.body.practiceSubject, owner: null });
  const topic = await PracticeTopic.findOne({ _id: req.body.practiceTopic, owner: null });
  if (!stream || !subject || !topic) return res.status(400).json({ message: "Choose a My Quiz stream, subject and topic." });
  const item = await TestSeries.create({
    name: quiz.title, owner: null, practice: true, practiceKind: "quiz",
    practiceStream: stream._id, practiceSubject: subject._id, practiceTopic: topic._id,
    category: "Full-Length", duration: 15, marks: 0, difficulty: quiz.difficulty || "Medium",
    status: "published", visibleToAll: false,
  });

  if (req.body.copy) {
    const created = await duplicateQuestions({ quiz: quiz._id }, { testSeries: item._id, owner: null });
    if (created.length) await TestSeries.findByIdAndUpdate(item._id, { $push: { questions: { $each: created.map((c) => c._id) } } });
    return res.json({ message: "Copied to My Quiz", _id: item._id });
  }

  const qs = await Question.find({ quiz: quiz._id }).select("_id");
  await Question.updateMany(
    { quiz: quiz._id },
    { $set: { testSeries: item._id }, $unset: { quiz: "", subject: "", session: "" } },
    { timestamps: false } // conversion = association only, don't bump questions' updatedAt
  );
  if (qs.length) await TestSeries.findByIdAndUpdate(item._id, { $push: { questions: { $each: qs.map((q) => q._id) } } });
  await Quiz.findByIdAndDelete(quiz._id);
  res.json({ message: "Migrated to My Quiz", _id: item._id });
}

// GET /api/tests/:id/questions  (admin or owning client) — full questions incl. answers
export async function getTestQuestions(req, res) {
  const test = await TestSeries.findById(req.params.id).select("owner");
  if (!test) return res.status(404).json({ message: "Test not found" });
  if (!canManage(req, test)) return res.status(403).json({ message: "Not your content" });
  const questions = await Question.find({ testSeries: req.params.id }).sort("createdAt");
  res.json(questions);
}

// POST /api/tests/:id/questions  (admin or owning client) — add one question
export async function addTestQuestion(req, res) {
  const test = await TestSeries.findById(req.params.id);
  if (!test) return res.status(404).json({ message: "Test not found" });
  if (!canManage(req, test)) return res.status(403).json({ message: "Not your content" });

  // Enforce per-subject question limit: if the test has a subjectPlan and the
  // question specifies a section (subject), don't allow adding more questions
  // than the planned count for that subject.
  const section = (req.body.section || "").trim();
  if (section && Array.isArray(test.subjectPlan) && test.subjectPlan.length > 0) {
    const plan = test.subjectPlan.find((p) => (p.subject || "") === section);
    if (plan && plan.count > 0) {
      const current = await Question.countDocuments({ testSeries: test._id, section });
      if (current >= plan.count) {
        return res.status(400).json({
          message: `Subject "${section}" already has ${current}/${plan.count} questions (limit reached). Remove a question first or increase the limit.`,
          limitReached: true,
          subject: section,
          current,
          planned: plan.count,
        });
      }
    }
  }

  // Stamp the question with the same owner as its test so it stays isolated.
  const question = await Question.create({ ...req.body, testSeries: test._id, owner: ownerValue(req) });
  await TestSeries.findByIdAndUpdate(test._id, { $push: { questions: question._id } });
  res.status(201).json(question);
}

// DELETE /api/tests/:id/questions/:qid  (admin or owning client)
export async function deleteTestQuestion(req, res) {
  const test = await TestSeries.findById(req.params.id).select("owner");
  if (!test) return res.status(404).json({ message: "Test not found" });
  if (!canManage(req, test)) return res.status(403).json({ message: "Not your content" });
  await TestSeries.findByIdAndUpdate(req.params.id, { $pull: { questions: req.params.qid } });
  await Question.findByIdAndDelete(req.params.qid);
  res.json({ message: "Question removed from test" });
}
