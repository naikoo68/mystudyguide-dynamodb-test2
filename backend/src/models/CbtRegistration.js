import mongoose from "../db/odm.js";

// A candidate's registration for the exam PORTAL. Registration happens once on
// the portal web page: the student enters name + email and verifies a one-time
// code (OTP) sent to that email. Once verified we issue a sessionToken the
// client keeps and presents when it starts and submits ANY live exam — so they
// don't re-register per test.
//
// Portal-wide: one registration per email (not per exam). Short-lived: the doc
// auto-expires (TTL) so the collection stays small. It only gates entry — the
// one-attempt rule and results live in CbtAttempt permanently.
const cbtRegistrationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    name: { type: String, trim: true },
    passwordHash: { type: String }, // set at registration; lets a student log in later without OTP
    code: { type: String }, // 6-digit OTP
    codeExpiresAt: { type: Date }, // OTP validity (~10 min)
    verified: { type: Boolean, default: false },
    sessionToken: { type: String, index: true }, // issued on verify; presented on start/submit
    // The whole registration auto-deletes after this time (TTL). Refreshed on
    // each verify so an active candidate's session stays valid.
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

cbtRegistrationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL cleanup

export default mongoose.model("CbtRegistration", cbtRegistrationSchema);
