import "dotenv/config";
import app from "./app.js";
import connectDB from "./config/db.js";
import { seedIfEmpty } from "./utils/seedData.js";
import { ensureAdminFromEnv } from "./utils/ensureAdmin.js";
import { ensureDefaultStream } from "./utils/ensureDefaultStream.js";
import Settings from "./models/Settings.js";
import TestSeries from "./models/TestSeries.js";

const PORT = process.env.PORT || 5000;

// NOTE: Expired accounts are NEVER deleted. When a client's subscription/trial
// ends we only RESTRICT access (the `protect` middleware blocks their content
// and the frontend shows an Upgrade screen) — their account and the quizzes/
// tests they built are preserved so everything returns the moment they renew.

// One-time migration: make every EXISTING test series private so students only
// see tests they've been granted (matching the new default for new tests).
// Runs once — a flag in Settings prevents it from repeating, so an admin can
// still make specific tests public afterwards.
async function privatizeExistingTests() {
  try {
    const settings = await Settings.findOneAndUpdate(
      { key: "site" },
      {},
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    if (settings.testsPrivatized) return;
    const { modifiedCount } = await TestSeries.updateMany(
      { visibleToAll: { $ne: false } },
      { $set: { visibleToAll: false } }
    );
    settings.testsPrivatized = true;
    await settings.save();
    console.log(`🔒 Made ${modifiedCount} existing test series private (one-time migration).`);
  } catch (err) {
    console.error("Test-privacy migration skipped:", err.message);
  }
}

async function start() {
  await connectDB();

  // Start listening immediately so the host detects an open port quickly.
  app.listen(PORT, () => {
    console.log(`✔ My Study Guide API running on http://localhost:${PORT}`);
  });

  // One-time data import from an existing MongoDB. When RUN_MONGO_MIGRATION is
  // "true" (and MONGO_URI is set), copy everything from the old MongoDB into
  // DynamoDB (replacing the sample data) and SKIP the normal seed/bootstrap so
  // nothing interferes. Remove the RUN_MONGO_MIGRATION variable once it's done.
  if (process.env.RUN_MONGO_MIGRATION === "true" && process.env.MONGO_URI) {
    console.log("↻ RUN_MONGO_MIGRATION is on — importing your existing MongoDB data…");
    import("./scripts/migrateFromMongo.js")
      .then(({ migrateFromMongo }) => migrateFromMongo(process.env.MONGO_URI))
      .then((summary) => {
        console.log("✅ MongoDB → DynamoDB import complete.", JSON.stringify(summary.imported));
        console.log("👉 You can now REMOVE the RUN_MONGO_MIGRATION variable (and MONGO_URI) in your host settings.");
      })
      .catch((err) => console.error("✖ MongoDB import failed (nothing was cleared if it couldn't connect):", err.message));
    return; // skip the sample-data bootstrap below while importing
  }

  // Make existing test series private (one-time).
  privatizeExistingTests();

  // Ensure a default "JKSSB" stream exists and move any stream-less subjects in.
  ensureDefaultStream();

  // Seed in the background (never blocks startup, never crashes the server).
  // Runs only when the database has no users — handy on hosts without shell
  // access (e.g. Render free tier). Disable with AUTO_SEED=off.
  if (process.env.AUTO_SEED !== "off") {
    seedIfEmpty()
      .then((seeded) => {
        if (seeded) console.log("✔ Database was empty — seeded sample data (admin@mystudyguide.com / admin123).");
      })
      .catch((err) => console.error("Auto-seed skipped:", err.message))
      // After seeding, ensure the env-configured admin exists (create/recover)
      // and that seeded subjects are placed inside the default stream.
      .finally(() => {
        ensureAdminFromEnv().catch((e) => console.error("ensureAdmin skipped:", e.message));
        ensureDefaultStream();
      });
  } else {
    ensureAdminFromEnv().catch((e) => console.error("ensureAdmin skipped:", e.message));
  }
}

start();
