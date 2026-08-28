import mongoose from "../db/odm.js";

// A single manual "entry" — a function or sub-function. It is self-referencing:
// each entry can hold `children` (sub-functions), nested to any depth. This
// mirrors the shape the frontend renders (title, summary, details, image, tab).
const sectionSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    summary: { type: String, default: "" },
    details: { type: [String], default: [] },
    // Either an uploaded image URL (Cloudinary) or a static file name served
    // from /public/manual (e.g. "build.png"). The frontend handles both.
    image: { type: String, default: "" },
    // Optional workspace tab key (e.g. "build") — shows an "Open" button in the
    // client workspace. Empty for entries that aren't a whole tab.
    tab: { type: String, default: "" },
  },
  { _id: false }
);
// Self-reference: an entry's children are entries of the same shape.
sectionSchema.add({ children: { type: [sectionSchema], default: [] } });

// The manual is a singleton document (one row holds the whole tree), like the
// site Settings. `key` keeps it unique so we always upsert the same document.
const userManualSchema = new mongoose.Schema(
  {
    key: { type: String, default: "manual", unique: true },
    sections: { type: [sectionSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("UserManual", userManualSchema);
