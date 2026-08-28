import mongoose from "../db/odm.js";

// A class under a study-material subject, e.g. "Class 10" or "Semester 1".
const smClassSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, ref: "Institution", required: true },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: "SmSubject", required: true },
    name: { type: String, required: true, trim: true },
    order: { type: Number, default: 1 },
  },
  { timestamps: true }
);

export default mongoose.model("SmClass", smClassSchema);
