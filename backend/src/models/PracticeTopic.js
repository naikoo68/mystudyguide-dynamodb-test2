import mongoose from "../db/odm.js";

// Topic inside a Practice subject — used ONLY by the "My Quiz" sub-module
// (Stream → Subject → Topic → Quiz). "My Test Series" has no topic level.
const practiceTopicSchema = new mongoose.Schema(
  {
    subject: { type: mongoose.Schema.Types.ObjectId, ref: "PracticeSubject", required: true },
    // Owner (client) — null/absent for platform content. See PracticeStream.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    name: { type: String, required: true, trim: true },
    slug: { type: String, default: "" },
    icon: { type: String, default: "Layers" },
    color: { type: String, default: "from-violet-500 to-fuchsia-600" },
    description: { type: String },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("PracticeTopic", practiceTopicSchema);
