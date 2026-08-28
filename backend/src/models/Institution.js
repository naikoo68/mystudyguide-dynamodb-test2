import mongoose from "../db/odm.js";

// Top level of Study Material: a University or School.
//   Institution → Subject → Class → Files
const institutionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ["University", "School"], default: "University" },
    description: { type: String, default: "" },
    order: { type: Number, default: 1 },
  },
  { timestamps: true }
);

export default mongoose.model("Institution", institutionSchema);
