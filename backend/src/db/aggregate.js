// ---------------------------------------------------------------------------
// A focused aggregation-pipeline interpreter — implements exactly the stages
// and expression operators this codebase uses:
//
//   Stages:      $match, $group, $lookup, $unwind, $sort, $limit, $skip,
//                $project, $sample, $count
//   Expressions: field refs ($path), literals, $cond, $eq/$ne/$gt/$gte/$lt/$lte,
//                $round, $sum, $avg, $max, $min, $addToSet, $first, $last
//
// Runs in memory over the full (already-loaded) collection. Correctness-first;
// see the README notes on scaling.
// ---------------------------------------------------------------------------

import { getPath, parseSort, sortItems } from "./helpers.js";

const looseEq = (a, b) => {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  if (a === b) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
};

const toNum = (v) => (v instanceof Date ? v.getTime() : Number(v));

// Evaluate an aggregation expression against a document.
function evalExpr(expr, doc) {
  if (typeof expr === "string") {
    return expr.startsWith("$") ? getPath(doc, expr.slice(1)) : expr;
  }
  if (expr === null || typeof expr !== "object" || Array.isArray(expr)) return expr;

  const [op] = Object.keys(expr);
  const arg = expr[op];
  switch (op) {
    case "$cond": {
      const [c, t, e] = Array.isArray(arg) ? arg : [arg.if, arg.then, arg.else];
      return evalExpr(c, doc) ? evalExpr(t, doc) : evalExpr(e, doc);
    }
    case "$eq": return looseEq(evalExpr(arg[0], doc), evalExpr(arg[1], doc));
    case "$ne": return !looseEq(evalExpr(arg[0], doc), evalExpr(arg[1], doc));
    case "$gt": return toNum(evalExpr(arg[0], doc)) > toNum(evalExpr(arg[1], doc));
    case "$gte": return toNum(evalExpr(arg[0], doc)) >= toNum(evalExpr(arg[1], doc));
    case "$lt": return toNum(evalExpr(arg[0], doc)) < toNum(evalExpr(arg[1], doc));
    case "$lte": return toNum(evalExpr(arg[0], doc)) <= toNum(evalExpr(arg[1], doc));
    case "$round": {
      const [v, places = 0] = Array.isArray(arg) ? arg : [arg, 0];
      const n = Number(evalExpr(v, doc)) || 0;
      const f = 10 ** places;
      return Math.round(n * f) / f;
    }
    case "$add": return arg.reduce((s, e) => s + (Number(evalExpr(e, doc)) || 0), 0);
    case "$subtract": return (Number(evalExpr(arg[0], doc)) || 0) - (Number(evalExpr(arg[1], doc)) || 0);
    case "$multiply": return arg.reduce((s, e) => s * (Number(evalExpr(e, doc)) || 0), 1);
    default:
      // A plain object literal (no operator) — return as-is.
      return expr;
  }
}

function groupStage(items, spec) {
  const groups = new Map();
  const order = [];
  for (const doc of items) {
    const key = evalExpr(spec._id, doc);
    const gk = key === null || key === undefined ? "__null__" : String(key);
    if (!groups.has(gk)) {
      groups.set(gk, { _id: key ?? null, __acc: {} });
      order.push(gk);
    }
    const g = groups.get(gk);
    for (const [field, accSpec] of Object.entries(spec)) {
      if (field === "_id") continue;
      const [accOp] = Object.keys(accSpec);
      const accArg = accSpec[accOp];
      const state = (g.__acc[field] = g.__acc[field] || { op: accOp, sum: 0, count: 0, max: undefined, min: undefined, set: [], first: undefined, last: undefined, hasFirst: false });
      const val = accOp === "$sum" && accArg === 1 ? 1 : evalExpr(accArg, doc);
      switch (accOp) {
        case "$sum": state.sum += Number(val) || 0; break;
        case "$avg": if (val != null) { state.sum += Number(val) || 0; state.count += 1; } break;
        case "$max": { const n = val instanceof Date ? val.getTime() : val; if (state.max === undefined || n > state.max) { state.max = n; state.maxRaw = val; } break; }
        case "$min": { const n = val instanceof Date ? val.getTime() : val; if (state.min === undefined || n < state.min) { state.min = n; state.minRaw = val; } break; }
        case "$addToSet": if (!state.set.some((e) => looseEq(e, val))) state.set.push(val); break;
        case "$first": if (!state.hasFirst) { state.first = val; state.hasFirst = true; } break;
        case "$last": state.last = val; break;
        default: throw new Error(`Unsupported accumulator: ${accOp}`);
      }
    }
  }
  return order.map((gk) => {
    const g = groups.get(gk);
    const out = { _id: g._id };
    for (const [field, state] of Object.entries(g.__acc)) {
      switch (state.op) {
        case "$sum": out[field] = state.sum; break;
        case "$avg": out[field] = state.count ? state.sum / state.count : 0; break;
        case "$max": out[field] = state.maxRaw ?? null; break;
        case "$min": out[field] = state.minRaw ?? null; break;
        case "$addToSet": out[field] = state.set; break;
        case "$first": out[field] = state.first ?? null; break;
        case "$last": out[field] = state.last ?? null; break;
        default: break;
      }
    }
    return out;
  });
}

function projectStage(items, spec) {
  const idExcluded = spec._id === 0 || spec._id === false;
  return items.map((doc) => {
    const out = {};
    let inclusion = false;
    for (const [k, v] of Object.entries(spec)) {
      if (v === 1 || v === true) { out[k] = getPath(doc, k); inclusion = true; }
      else if (v === 0 || v === false) { /* excluded */ }
      else { out[k] = evalExpr(v, doc); }
    }
    if (!idExcluded && inclusion && out._id === undefined && doc._id !== undefined) out._id = doc._id;
    return out;
  });
}

function unwindStage(items, spec) {
  const path = (typeof spec === "string" ? spec : spec.path).replace(/^\$/, "");
  const preserve = isPlain(spec) && spec.preserveNullAndEmptyArrays;
  const out = [];
  for (const doc of items) {
    const arr = getPath(doc, path);
    if (Array.isArray(arr)) {
      if (arr.length === 0 && preserve) out.push({ ...doc, [path]: null });
      for (const el of arr) out.push({ ...doc, [path]: el });
    } else if (arr !== undefined && arr !== null) {
      out.push(doc);
    } else if (preserve) {
      out.push(doc);
    }
  }
  return out;
}

const isPlain = (v) => v && typeof v === "object" && !Array.isArray(v);

// Run a pipeline. `getCollection(name)` returns all lean items of a collection
// (used by $lookup).
export async function runPipeline(items, pipeline, getCollection) {
  let docs = items.slice();
  for (const stage of pipeline) {
    const [op] = Object.keys(stage);
    const spec = stage[op];
    switch (op) {
      case "$match": {
        const { matchesFilter } = await import("./helpers.js");
        docs = docs.filter((d) => matchesFilter(d, spec));
        break;
      }
      case "$group": docs = groupStage(docs, spec); break;
      case "$unwind": docs = unwindStage(docs, spec); break;
      case "$project": docs = projectStage(docs, spec); break;
      case "$sort": docs = sortItems(docs, parseSort(spec)); break;
      case "$limit": docs = docs.slice(0, spec); break;
      case "$skip": docs = docs.slice(spec); break;
      case "$count": docs = [{ [spec]: docs.length }]; break;
      case "$sample": {
        const arr = docs.slice();
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        docs = arr.slice(0, spec.size);
        break;
      }
      case "$lookup": {
        const foreign = await getCollection(spec.from);
        const byKey = new Map();
        for (const f of foreign) {
          const k = String(getPath(f, spec.foreignField));
          if (!byKey.has(k)) byKey.set(k, []);
          byKey.get(k).push(f);
        }
        docs = docs.map((d) => ({
          ...d,
          [spec.as]: byKey.get(String(getPath(d, spec.localField))) || [],
        }));
        break;
      }
      default:
        throw new Error(`Unsupported aggregation stage: ${op}`);
    }
  }
  return docs;
}
