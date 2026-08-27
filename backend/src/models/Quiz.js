import mongoose from "../db/odm.js";

// A quiz inside a session. Hierarchy:
//   Subject → Topic → Session → Quiz → Questions
// A session can hold several quizzes; each quiz holds its own questions.
const quizSchema = new mongoose.Schema(
  {
    subject: { type: mongoose.Schema.Types.ObjectId, ref: "Subject", required: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true },
    title: { type: String, required: true, trim: true },
    index: { type: Number, default: 1 },
    difficulty: { type: String, enum: ["Easy", "Medium", "Hard"], default: "Medium" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Quiz", quizSchema);
