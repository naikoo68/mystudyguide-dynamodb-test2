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

const Coupon = mongoose.model("Coupon", couponSchema);

// Atomically record ONE redemption of a coupon, but ONLY while it's still under
// its usage limit (usageLimit 0 = unlimited). Doing the limit check and the
// increment in a single conditional update prevents concurrent redemptions from
// pushing usedCount past usageLimit. No-op for built-in (non-DB) codes. Returns
// true if a redemption was counted. Safe to call fire-and-forget.
export async function redeemCoupon(code) {
  if (!code) return false;
  try {
    const result = await Coupon.updateOne(
      {
        code: String(code).toUpperCase(),
        $or: [{ usageLimit: { $lte: 0 } }, { $expr: { $lt: ["$usedCount", "$usageLimit"] } }],
      },
      { $inc: { usedCount: 1 } }
    );
    return result.modifiedCount > 0;
  } catch {
    return false;
  }
}

export default Coupon;
