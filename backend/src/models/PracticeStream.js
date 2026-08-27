import mongoose from "../db/odm.js";

// Top level of the "Practice Quizzes" section: Stream → Subject → Item.
// Separate from the main quiz Stream so practice content never mixes with it.
const practiceStreamSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["quiz", "test"], default: "quiz" }, // My Quiz vs My Test Series — kept separate
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
  },
  { timestamps: true }
);

export default mongoose.model("PracticeStream", practiceStreamSchema);
