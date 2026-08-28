import mongoose from "../db/odm.js";

// A pending (or resolved) account-to-account content share. Client 1 sends a
// stream / subject / topic / quiz / test to Client 2; it sits here as "pending"
// until Client 2 ACCEPTS (the content is then duplicated into their own account)
// or DECLINES. The source content is referenced by id and duplicated at accept
// time, so the recipient always gets their OWN independent copy.
const contentShareSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // sender
    to: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },   // recipient
    fromName: { type: String, default: "" }, // snapshot of sender's name for display
    level: { type: String, enum: ["stream", "subject", "topic", "item"], required: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId, required: true }, // stream/subject/topic id, or TestSeries id
    kind: { type: String, enum: ["quiz", "test"], default: "quiz" },
    title: { type: String, default: "" },   // snapshot of the node/item name
    itemCount: { type: Number, default: 0 }, // how many quizzes/tests it contains
    status: { type: String, enum: ["pending", "accepted", "declined"], default: "pending" },
  },
  { timestamps: true }
);

contentShareSchema.index({ to: 1, status: 1, createdAt: -1 });

export default mongoose.model("ContentShare", contentShareSchema);
