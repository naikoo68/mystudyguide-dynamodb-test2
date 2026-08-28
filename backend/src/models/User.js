import mongoose from "../db/odm.js";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Optional contact phone number, editable by the user from their Account page.
    phone: { type: String, trim: true, default: "" },
    password: { type: String, minlength: 6, select: false },
    googleId: { type: String },
    avatar: { type: String },
    // "client" = a self-service account that can ONLY use the My Practice
    // section, where it builds & practices its own private content.
    // "admin" = platform super-admin (cross-tenant). "institute_admin" = an
    // institute's own admin (scoped to their tenant). "client"/"student" as before.
    role: { type: String, enum: ["student", "admin", "institute_admin", "client"], default: "student" },
    plan: { type: String, enum: ["Free", "Premium", "Pro"], default: "Free" },
    status: { type: String, enum: ["active", "blocked"], default: "active" },
    // Soft delete (recoverable). When true the account is in the "Recycle bin":
    // it can't log in and is hidden from the normal lists, but its content is
    // KEPT so an admin can restore it. A separate permanent-delete erases it.
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    isEmailVerified: { type: Boolean, default: false },
    // Temporary accounts (created by an admin) expire at this time. When null
    // the account never expires. After expiry the user can no longer log in.
    expiresAt: { type: Date, default: null },
    // Content access. Quizzes are available to everyone by default; an admin
    // can revoke quiz access for a specific user. Test-series access is stored
    // per test on the TestSeries model.
    quizAccess: { type: Boolean, default: true },
  // Practice-content access grants. OFF by default: a user only sees the
  // My-Quiz / My-Test items explicitly shared with them (per-item visibility).
  // Turning these ON grants the user access to ALL My Quiz / My Test content
  // (an additive master grant — it never removes per-item access).
  myQuizAccess: { type: Boolean, default: false },
  myTestAccess: { type: Boolean, default: false },
    // AI access for client accounts. aiAccess is the master switch. New clients
    // and active subscribers get it turned ON automatically (every plan carries
    // AI limits); an admin can still turn it OFF for a specific client. The
    // schema default stays false so admin/student docs (which never set it)
    // don't imply AI access — client access is granted explicitly on register,
    // on subscription activation, and via a one-time backfill for existing ones.
    // The two pools the client may draw from:
    //   • inbuilt — the platform's built-in (admin) API keys
    //   • self    — API keys the client adds themselves
    // aiMode is the client's own choice between the pools they're allowed to use.
    aiAccess: { type: Boolean, default: false },
    aiAllowInbuilt: { type: Boolean, default: true },
    aiAllowSelf: { type: Boolean, default: true },
    aiMode: { type: String, enum: ["inbuilt", "self"], default: "inbuilt" },
    // Per-feature access for the client workspace tabs. Dashboard/Build/Notes/
    // Documents/User-manual are ON by default; the AI Generator is OFF by default
    // (the AI keys tab is gated by aiAccess above, also OFF by default).
    featDashboard: { type: Boolean, default: true },
    featBuild: { type: Boolean, default: true },
    featPapers: { type: Boolean, default: true },
    featChecker: { type: Boolean, default: true },
    featNotes: { type: Boolean, default: true },
    featDocuments: { type: Boolean, default: true },
    featManual: { type: Boolean, default: true },
    featAiGenerator: { type: Boolean, default: false },
    // First-run CREATOR setup guide progress (see CreatorSetupGuide on the
    // frontend). The two AI-action steps are recorded server-side the first
    // time the creator performs them; `completed` is set once the whole guide
    // is finished so it never auto-opens again.
    creatorGuide: {
      regenerated: { type: Boolean, default: false }, // used "Regenerate question" at least once
      extended: { type: Boolean, default: false },    // used "Extend explanation" at least once
      completed: { type: Boolean, default: false },   // finished every setup step
    },
    emailVerificationToken: String,
    otpHash: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    enrolledTests: [{ type: mongoose.Schema.Types.ObjectId, ref: "TestSeries" }],
    // Client subscription (chosen at self-service Client registration). The
    // account's validity (expiresAt) is set from subscriptionMonths on verify.
    subscriptionPlan: { type: String },    // "1m" | "2m" | "6m" | "1y"
    subscriptionMonths: { type: Number },
    subscriptionPrice: { type: Number },   // final price after coupon/referral
    // Referrals: this user's OWN shareable code + the code they signed up with.
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: String },
    referrerRewarded: { type: Boolean, default: false }, // referrer already credited for this user's first paid plan
    couponCode: { type: String },
    isTrial: { type: Boolean, default: false }, // on a free trial (vs a paid plan)
    paymentId: { type: String }, // Razorpay payment id (paid client signups)
    // ---- STUDENT subscription ----
    // A separate paywall for "student" accounts (kept distinct from the client
    // fields above and from the admin-created temporary-account `expiresAt`, so
    // it never interferes with login/expiry semantics for other roles). A
    // student needs studentPlanExpiresAt in the FUTURE to reach gated features
    // (attempting quizzes/test-series and their performance Dashboard).
    studentPlan: { type: String },              // plan key, e.g. "1m" | "3m" | "6m" | "1y"
    studentPlanMonths: { type: Number },
    studentPlanPrice: { type: Number },          // final price paid after coupon/referral
    studentPlanExpiresAt: { type: Date, default: null }, // subscription validity (null = free tier)
    studentTrial: { type: Boolean, default: false },     // currently on the free trial
    studentTrialUsed: { type: Boolean, default: false }, // the one-time free trial has been claimed
    studentPaymentId: { type: String },          // Razorpay payment id (latest student payment)
    streak: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Hash password before saving.
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

export default mongoose.model("User", userSchema);
