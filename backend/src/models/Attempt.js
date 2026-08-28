import mongoose from "../db/odm.js";

// Records a user's quiz or test attempt and computed result.
const attemptSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["quiz", "test"], required: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "Session" },
    quiz: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz" },
    testSeries: { type: mongoose.Schema.Types.ObjectId, ref: "TestSeries" },
    responses: [
      {
        question: { type: mongoose.Schema.Types.ObjectId, ref: "Question" },
        chosen: { type: Number, default: null },
        isCorrect: { type: Boolean, default: false },
      },
    ],
    total: Number,
    attempted: Number,
    correct: Number,
    incorrect: Number,
    score: Number,
    percentage: Number,
    timeTaken: Number, // seconds
    rank: Number,
    weakTopics: [String],
  },
  { timestamps: true }
);

export default mongoose.model("Attempt", attemptSchema);
