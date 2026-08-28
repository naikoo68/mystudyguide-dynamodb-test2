import mongoose from "../../db/odm.js";
import { getCurrentTenantId, isUnscoped } from "../../utils/tenantContext.js";

// Global Mongoose plugin. Adds an optional `tenantId` to every model schema so
// records can be scoped to an institute (tenant). Applied globally in
// config/registerModelPlugins.js BEFORE any model schema is compiled.
//
// Two responsibilities:
//   (A) ALWAYS: add the `tenantId` field (Phase 2 — non-breaking).
//   (B) WHEN ENFORCEMENT IS ON: auto-scope every query/write to the current
//       request's tenant (Phase 3), reading it from the per-request context.
//
// Enforcement is OPT-IN via TENANT_ENFORCEMENT=on (default OFF). With it off,
// only the field is added and the app behaves exactly as before — so shipping
// this is safe. With a single (default) institute it's effectively a no-op even
// when on, because all data belongs to that one tenant.
//
// Safety rules when enforcement is on:
//   - The `Tenant` registry itself is never scoped.
//   - No request context (background jobs, startup scripts) → NOT scoped
//     (fail-open) so internal maintenance still works.
//   - An explicit unscoped context (super-admin / auth lookups) → NOT scoped.
//   - A query that already targets `tenantId` is left untouched.

const ENFORCE = process.env.TENANT_ENFORCEMENT === "on";

// Query middleware operations that should be tenant-scoped.
const QUERY_OPS = [
  "count", "countDocuments", "find", "findOne",
  "findOneAndUpdate", "findOneAndDelete", "findOneAndReplace",
  "updateOne", "updateMany", "deleteOne", "deleteMany", "replaceOne",
];

// Design notes on the field:
// - NO index is declared here on purpose (a global plugin also runs on embedded
//   sub-document schemas; an index here would create junk indexes on the parent
//   at the sub-path). Real tenantId indexes are created per top-level collection
//   by the backfill (utils/backfillTenants.js).
export default function tenantIdPlugin(schema) {
  // Skip embedded sub-document schemas (they don't own a collection).
  if (schema.options && schema.options._id === false) return;
  // Don't redefine if a schema already declares it.
  if (!schema.path("tenantId")) {
    schema.add({ tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null } });
  }

  if (!ENFORCE) return; // Phase 2 behavior: field only, no scoping.

  const modelNameOfQuery = (q) => q?.model?.modelName;
  const modelNameOfAggregate = (a) => {
    try { return typeof a.model === "function" ? a.model()?.modelName : a.model?.modelName; }
    catch { return undefined; }
  };

  // Auto-scope reads/updates/deletes.
  schema.pre(QUERY_OPS, function scopeQuery() {
    if (isUnscoped()) return;
    if (modelNameOfQuery(this) === "Tenant") return;
    const tid = getCurrentTenantId();
    if (!tid) return; // no request context → don't scope (internal jobs)
    const q = this.getQuery();
    if (q.tenantId === undefined) q.tenantId = tid;
  });

  // Auto-scope aggregations by prepending a $match on tenantId.
  schema.pre("aggregate", function scopeAggregate() {
    if (isUnscoped()) return;
    if (modelNameOfAggregate(this) === "Tenant") return;
    const tid = getCurrentTenantId();
    if (!tid) return;
    const pipeline = this.pipeline();
    // Don't double-add if the caller already matches tenantId first.
    const first = pipeline[0];
    if (first && first.$match && "tenantId" in first.$match) return;
    pipeline.unshift({ $match: { tenantId: tid } });
  });

  // Stamp new documents with the current tenant on save().
  schema.pre("save", function stampOnSave() {
    if (this.tenantId) return;
    if (isUnscoped()) return;
    const tid = getCurrentTenantId();
    if (tid) this.tenantId = tid;
  });

  // Stamp bulk inserts.
  schema.pre("insertMany", function stampOnInsertMany(next, docs) {
    if (!isUnscoped()) {
      const tid = getCurrentTenantId();
      if (tid && Array.isArray(docs)) {
        for (const d of docs) if (d && d.tenantId == null) d.tenantId = tid;
      }
    }
    next();
  });
}
