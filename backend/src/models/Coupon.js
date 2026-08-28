import mongoose from "../db/odm.js";

// Admin-managed discount coupons applied at Client registration checkout.
// type "percent" → value is a % off; type "flat" → value is a ₹ amount off.
const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: ["percent", "flat"], default: "flat" },
    value: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
    usageLimit: { type: Number, default: 0 }, // 0 = unlimited
    usedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("Coupon", couponSchema);
