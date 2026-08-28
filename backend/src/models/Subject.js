import mongoose from "../db/odm.js";

const subjectSchema = new mongoose.Schema(
  {
    stream: { type: mongoose.Schema.Types.ObjectId, ref: "Stream" }, // parent stream
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    icon: { type: String, default: "BookOpen" },
    color: { type: String, default: "from-blue-500 to-indigo-600" },
    // Optional custom logo (image URL or small base64 data URI). When set it is
    // shown instead of the icon/emoji. Blank = auto-pick from the name.
    image: { type: String, default: "" },
    description: { type: String },
    isActive: { type: Boolean, default: true },
    // Recycle Bin (soft delete) — see utils/softDelete.js.
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Subject", subjectSchema);
