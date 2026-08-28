// ---------------------------------------------------------------------------
// One-time data importer: copies ALL documents from an existing MongoDB
// database into the new DynamoDB tables, preserving every id and reference so
// relationships stay intact.
//
// It is SAFE:
//   • It reads the ENTIRE MongoDB dataset into memory FIRST. Only after every
//     read succeeds does it touch DynamoDB — so if MongoDB is unreachable,
//     nothing is cleared or changed.
//   • It preserves each document's original _id (as a string), so re-running it
//     simply overwrites the same rows (no duplicates).
//
// Usage (either way):
//   • Standalone:  MONGO_URI="<old-uri>" npm run migrate-from-mongo
//   • On startup:  set env RUN_MONGO_MIGRATION=true and MONGO_URI, then deploy.
// ---------------------------------------------------------------------------

import { MongoClient } from "mongodb";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../config/dynamo.js";
import { ensureTables } from "../db/createTables.js";
import "../models/index.js";
import { allModels } from "../db/odm.js";
import { serialize } from "../db/helpers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// Recursively convert Mongo values into plain JSON:
//   • ObjectId  -> its hex string (so ids/refs become consistent strings)
//   • Date      -> left as Date (serialize() turns it into an ISO string)
//   • drops Mongoose's internal __v field
function convert(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "object") {
    if (typeof value.toHexString === "function") return value.toHexString(); // ObjectId
    if (value instanceof Date) return value;
    if (Array.isArray(value)) return value.map(convert);
    if (Buffer.isBuffer?.(value)) return value.toString("base64");
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "__v") continue;
      out[k] = convert(v);
    }
    return out;
  }
  return value;
}

// Match a MongoDB collection name to one of our models using longest-prefix
// matching on the normalized names (so "examposts" -> ExamPost, not Exam, and
// "quizzes" -> Quiz, "testseries" -> TestSeries, etc.).
function matchModel(collectionName, models) {
  const c = normalize(collectionName);
  let best = null;
  let bestLen = -1;
  for (const m of models) {
    const n = normalize(m.modelName);
    if (c.startsWith(n) && n.length > bestLen) {
      best = m;
      bestLen = n.length;
    }
  }
  return best;
}

async function putAll(model, docs) {
  for (let i = 0; i < docs.length; i += 25) {
    let items = docs.slice(i, i + 25).map((d) => ({ PutRequest: { Item: serialize(d) } }));
    let attempt = 0;
    while (items.length) {
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [model.tableName]: items } }));
      const unprocessed = res.UnprocessedItems?.[model.tableName] || [];
      if (!unprocessed.length) break;
      attempt += 1;
      if (attempt > 6) throw new Error(`Too many unprocessed writes for ${model.modelName}`);
      await sleep(200 * attempt);
      items = unprocessed;
    }
  }
}

async function clearTable(model) {
  const all = await model._scanAll();
  await model._batchDelete(all.map((i) => i._id));
}

export async function migrateFromMongo(uri) {
  if (!uri) throw new Error("MONGO_URI is not set — nothing to import from.");

  await ensureTables();
  const models = allModels();

  const client = new MongoClient(uri);
  await client.connect();
  console.log("✔ Connected to source MongoDB.");

  const summary = { imported: {}, skippedCollections: [], clearedTables: 0 };

  try {
    const db = client.db(); // database name comes from the URI
    const collections = (await db.listCollections().toArray())
      .map((c) => c.name)
      .filter((n) => !n.startsWith("system."));

    // 1) Map collections -> models, and READ EVERYTHING into memory first.
    const jobs = [];
    for (const name of collections) {
      const model = matchModel(name, models);
      if (!model) {
        summary.skippedCollections.push(name);
        continue;
      }
      // Avoid mapping two collections to the same model (keep the first).
      if (jobs.some((j) => j.model === model)) {
        summary.skippedCollections.push(`${name} (already mapped to ${model.modelName})`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const raw = await db.collection(name).find({}).toArray();
      jobs.push({ name, model, docs: raw.map(convert) });
      console.log(`  • Read ${raw.length} document(s) from "${name}" → ${model.modelName}`);
    }

    // SAFETY: if nothing matched, abort WITHOUT clearing anything — this
    // protects against a wrong/empty connection string wiping your data.
    if (!jobs.length) {
      throw new Error(
        "No matching collections found in the source MongoDB — aborting without changing anything. " +
        "Double-check your MONGO_URI (including the database name at the end)."
      );
    }

    // 2) Every read succeeded. Now it is safe to replace the DynamoDB data.
    //    Clear ALL tables (removes the placeholder sample data), then import.
    for (const model of models) {
      // eslint-disable-next-line no-await-in-loop
      await clearTable(model);
      summary.clearedTables += 1;
    }
    console.log(`✔ Cleared ${summary.clearedTables} DynamoDB table(s) (removed sample/placeholder data).`);

    for (const job of jobs) {
      // eslint-disable-next-line no-await-in-loop
      await putAll(job.model, job.docs);
      summary.imported[job.model.modelName] = job.docs.length;
      console.log(`  ✔ Imported ${job.docs.length} → ${job.model.modelName}`);
    }
  } finally {
    await client.close();
  }

  console.log("✔ Import complete:", JSON.stringify(summary.imported));
  if (summary.skippedCollections.length) {
    console.log("ℹ Collections with no matching model (skipped):", summary.skippedCollections.join(", "));
  }
  return summary;
}

// Allow running directly: `npm run migrate-from-mongo`
const isDirect = process.argv[1] && process.argv[1].endsWith("migrateFromMongo.js");
if (isDirect) {
  (async () => {
    try {
      await import("dotenv/config");
      const summary = await migrateFromMongo(process.env.MONGO_URI);
      console.log("\n✅ Done. Imported:", summary.imported);
      process.exit(0);
    } catch (e) {
      console.error("\n✖ Migration failed:", e.message);
      process.exit(1);
    }
  })();
}
