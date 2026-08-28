import mongoose from "../db/odm.js";

// A short announcement/notice shown in the scrolling ticker at the top of the
// site. Admins add, edit, delete and toggle these. Only `active` notices are
// shown to students.
const noticeSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    link: { type: String, default: "" }, // optional URL the notice links to
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 }, // lower shows first
  },
  { timestamps: true }
);

export default mongoose.model("Notice", noticeSchema);
