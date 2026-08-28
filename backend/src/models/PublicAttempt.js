import mongoose from "../db/odm.js";

// A completion of a PUBLIC (no-login) shared quiz/test. Public takers have no
// account, so nothing is stored against a user — just the anonymous result, so
// the admin can see how many people completed a shared link and their scores.
const publicAttemptSchema = new mongoose.Schema(
  {
    testSeries: { type: mongoose.Schema.Types.ObjectId, ref: "TestSeries", required: true, index: true },
    total: Number,
    attempted: Number,
    correct: Number,
    incorrect: Number,
    skipped: Number,
    score: Number,
    maxScore: Number,
    percentage: Number,
    timeTaken: Number, // seconds
  },
  { timestamps: true }
);

publicAttemptSchema.index({ testSeries: 1, createdAt: -1 });

export default mongoose.model("PublicAttempt", publicAttemptSchema);
