import mongoose from "../db/odm.js";

// Standalone email-verification codes for sign-up flows where the user account
// doesn't exist yet — e.g. public institute self-signup, where the admin user
// is only created AFTER payment/provisioning. The User-based OTP fields can't be
// used here, so we key a short-lived code by email instead. One record per email
// (upserted on each resend); deleted once the institute is provisioned.
const emailOtpSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    otpHash: { type: String },
    otpExpires: { type: Date },
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model("EmailOtp", emailOtpSchema);
