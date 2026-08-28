import mongoose from "../db/odm.js";

// Top level of the "Practice Quizzes" section: Stream → Subject → Item.
// Separate from the main quiz Stream so practice content never mixes with it.
const practiceStreamSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["quiz", "test", "paper"], default: "quiz" }, // My Quiz vs My Test Series vs Previous Papers — kept separate
    // Multi-tenant owner. null/absent = platform (admin) content; a User id =
    // a client's private content, visible only to that client.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    name: { type: String, required: true, trim: true },
    slug: { type: String, default: "" },
    icon: { type: String, default: "GraduationCap" },
    color: { type: String, default: "from-violet-500 to-fuchsia-600" },
    description: { type: String },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    // Admin "disable" switch. When true the node (and everything under it) is
    // hidden from students / public share links / client browse & play, but it
    // stays visible in the admin manager so it can be re-enabled. Distinct from
    // `isActive` (which hard-hides everywhere) and from soft delete.
    disabled: { type: Boolean, default: false },
    // Public share link (mirrors TestSeries). When publicShare is on, ANYONE
    // with the publicToken URL can open a page listing every quiz/test under
    // this stream and take them — no account/login. Enabling cascades the same
    // public link on to all published items beneath it.
    publicShare: { type: Boolean, default: false },
    publicToken: { type: String, index: true, default: null },
    publicExpiresAt: { type: Date, default: null }, // null = never expires
    publicViews: { type: Number, default: 0 }, // # opens of the shared page
  },
  { timestamps: true }
);

export default mongoose.model("PracticeStream", practiceStreamSchema);
