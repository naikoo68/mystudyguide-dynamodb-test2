import mongoose from "../db/odm.js";

// A completion of a CBT (Computer-Based Test) online exam. Unlike an anonymous
// public share (PublicAttempt), a CBT taker signs in with their name + email
// (no account/OTP), so the result is stored WITH their identity — letting the
// admin rank every candidate and letting us email each student their result.
//
// A full graded `review` snapshot is stored so the emailed result and the
// printable result page stay correct even if the underlying test/questions are
// later edited or deleted.
const cbtAttemptSchema = new mongoose.Schema(
  {
    testSeries: { type: mongoose.Schema.Types.ObjectId, ref: "TestSeries", required: true, index: true },
    // Candidate identity (captured at sign-in — no account required).
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },

    // Score summary.
    total: Number,
    attempted: Number,
    correct: Number,
    incorrect: Number,
    skipped: Number,
    score: Number,
    maxScore: Number,
    percentage: Number,
    timeTaken: Number, // seconds

    // Rank among all candidates at the moment this attempt was submitted (a
    // snapshot — the live leaderboard is recomputed on read).
    rankAtSubmit: Number,
    candidatesAtSubmit: Number,

    // Full graded question-by-question breakdown (text, options, correct index,
    // chosen index, explanation, optionExplanations, columns/table/assertion…),
    // captured at submit time so results are stable regardless of later edits.
    review: { type: mongoose.Schema.Types.Mixed, default: undefined },

    // Opaque token for the public, printable result page (no login needed — the
    // student reaches it from the link emailed to them).
    resultToken: { type: String, index: true, unique: true, sparse: true },
    // The frontend origin the candidate took the exam from (e.g.
    // https://mysite.vercel.app), captured at submit time so the emailed result
    // link points at the real site even when CLIENT_URL isn't configured.
    resultBase: { type: String, default: "" },
    emailed: { type: Boolean, default: false }, // whether the result email was sent
  },
  { timestamps: true }
);

cbtAttemptSchema.index({ testSeries: 1, score: -1, timeTaken: 1 }); // leaderboard sort
cbtAttemptSchema.index({ testSeries: 1, email: 1, score: -1 }); // best-per-student dedupe

export default mongoose.model("CbtAttempt", cbtAttemptSchema);
