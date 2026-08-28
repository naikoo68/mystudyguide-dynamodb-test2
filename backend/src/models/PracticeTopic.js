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
    // Admin "disable" switch — hides this node from students/public/client
    // browse & play, but keeps it visible in the admin manager. See PracticeStream.
    disabled: { type: Boolean, default: false },
    // Public share link (see PracticeStream). Anyone with the link sees every
    // quiz under this topic; enabling cascades to the quizzes beneath it.
    publicShare: { type: Boolean, default: false },
    publicToken: { type: String, index: true, default: null },
    publicExpiresAt: { type: Date, default: null }, // null = never expires
    publicViews: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("PracticeTopic", practiceTopicSchema);
