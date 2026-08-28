import mongoose from "../db/odm.js";

// Durable, platform-wide record that an EMAIL has consumed a free trial — so the
// same email can't claim the trial again even after deleting and recreating an
// account. Always queried/written UNSCOPED (see studentSubscriptionController)
// so it's a global anti-abuse ledger, independent of tenant. `kind` keeps a
// separate ledger per audience (student | client | institute) for future reuse.
const trialClaimSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    kind: { type: String, default: "student" },
  },
  { timestamps: true }
);

// One trial per email per audience, ever.
trialClaimSchema.index({ email: 1, kind: 1 }, { unique: true });

export default mongoose.model("TrialClaim", trialClaimSchema);
