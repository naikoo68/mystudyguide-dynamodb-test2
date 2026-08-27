import mongoose from "../db/odm.js";

// Top level of the test-series hierarchy, e.g. "JKSSB", "SSC", "Banking".
//   Exam → Post (sub-section) → Category → Tests
const examSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    order: { type: Number, default: 1 },
  },
  { timestamps: true }
);

export default mongoose.model("Exam", examSchema);
