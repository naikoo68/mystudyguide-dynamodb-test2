import mongoose from "../db/odm.js";
import Tenant from "../models/Tenant.js";
import Settings from "../models/Settings.js";

// Shared Phase-2 backfill logic, used by BOTH the auto-run on server startup
// (server.js) and the manual CLI script (scripts/migrateTenants.js):
//   1. Ensure a DEFAULT tenant exists (the institute all existing data belongs
//      to, so nothing breaks when scoping turns on in Phase 3).
//   2. Backfill `tenantId` = default on every existing tenant-owned document.
//   3. Ensure a { tenantId: 1 } index on each of those collections.
//
// Idempotent: only touches documents with no tenantId, and index creation is a
// no-op if it already exists — safe to run any number of times.

// Every tenant-owned model — everything EXCEPT the Tenant registry itself.
export const TENANT_OWNED_MODELS = [
  "AiKey", "Attempt", "CbtAttempt", "CbtRegistration", "ContentShare", "Coupon",
  "Document", "Exam", "ExamPost", "FbSchedule", "Feedback", "Institution", "Message",
  "Notice", "PracticeStream", "PracticeSubject", "PracticeTopic", "PublicAttempt",
  "Question", "Quiz", "Review", "Session", "Settings", "SmClass", "SmFile", "SmSubject",
  "Stream", "Subject", "TestSeries", "Topic", "User", "UserManual",
];

// Make sure each model is registered on the connection. On server startup they
// already are (app.js imported them); a standalone script may not have, so we
// import on demand. import() is cached, so this is cheap either way.
async function ensureModelsRegistered() {
  for (const name of TENANT_OWNED_MODELS) {
    if (!mongoose.models[name]) await import(`../models/${name}.js`);
  }
}

// Find or create the single default tenant and return its id.
export async function ensureDefaultTenant() {
  const slug = String(process.env.DEFAULT_TENANT_SLUG || "default").toLowerCase();

  let tenant = await Tenant.findOne({ isDefault: true });
  if (!tenant) tenant = await Tenant.findOne({ slug });

  if (!tenant) {
    let name = process.env.DEFAULT_TENANT_NAME;
    if (!name) {
      const s = await Settings.findOne({ key: "site" }).select("siteName").lean();
      name = s?.siteName || "Default Institute";
    }
    tenant = await Tenant.create({ name, slug, status: "active", isDefault: true });
  } else if (!tenant.isDefault) {
    tenant.isDefault = true;
    await tenant.save();
  }
  return tenant;
}

// Run the full backfill. `log` lets the CLI print progress; startup stays quiet.
export async function backfillTenants({ log = () => {} } = {}) {
  await ensureModelsRegistered();

  const tenant = await ensureDefaultTenant();
  const tenantId = tenant._id;
  log(`Default tenant: ${tenant.name} (slug: ${tenant.slug}) -> ${tenantId}`);

  let backfilled = 0;
  for (const name of TENANT_OWNED_MODELS) {
    const coll = mongoose.model(name).collection;
    // `{ tenantId: null }` matches BOTH missing and explicitly-null values.
    const res = await coll.updateMany({ tenantId: null }, { $set: { tenantId } });
    backfilled += res.modifiedCount || 0;
    try {
      await coll.createIndex({ tenantId: 1 });
    } catch (e) {
      log(`  index on ${name}.tenantId skipped: ${e.message}`);
    }
    log(`${name}: backfilled ${res.modifiedCount || 0} doc(s); tenantId index ensured`);
  }

  return { tenantId, backfilled };
}
