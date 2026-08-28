// ---------------------------------------------------------------------------
// Shared helpers for the Mongoose-compatibility layer over DynamoDB.
//
//   • serialize / revive  – convert Dates <-> ISO strings for storage
//   • matchesFilter        – evaluate a Mongo-style query filter in JS
//   • applyUpdate          – apply a Mongo-style update document in JS
//   • parse/apply sort & select
// ---------------------------------------------------------------------------

export const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof RegExp);

const hasOperatorKeys = (obj) => Object.keys(obj).some((k) => k.startsWith("$"));

// -------------------------- serialize / revive ----------------------------

// Deep-convert Date instances to ISO strings and drop `undefined` so the value
// is safe to store. Leaves other values untouched.
export function serialize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize).filter((v) => v !== undefined);
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const s = serialize(v);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return value;
}

// Turn stored ISO-string values back into Date objects for the schema paths
// that are declared as Dates (so `doc.expiresAt.getTime()` keeps working).
export function reviveDates(item, dateePaths) {
  if (!item) return item;
  for (const p of dateePaths) {
    const v = item[p];
    if (typeof v === "string" && v) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) item[p] = d;
    }
  }
  return item;
}

// -------------------------- filter matching -------------------------------

const toTime = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

// Loose equality that mirrors the bits of Mongo semantics this app relies on:
//   • target null      → matches null OR a missing field
//   • target Date      → compared by timestamp (values are stored as ISO)
//   • target RegExp    → tested against the string value
//   • ids / primitives → strict-ish equality (numbers vs numbers, else String)
function equals(value, target) {
  if (target === null) return value === null || value === undefined;
  if (target instanceof RegExp) return target.test(String(value ?? ""));
  if (target instanceof Date) {
    if (value === null || value === undefined) return false;
    return toTime(value) === target.getTime();
  }
  if (value === null || value === undefined) return false;
  if (typeof target === "number") return Number(value) === target;
  if (typeof target === "boolean") return value === target;
  return String(value) === String(target);
}

function compare(value, operand, op) {
  if (value === null || value === undefined) return false;
  let a = value;
  let b = operand;
  if (operand instanceof Date || (typeof operand === "string" && !Number.isNaN(Date.parse(operand)) && operand.length > 8 && operand.includes("-"))) {
    // Date-ish comparison
    a = toTime(value);
    b = toTime(operand);
  }
  switch (op) {
    case "$gt": return a > b;
    case "$gte": return a >= b;
    case "$lt": return a < b;
    case "$lte": return a <= b;
    default: return false;
  }
}

function matchCondition(value, condition) {
  // Operator object, e.g. { $in: [...] } or { $ne: true } or { $gte: date }
  if (isPlainObject(condition) && hasOperatorKeys(condition)) {
    for (const [op, operand] of Object.entries(condition)) {
      switch (op) {
        case "$eq":
          if (!equals(value, operand)) return false;
          break;
        case "$ne":
          if (equals(value, operand)) return false;
          break;
        case "$in": {
          const arr = Array.isArray(operand) ? operand : [operand];
          const values = Array.isArray(value) ? value : [value];
          if (!arr.some((t) => values.some((v) => equals(v, t)))) return false;
          break;
        }
        case "$nin": {
          const arr = Array.isArray(operand) ? operand : [operand];
          const values = Array.isArray(value) ? value : [value];
          if (arr.some((t) => values.some((v) => equals(v, t)))) return false;
          break;
        }
        case "$gt":
        case "$gte":
        case "$lt":
        case "$lte":
          if (!compare(value, operand, op)) return false;
          break;
        case "$exists": {
          const exists = value !== undefined;
          if (Boolean(operand) !== exists) return false;
          break;
        }
        case "$regex": {
          const rx = operand instanceof RegExp ? operand : new RegExp(operand, condition.$options || "");
          if (!rx.test(String(value ?? ""))) return false;
          break;
        }
        case "$options":
          break; // handled with $regex
        default:
          throw new Error(`Unsupported query operator: ${op}`);
      }
    }
    return true;
  }
  // Direct value / RegExp equality
  return equals(value, condition);
}

// Evaluate a full filter object against a stored item.
export function matchesFilter(item, filter) {
  if (!filter) return true;
  for (const [key, condition] of Object.entries(filter)) {
    if (key === "$or") {
      if (!condition.some((sub) => matchesFilter(item, sub))) return false;
      continue;
    }
    if (key === "$and") {
      if (!condition.every((sub) => matchesFilter(item, sub))) return false;
      continue;
    }
    if (key === "$nor") {
      if (condition.some((sub) => matchesFilter(item, sub))) return false;
      continue;
    }
    if (key === "$text") {
      // DynamoDB has no native full-text search. Approximate Mongo's $text with
      // an in-memory word match: the item matches if any search term appears in
      // any of its string values. (Relevance scoring / $meta is not computed.)
      if (!textMatches(item, condition && condition.$search)) return false;
      continue;
    }
    if (key === "$expr") {
      // Evaluate an aggregation-style expression against the item.
      if (!evalAggExpr(condition, item)) return false;
      continue;
    }
    const value = getPath(item, key);
    if (!matchCondition(value, condition)) return false;
  }
  return true;
}

// Read a possibly-dotted path from an object (e.g. "user.role").
export function getPath(obj, path) {
  if (!path.includes(".")) return obj?.[path];
  return path.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
}

// Gather all string values from an item (deep) into one lowercased haystack.
function collectText(value, out) {
  if (value == null) return;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectText(v, out));
  else if (isPlainObject(value)) Object.values(value).forEach((v) => collectText(v, out));
}
function textMatches(item, search) {
  if (!search) return false;
  const parts = [];
  collectText(item, parts);
  const hay = parts.join(" ").toLowerCase();
  const terms = String(search).toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length >= 2);
  return terms.some((t) => hay.includes(t));
}

// Minimal aggregation-expression evaluator for $expr in query filters.
// Supports field refs ("$path"), literals, and $eq/$ne/$gt/$gte/$lt/$lte,
// $and/$or/$not, $add/$subtract/$multiply/$divide, $in, $ifNull.
export function evalAggExpr(expr, doc) {
  if (typeof expr === "string") return expr.startsWith("$") ? getPath(doc, expr.slice(1)) : expr;
  if (expr === null || typeof expr !== "object" || Array.isArray(expr)) return expr;
  const [op] = Object.keys(expr);
  const a = expr[op];
  const num = (v) => (v instanceof Date ? v.getTime() : Number(evalAggExpr(v, doc)));
  const val = (v) => evalAggExpr(v, doc);
  switch (op) {
    case "$eq": return equals(val(a[0]), val(a[1]));
    case "$ne": return !equals(val(a[0]), val(a[1]));
    case "$gt": return num(a[0]) > num(a[1]);
    case "$gte": return num(a[0]) >= num(a[1]);
    case "$lt": return num(a[0]) < num(a[1]);
    case "$lte": return num(a[0]) <= num(a[1]);
    case "$and": return a.every((e) => val(e));
    case "$or": return a.some((e) => val(e));
    case "$not": return !val(Array.isArray(a) ? a[0] : a);
    case "$add": return a.reduce((s, e) => s + num(e), 0);
    case "$subtract": return num(a[0]) - num(a[1]);
    case "$multiply": return a.reduce((s, e) => s * num(e), 1);
    case "$divide": return num(a[0]) / num(a[1]);
    case "$in": { const [x, arr] = a; const xv = val(x); return (val(arr) || []).some((e) => equals(xv, e)); }
    case "$ifNull": { const v = val(a[0]); return v === null || v === undefined ? val(a[1]) : v; }
    default: return expr;
  }
}

// -------------------------- update application ----------------------------

function pull(arr, spec) {
  if (!Array.isArray(arr)) return arr;
  if (isPlainObject(spec) && hasOperatorKeys(spec)) {
    return arr.filter((el) => !matchCondition(el, spec));
  }
  return arr.filter((el) => !equals(el, spec));
}

// Apply a Mongo-style update document to a plain object (mutates & returns it).
// Supports: implicit $set, $set, $inc, $push (+ $each), $pull, $unset, $addToSet.
export function applyUpdate(doc, update, { insert = false } = {}) {
  const ops = Object.keys(update).filter((k) => k.startsWith("$"));
  if (!ops.length) {
    // A plain object is treated as $set (Mongoose semantics).
    Object.assign(doc, update);
    return doc;
  }
  for (const op of ops) {
    const payload = update[op];
    switch (op) {
      case "$set":
        for (const [k, v] of Object.entries(payload)) setPath(doc, k, v);
        break;
      case "$setOnInsert":
        // Only applied when a new document is being created (upsert insert).
        if (insert) for (const [k, v] of Object.entries(payload)) setPath(doc, k, v);
        break;
      case "$unset":
        for (const k of Object.keys(payload)) unsetPath(doc, k);
        break;
      case "$inc":
        for (const [k, v] of Object.entries(payload)) doc[k] = (Number(doc[k]) || 0) + v;
        break;
      case "$push":
        for (const [k, v] of Object.entries(payload)) {
          if (!Array.isArray(doc[k])) doc[k] = [];
          if (isPlainObject(v) && Array.isArray(v.$each)) doc[k].push(...v.$each);
          else doc[k].push(v);
        }
        break;
      case "$addToSet":
        for (const [k, v] of Object.entries(payload)) {
          if (!Array.isArray(doc[k])) doc[k] = [];
          const items = isPlainObject(v) && Array.isArray(v.$each) ? v.$each : [v];
          for (const it of items) if (!doc[k].some((e) => equals(e, it))) doc[k].push(it);
        }
        break;
      case "$pull":
        for (const [k, v] of Object.entries(payload)) doc[k] = pull(doc[k], v);
        break;
      default:
        throw new Error(`Unsupported update operator: ${op}`);
    }
  }
  return doc;
}

function setPath(obj, path, value) {
  if (!path.includes(".")) {
    obj[path] = value;
    return;
  }
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function unsetPath(obj, path) {
  if (!path.includes(".")) {
    delete obj[path];
    return;
  }
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(cur[parts[i]])) return;
    cur = cur[parts[i]];
  }
  delete cur[parts[parts.length - 1]];
}

// -------------------------- sort & select ---------------------------------

// Parse a sort spec: "order name", "-createdAt", or { field: 1|-1 }.
export function parseSort(spec) {
  if (!spec) return [];
  if (typeof spec === "string") {
    return spec
      .split(/\s+/)
      .filter(Boolean)
      .map((tok) => (tok.startsWith("-") ? [tok.slice(1), -1] : [tok, 1]));
  }
  // Object form — ignore $meta (textScore) entries we can't compute.
  return Object.entries(spec)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => [k, v < 0 ? -1 : 1]);
}

export function sortItems(items, sortPairs) {
  if (!sortPairs.length) return items;
  return items.sort((a, b) => {
    for (const [field, dir] of sortPairs) {
      let av = a?.[field];
      let bv = b?.[field];
      if (av instanceof Date) av = av.getTime();
      if (bv instanceof Date) bv = bv.getTime();
      if (av === bv) continue;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      if (av < bv) return dir === 1 ? -1 : 1;
      if (av > bv) return dir === 1 ? 1 : -1;
    }
    return 0;
  });
}

// Parse a select/projection spec into inclusion / exclusion / force-include
// tokens. Accepts a string ("name -email +password") OR a Mongo projection
// object ({ name: 1, email: 0, score: { $meta: "textScore" } }).
export function parseSelect(spec) {
  if (!spec) return null;
  const inc = [];
  const exc = [];
  const plus = [];
  if (typeof spec === "string") {
    for (const tok of spec.split(/\s+/).filter(Boolean)) {
      if (tok.startsWith("-")) exc.push(tok.slice(1));
      else if (tok.startsWith("+")) plus.push(tok.slice(1));
      else inc.push(tok);
    }
    return { inc, exc, plus };
  }
  if (typeof spec === "object") {
    for (const [k, v] of Object.entries(spec)) {
      if (v && typeof v === "object") continue; // e.g. { $meta: "textScore" } — can't compute
      if (v === 1 || v === true) inc.push(k);
      else if (v === 0 || v === false) exc.push(k);
    }
    return { inc, exc, plus };
  }
  return null;
}

// Project an item honouring the select spec and the schema's select:false
// defaults. `defaultExcluded` is the set of paths hidden unless asked for.
export function projectItem(item, select, defaultExcluded) {
  // Inclusion mode: plain field names were listed -> return only those (+_id).
  if (select && select.inc.length) {
    const out = { _id: item._id };
    for (const f of [...select.inc, ...select.plus]) if (item[f] !== undefined) out[f] = item[f];
    return out;
  }
  const removed = new Set(defaultExcluded);
  if (select) {
    for (const f of select.plus) removed.delete(f);
    for (const f of select.exc) removed.add(f);
  }
  const out = {};
  for (const [k, v] of Object.entries(item)) if (!removed.has(k)) out[k] = v;
  return out;
}
