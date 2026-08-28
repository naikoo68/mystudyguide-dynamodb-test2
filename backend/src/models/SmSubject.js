import mongoose from "../db/odm.js";

// A subject under a study-material institution, e.g. "Mathematics".
const smSubjectSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, ref: "Institution", required: true },
    name: { type: String, required: true, trim: true },
    order: { type: Number, default: 1 },
  },
  { timestamps: true }
);

export default mongoose.model("SmSubject", smSubjectSchema);
