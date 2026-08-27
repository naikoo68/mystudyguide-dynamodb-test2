// Creates one on-demand (pay-per-request) DynamoDB table per model, keyed by
// `_id`. Idempotent: existing tables are left untouched. Safe to run on every
// boot and also exposed as `npm run create-tables`.
//
// NOTE ON INDEXES / SCALING
// -------------------------
// This layer queries via Scan + in-memory filtering, so no secondary indexes
// are required for correctness. For large datasets you can add Global Secondary
// Indexes (e.g. on `email`, `owner`, `session`, `quiz`, `testSeries`) here and
// teach the ODM to use Query instead of Scan for those access patterns.

import {
  CreateTableCommand,
  DescribeTableCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { rawClient } from "../config/dynamo.js";
import "../models/index.js"; // populate the registry
import { allModels } from "./odm.js";

async function tableExists(name) {
  try {
    await rawClient.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch (err) {
    if (err.name === "ResourceNotFoundException") return false;
    throw err;
  }
}

async function createOne(model) {
  const TableName = model.tableName;
  if (await tableExists(TableName)) return { table: TableName, created: false };

  await rawClient.send(new CreateTableCommand({
    TableName,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [{ AttributeName: "_id", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "_id", KeyType: "HASH" }],
  }));
  await waitUntilTableExists({ client: rawClient, maxWaitTime: 120 }, { TableName });
  return { table: TableName, created: true };
}

export async function ensureTables() {
  const results = [];
  for (const model of allModels()) {
    // Create sequentially so we stay well under provisioning throttle limits.
    // eslint-disable-next-line no-await-in-loop
    results.push(await createOne(model));
  }
  const created = results.filter((r) => r.created);
  if (created.length) {
    console.log(`✔ Created ${created.length} DynamoDB table(s): ${created.map((r) => r.table).join(", ")}`);
  }
  return results;
}
