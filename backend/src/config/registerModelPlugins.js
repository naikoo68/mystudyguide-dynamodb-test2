import mongoose from "../db/odm.js";
import tenantIdPlugin from "../models/plugins/tenantId.js";

// Register the tenant plugin GLOBALLY, before any model schema is compiled, so
// every model gets a `tenantId` path. This module MUST be imported ahead of the
// first model import in every entry point (server.js and any migration/seed
// script). Importing it for its side effect is enough.
mongoose.plugin(tenantIdPlugin);
