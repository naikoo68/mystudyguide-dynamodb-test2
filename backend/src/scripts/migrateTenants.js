import "dotenv/config";
// Ensure the global tenantId plugin is registered BEFORE any model compiles.
import "../config/registerModelPlugins.js";
import mongoose from "../db/odm.js";
import connectDB from "../config/db.js";
import { backfillTenants } from "../utils/backfillTenants.js";

// Manual runner for the Phase-2 tenant backfill. This is OPTIONAL — the same
// backfill runs automatically once on server startup (see server.js). It's kept
// for running the backfill on demand (e.g. after a bulk import).
//
// Run with:  npm run migrate:tenants   (from the backend/ folder)

async function run() {
  await connectDB();
  const { tenantId, backfilled } = await backfillTenants({ log: (m) => console.log(m) });
  console.log(`\n✔ Tenant migration complete. Backfilled ${backfilled} document(s) into tenant ${tenantId}.`);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("Tenant migration FAILED:", err);
  process.exit(1);
});
