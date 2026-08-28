import { REGION, ENDPOINT, isLocal } from "./dynamo.js";
import { ensureTables } from "../db/createTables.js";

// "Connects" to DynamoDB. There is no persistent connection like MongoDB — the
// AWS SDK is request-based — so this validates configuration and makes sure
// every table exists (creating any that are missing).
export default async function connectDB() {
  try {
    await ensureTables();
    console.log(
      `✔ DynamoDB ready (region: ${REGION}${isLocal() ? `, endpoint: ${ENDPOINT}` : ""}).`
    );
  } catch (err) {
    console.error(`✖ DynamoDB initialisation error: ${err.message}`);
    if (err.name === "UnrecognizedClientException" || err.name === "CredentialsProviderError") {
      console.error("  Check your AWS credentials / region, or set DYNAMODB_ENDPOINT for DynamoDB Local.");
    }
    process.exit(1);
  }
}
