import mongoose from "../db/odm.js";

// A session/chapter within a topic.
// Hierarchy: Subject → Topic → Session → Questions
const sessionSchema = new mongoose.Schema(
  {
    subject: { type: mongoose.Schema.Types.ObjectId, ref: "Subject", required: true },
    topic: { type: mongoose.Schema.Types.ObjectId, ref: "Topic" },
    title: { type: String, required: true, trim: true },
    index: { type: Number, default: 1 },
    difficulty: { type: String, enum: ["Easy", "Medium", "Hard"], default: "Medium" },
    isActive: { type: Boolean, default: true },
    // Recycle Bin (soft delete) — see utils/softDelete.js.
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Session", sessionSchema);
