import mongoose from "../db/odm.js";

// An uploaded study-material file (PDF, doc, image…) under a class.
const smFileSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, ref: "Institution", required: true },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: "SmSubject", required: true },
    smClass: { type: mongoose.Schema.Types.ObjectId, ref: "SmClass", required: true },
    title: { type: String, required: true, trim: true },
    url: { type: String, required: true }, // Cloudinary URL or external link
    fileType: { type: String, default: "" }, // e.g. pdf, docx, png
    description: { type: String, default: "" },
    order: { type: Number, default: 1 },
  },
  { timestamps: true }
);

export default mongoose.model("SmFile", smFileSchema);
