import mongoose from "../db/odm.js";

// A standalone saved text document. Typically created by uploading a PDF and
// extracting its text (done in the browser), then saving it here. Independent
// of study material and questions — just a simple titled text store.
const documentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, default: "" }, // the extracted / edited text
    sourceName: { type: String, default: "" }, // original PDF filename, if any
    pages: { type: Number, default: 0 }, // page count of the source PDF
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model("Document", documentSchema);
