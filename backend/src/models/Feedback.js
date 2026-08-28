import mongoose from "../db/odm.js";

// Student feedback — either about a specific question, or an overall quiz/test.
const feedbackSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    name: { type: String, default: "Guest" },
    email: { type: String, default: "" },
    context: { type: String, enum: ["question", "quiz", "test"], default: "question" },
    message: { type: String, required: true, trim: true },
    rating: { type: Number, min: 1, max: 5 },
    questionText: { type: String, default: "" }, // snapshot of the question, if any
    // Full question snapshot { type, text, options, correct, columnA, columnB, explanation, chosen }
    question: { type: mongoose.Schema.Types.Mixed, default: null },
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "Question" }, // for admin edit
    questionNumber: { type: Number }, // position in the quiz/test
    details: { type: String, default: "" }, // e.g. "Correct: A, Chosen: B"
    source: { type: String, default: "" }, // quiz/test name for context
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Feedback", feedbackSchema);
