import mongoose from "../db/odm.js";

const subjectSchema = new mongoose.Schema(
  {
    stream: { type: mongoose.Schema.Types.ObjectId, ref: "Stream" }, // parent stream
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    icon: { type: String, default: "BookOpen" },
    color: { type: String, default: "from-blue-500 to-indigo-600" },
    description: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Subject", subjectSchema);
