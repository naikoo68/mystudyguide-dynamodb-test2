import mongoose from "../db/odm.js";

// A lightweight Companion activity record (per user) — powers "Companion
// History". One row per meaningful action (saved quiz, summary, flashcards,
// explain). tenantId is added automatically by the global plugin.
const companionItemSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["questions", "quiz", "summary", "flashcards", "explain"], default: "questions" },
    title: { type: String, default: "" },
    platform: { type: String, default: "" },
    url: { type: String, default: "" },
    count: { type: Number, default: 0 },
    // For saved quizzes: the practice item created, so history can deep-link to it.
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "TestSeries", default: null },
  },
  { timestamps: true }
);

companionItemSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("CompanionItem", companionItemSchema);
