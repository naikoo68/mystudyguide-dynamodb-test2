import mongoose from "../db/odm.js";

// A topic groups sessions within a subject.
// Hierarchy: Subject → Topic → Session → Questions
const topicSchema = new mongoose.Schema(
  {
    subject: { type: mongoose.Schema.Types.ObjectId, ref: "Subject", required: true },
    title: { type: String, required: true, trim: true },
    index: { type: Number, default: 1 },
    description: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Topic", topicSchema);
