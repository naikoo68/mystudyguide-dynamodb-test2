import mongoose from "../db/odm.js";

// Top level of the quiz hierarchy:
//   Stream → Subject → Topic → Session → Quiz → Questions
// A stream groups subjects (e.g. "JKSSB", "NEET", "SSC").
const streamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    icon: { type: String, default: "GraduationCap" },
    color: { type: String, default: "from-blue-500 to-indigo-600" },
    description: { type: String },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    // Recycle Bin (soft delete). When true, the stream is hidden from all normal
    // lists but kept in the DB so it can be restored. deletedAt records when.
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Stream", streamSchema);
