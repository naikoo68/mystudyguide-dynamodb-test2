import mongoose from "../db/odm.js";

// A sub-section / post under an exam, e.g. "Finance Account Assistant" under JKSSB.
const examPostSchema = new mongoose.Schema(
  {
    exam: { type: mongoose.Schema.Types.ObjectId, ref: "Exam", required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    order: { type: Number, default: 1 },
  },
  { timestamps: true }
);

export default mongoose.model("ExamPost", examPostSchema);
