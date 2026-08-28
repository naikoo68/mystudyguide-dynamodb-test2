import mongoose from "../db/odm.js";

// Subject inside a Practice stream. Holds the practice items (quizzes/tests).
const practiceSubjectSchema = new mongoose.Schema(
  {
    stream: { type: mongoose.Schema.Types.ObjectId, ref: "PracticeStream", required: true },
    // Owner (client) — null/absent for platform content. See PracticeStream.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    name: { type: String, required: true, trim: true },
    slug: { type: String, default: "" },
    icon: { type: String, default: "BookOpen" },
    color: { type: String, default: "from-violet-500 to-fuchsia-600" },
    description: { type: String },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("PracticeSubject", practiceSubjectSchema);
