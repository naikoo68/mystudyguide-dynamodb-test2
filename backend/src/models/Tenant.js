import mongoose from "../db/odm.js";

// A TENANT is one institute in the multi-tenant SaaS. Every tenant-owned
// document (users, questions, tests, settings, …) will carry this tenant's _id
// as `tenantId`, and the app resolves the current tenant per request from the
// subdomain (`slug.yourapp.com`), a custom domain, or the logged-in user.
//
// Phase 1 (foundation): this model + a super-admin management API only. Nothing
// else is scoped yet, so the existing single-tenant app is unaffected. Later
// phases add `tenantId` to other models, the resolution/scoping layer, and the
// paid online onboarding that auto-creates a tenant.
const tenantSchema = new mongoose.Schema(
  {
    // Institute display name (e.g. "Bright Future Academy").
    name: { type: String, required: true, trim: true },

    // Subdomain label — the tenant is reached at `<slug>.yourapp.com`.
    // Lowercase, URL-safe, globally unique.
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, "Invalid subdomain (use lowercase letters, numbers and hyphens)"],
    },

    // Optional custom domain (Phase 6). Sparse+unique so many tenants can leave
    // it unset without colliding. IMPORTANT: no `default` — a default of "" is a
    // real value that the sparse index would still index, so a 2nd tenant with
    // "" would collide. Leaving it undefined keeps the field ABSENT (which the
    // sparse index correctly ignores).
    customDomain: { type: String, trim: true, lowercase: true, index: { unique: true, sparse: true } },

    // Lifecycle. "pending" = created but not yet paid/activated; "active" =
    // usable; "suspended" = temporarily disabled by the super-admin.
    status: { type: String, enum: ["pending", "active", "suspended"], default: "pending" },

    // The fallback tenant used when a request's host doesn't map to any specific
    // institute (e.g. the apex domain, local dev). Exactly one tenant should
    // carry this; the migration sets it on the backfill "default" tenant.
    isDefault: { type: Boolean, default: false, index: true },

    // Institute owner / primary contact (the person who registered it).
    ownerName: { type: String, trim: true, default: "" },
    ownerEmail: { type: String, trim: true, lowercase: true, default: "" },

    // Tenant-level subscription (mirrors the existing plan fields). Populated by
    // the paid online onboarding in Phase 5; settable by the super-admin now.
    subscriptionPlan: { type: String },
    subscriptionMonths: { type: Number },
    subscriptionPrice: { type: Number },
    isTrial: { type: Boolean, default: false },
    paymentId: { type: String },
    expiresAt: { type: Date, default: null }, // null = never expires

    // Soft-delete (recoverable), consistent with the User model's pattern.
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },

    // Per-institute feature access (super-admin controlled). A map of
    // featureKey -> boolean. A feature is ENABLED unless explicitly set to
    // false, so an empty/missing map means "everything on" (safe default for
    // existing institutes). The institute admin's sidebar & routes respect this.
    features: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("Tenant", tenantSchema);
