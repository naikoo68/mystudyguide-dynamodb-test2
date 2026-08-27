import TestSeries from "../models/TestSeries.js";
import Question from "../models/Question.js";
import Attempt from "../models/Attempt.js";
import User from "../models/User.js";
import { isTestVisibleToUser, findAccessEntry } from "../utils/accessControl.js";
import { notifyNewContent } from "../utils/notify.js";
import { ownerValue, ownerFilter } from "../utils/ownership.js";
import PracticeStream from "../models/PracticeStream.js";
import PracticeSubject from "../models/PracticeSubject.js";
import PracticeTopic from "../models/PracticeTopic.js";
import Quiz from "../models/Quiz.js";
import Session from "../models/Session.js";
import { duplicateQuestions } from "../utils/duplicateQuestions.js";

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

  // Ids are plain uuid strings under DynamoDB — just normalise/validate them.
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
  const tests = await TestSeries.find(filter).sort("-createdAt").lean();
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
  if (req.user?.role !== "admin" && !isOwner && !isTestVisibleToUser(test.toObject(), req.user?._id)) {
    return res.status(403).json({ message: "You don't have access to this test, or your access has expired." });
  }
  const obj = test.toObject();
  delete obj.access; // hide access list from students
  res.json(obj);
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

// POST /api/tests/:id/submit — grade a submitted test attempt
export async function submitTest(req, res) {
  const { answers = {}, timeTaken = 0 } = req.body; // answers: { questionId: optionIndex }
  const test = await TestSeries.findById(req.params.id).populate("questions");
  if (!test) return res.status(404).json({ message: "Test not found" });

  const total = test.questions.length;
  let correct = 0;
  let attempted = 0;

  // Build both the stored responses and a rich review for the result screen.
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
  const perQuestion = total ? test.marks / total : 0;
  const score = Math.round(correct * perQuestion - incorrect * (test.negativeMarking || 0));
  const percentage = total ? Math.round((correct / total) * 100) : 0;

  const attempt = await Attempt.create({
    user: req.user._id,
    type: "test",
    testSeries: test._id,
    responses,
    total,
    attempted,
    correct,
    incorrect,
    score,
    percentage,
    timeTaken,
  });

  await TestSeries.findByIdAndUpdate(test._id, { $inc: { attempts: 1 } });
  // Return the graded summary + full review (with correct answers) for the UI.
  res.status(201).json({
    _id: attempt._id,
    total,
    attempted,
    skipped,
    correct,
    incorrect,
    score,
    maxScore: test.marks,
    percentage,
    timeTaken,
    review,
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
    { $set: { quiz: quiz._id, subject: session.subject, session: session._id }, $unset: { testSeries: "" } }
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
    { $set: { testSeries: item._id }, $unset: { quiz: "", subject: "", session: "" } }
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
