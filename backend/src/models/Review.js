import mongoose from "../db/odm.js";

// A review submitted by a student or client from the public site. Reviews start
// as "pending" and only appear on the home page after an admin approves them
// (approval copies the review into Settings.testimonials).
const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // set if submitted while logged in
    name: { type: String, required: true, trim: true },
    exam: { type: String, default: "", trim: true }, // exam cleared / role / institute name
    rating: { type: Number, min: 1, max: 5, default: 5 },
    text: { type: String, required: true, trim: true },
    photo: { type: String, default: "" }, // optional profile picture (URL / small data-URI)
    email: { type: String, default: "" },
    role: { type: String, enum: ["student", "client", "guest"], default: "guest" },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  },
  { timestamps: true }
);

export default mongoose.model("Review", reviewSchema);
