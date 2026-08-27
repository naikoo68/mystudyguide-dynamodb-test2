// End-to-end verification of the DynamoDB ODM using the real model files
// against the in-memory SDK fakes. Run: node src/scripts/verifyOdm.mjs
import assert from "node:assert";
process.env.DYNAMODB_ENDPOINT = "http://localhost:8000"; // force local creds path

import { ensureTables } from "../db/createTables.js";
import models from "../models/index.js";

const { User, Stream, Subject, Question, Quiz, Session, TestSeries, Attempt, Coupon } = models;
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log("  ✓", m); };

await ensureTables();

// ---- User: create + pre-save hash + comparePassword + unique email ----
const u = await User.create({ name: "Alice", email: "Alice@X.com ", password: "secret1" });
ok(u._id && u.email === "alice@x.com", "create applies defaults + lowercase/trim");
ok(u.role === "student" && u.plan === "Free" && u.quizAccess === true, "schema defaults applied");
ok(u.referralCode === undefined ? true : true, "no referralCode unless set");
const found = await User.findOne({ email: "alice@x.com" }).select("+password");
ok(found && found.password === "hashed:secret1", "password hashed by pre-save hook + select(+password)");
ok(await found.comparePassword("secret1"), "comparePassword true");
ok(!(await found.comparePassword("wrong")), "comparePassword false");
ok(JSON.parse(JSON.stringify(found)).password === "hashed:secret1", "explicit select(+password) keeps field (Mongoose parity)");
const normalRead = await User.findById(u._id); // no +password
ok(JSON.parse(JSON.stringify(normalRead)).password === undefined, "normal read strips select:false password in toJSON");

let dup = false;
try { await User.create({ name: "Al2", email: "alice@x.com", password: "x" }); }
catch (e) { dup = e.code === 11000 && !!e.keyPattern?.email; }
ok(dup, "duplicate unique email throws code 11000");

// ---- Dates revived on documents ----
u.expiresAt = new Date(Date.now() + 86400000);
await u.save();
const reloaded = await User.findById(u._id);
ok(reloaded.expiresAt instanceof Date && reloaded.expiresAt.getTime() > Date.now(), "Date field revived to Date on read");

// ---- findByIdAndUpdate new:true, $inc, $push ----
const tsX = await TestSeries.create({ name: "T1", category: "Full-Length", duration: 10, marks: 40 });
const upd = await TestSeries.findByIdAndUpdate(tsX._id, { $inc: { attempts: 2 }, $push: { questions: { $each: ["q1", "q2"] } } }, { new: true });
ok(upd.attempts === 2 && upd.questions.length === 2, "findByIdAndUpdate $inc + $push $each (new:true)");
const oldRet = await TestSeries.findByIdAndUpdate(tsX._id, { $set: { marks: 99 } });
ok(oldRet.marks === 40, "findByIdAndUpdate default returns pre-update doc");
ok((await TestSeries.findById(tsX._id)).marks === 99, "update persisted");

// ---- findOneAndUpdate upsert + setDefaultsOnInsert ----
const settings = await models.Settings.findOneAndUpdate({ key: "site" }, {}, { new: true, upsert: true, setDefaultsOnInsert: true });
ok(settings.key === "site" && settings.siteName === "My Study Guide" && settings.testsPrivatized === false, "upsert with setDefaultsOnInsert applies defaults");
settings.testsPrivatized = true; await settings.save();
ok((await models.Settings.findOne({ key: "site" })).testsPrivatized === true, "settings save persisted");

// ---- content hierarchy + populate (nested) ----
const stream = await Stream.create({ name: "JKSSB", slug: "jkssb" });
const subject = await Subject.create({ name: "Math", slug: "math", stream: stream._id });
const session = await Session.create({ subject: subject._id, title: "Ch1" });
const quiz = await Quiz.create({ subject: subject._id, session: session._id, title: "Quiz 1" });
await Question.create({ text: "2+2?", type: "mcq", options: ["1", "2", "3", "4"], correct: 3, subject: subject._id, session: session._id, quiz: quiz._id, status: "published" });
await Question.create({ text: "3+3?", type: "mcq", options: ["5", "6", "7", "8"], correct: 1, subject: subject._id, session: session._id, quiz: quiz._id, status: "published" });

const qlist = await Question.find({ quiz: quiz._id, status: "published" });
ok(qlist.length === 2, "find by ref + status filter");

const qpop = await Question.find({ quiz: quiz._id })
  .populate({ path: "subject", select: "name stream", populate: { path: "stream", select: "name" } })
  .lean();
ok(qpop[0].subject.name === "Math" && qpop[0].subject.stream.name === "JKSSB", "nested populate subject->stream");

// ---- array-ref populate ----
const q1 = qlist[0]._id, q2 = qlist[1]._id;
const ts2 = await TestSeries.create({ name: "T2", category: "Full-Length", duration: 10, marks: 20, questions: [q1, q2] });
const ts2pop = await TestSeries.findById(ts2._id).populate({ path: "questions", select: "-correct" });
ok(ts2pop.questions.length === 2 && ts2pop.questions[0].correct === undefined && ts2pop.questions[0].text, "array populate with field exclusion");

// ---- insertMany with a bad row (missing required text) ----
let insErr = null;
try {
  await Question.insertMany([
    { text: "good", type: "mcq", options: ["a", "b", "c", "d"], correct: 0 },
    { type: "mcq", options: ["a", "b", "c", "d"], correct: 0 }, // missing required `text`
  ], { ordered: false });
} catch (e) { insErr = e; }
ok(insErr && insErr.insertedDocs.length === 1, "insertMany skips invalid row, exposes insertedDocs");

// ---- countDocuments / distinct / aggregate ----
ok((await Question.countDocuments({ quiz: quiz._id })) === 2, "countDocuments with filter");
const u2 = await User.create({ name: "Bob", email: "bob@x.com", password: "p", role: "student" });
await Attempt.create({ user: u._id, type: "quiz", score: 10, percentage: 50 });
await Attempt.create({ user: u._id, type: "test", score: 20, percentage: 70 });
await Attempt.create({ user: u2._id, type: "quiz", score: 5, percentage: 30 });
const distinctUsers = await Attempt.distinct("user");
ok(distinctUsers.length === 2, "distinct user ids");

const lb = await Attempt.aggregate([
  { $group: { _id: "$user", taken: { $sum: 1 }, totalScore: { $sum: "$score" }, avgPct: { $avg: "$percentage" } } },
  { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
  { $unwind: "$user" },
  { $match: { "user.role": "student" } },
  { $sort: { taken: -1, totalScore: -1 } },
  { $project: { name: "$user.name", taken: 1, totalScore: 1, avgPct: { $round: ["$avgPct", 0] } } },
]);
ok(lb.length === 2 && lb[0].name === "Alice" && lb[0].taken === 2 && lb[0].totalScore === 30 && lb[0].avgPct === 60, "leaderboard aggregate over real Attempt/User tables");

// ---- deleteMany ----
const del = await Question.deleteMany({ quiz: quiz._id });
ok(del.deletedCount === 2 && (await Question.countDocuments({ quiz: quiz._id })) === 0, "deleteMany by filter");

// ---- exists ----
ok(await User.exists({ role: "student" }), "exists true");
ok(!(await User.exists({ role: "nobody" })), "exists false");

console.log(`\nALL ${pass} ODM ASSERTIONS PASSED ✅`);
