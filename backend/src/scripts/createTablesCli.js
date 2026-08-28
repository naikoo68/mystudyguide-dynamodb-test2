// CLI: create all DynamoDB tables. Run with: npm run create-tables
import "dotenv/config";
import { ensureTables } from "../db/createTables.js";

(async () => {
  try {
    const results = await ensureTables();
    const created = results.filter((r) => r.created).length;
    console.log(`✔ Table check complete — ${created} created, ${results.length - created} already existed.`);
    process.exit(0);
  } catch (e) {
    console.error("✖ Failed to create tables:", e.message);
    process.exit(1);
  }
})();
