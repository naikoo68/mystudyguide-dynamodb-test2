import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// ---------------------------------------------------------------------------
// DynamoDB connection.
//
// Works against real AWS DynamoDB *and* a local DynamoDB (DynamoDB Local /
// LocalStack) so you can develop offline.
//
//   AWS_REGION            – AWS region (default "us-east-1")
//   DYNAMODB_ENDPOINT     – set to e.g. http://localhost:8000 to use DynamoDB
//                           Local. When set, dummy credentials are used so you
//                           don't need real AWS keys for local development.
//   AWS_ACCESS_KEY_ID /
//   AWS_SECRET_ACCESS_KEY – standard AWS credentials (only needed against real
//                           AWS; the default provider chain / IAM role is also
//                           honoured when these are absent).
//   DYNAMODB_TABLE_PREFIX – prefix for every table name (default "msg_"), so
//                           several environments can share one account.
// ---------------------------------------------------------------------------

export const REGION = process.env.AWS_REGION || "us-east-1";
export const ENDPOINT = process.env.DYNAMODB_ENDPOINT || undefined;
export const TABLE_PREFIX = process.env.DYNAMODB_TABLE_PREFIX || "msg_";

// Full table name for a given logical collection name.
export const tableName = (collection) => `${TABLE_PREFIX}${collection}`;

function buildClient() {
  const config = { region: REGION };
  if (ENDPOINT) {
    // Local mode — point at the local endpoint and use throw-away credentials
    // (DynamoDB Local ignores them but the SDK still requires *some* value).
    config.endpoint = ENDPOINT;
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "local",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "local",
    };
  } else if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    // Explicit credentials from the environment.
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
    };
  }
  // Otherwise fall back to the default AWS provider chain (IAM role, shared
  // credentials file, SSO, etc.).
  return new DynamoDBClient(config);
}

export const rawClient = buildClient();

// DocumentClient handles JS <-> DynamoDB attribute-value marshalling for us.
export const ddb = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: {
    // Drop `undefined` values instead of erroring (Mongoose simply omits them).
    removeUndefinedValues: true,
    // Convert class instances (our Documents) to plain maps when writing.
    convertClassInstanceToMap: true,
  },
  unmarshallOptions: {
    // Keep large numbers as JS numbers (all our numeric fields are small).
    wrapNumbers: false,
  },
});

export function isLocal() {
  return Boolean(ENDPOINT);
}
