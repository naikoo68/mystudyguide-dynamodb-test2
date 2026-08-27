// ---------------------------------------------------------------------------
// A small Mongoose-compatibility ODM backed by AWS DynamoDB.
//
// It exposes the slice of the Mongoose API this project uses (Schema, model,
// documents with .save()/hooks/methods, and the query builder) so the existing
// controllers keep working with minimal changes.
//
// Storage model: one DynamoDB table per model, primary key `_id` (a uuid
// string). Reads other than get-by-id use Scan + in-memory filtering, which
// preserves Mongoose query semantics exactly. See README for scaling notes and
// how to introduce GSIs later.
// ---------------------------------------------------------------------------

import { v4 as uuidv4 } from "uuid";
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  ScanCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { ddb, tableName } from "../config/dynamo.js";
import {
  serialize,
  reviveDates,
  matchesFilter,
  applyUpdate,
  parseSort,
  sortItems,
  parseSelect,
  projectItem,
  isPlainObject,
} from "./helpers.js";
import { runPipeline } from "./aggregate.js";

// --------------------------- model registry --------------------------------

const byName = new Map();
const byCollection = new Map();

function pluralize(name) {
  const n = name.toLowerCase();
  if (/(s|x|z|ch|sh)$/.test(n)) return `${n}es`;
  if (/[^aeiou]y$/.test(n)) return `${n.slice(0, -1)}ies`;
  return `${n}s`;
}

// ------------------------------- Schema ------------------------------------

const TYPE_CTORS = new Map([
  [String, "String"],
  [Number, "Number"],
  [Boolean, "Boolean"],
  [Date, "Date"],
  [Object, "Mixed"],
  [Array, "Array"],
]);

// Sentinels for Mongoose-style types.
export const Types = {
  ObjectId: "ObjectId",
  Mixed: "Mixed",
};

function isTypeLike(t) {
  if (t == null) return false;
  if (TYPE_CTORS.has(t)) return true;
  if (Array.isArray(t)) return true;
  if (t instanceof Schema) return true;
  if (t === Types.ObjectId || t === Types.Mixed) return true;
  return false;
}

function kindOf(t) {
  if (Array.isArray(t)) return "array";
  if (t instanceof Schema) return "schema";
  if (TYPE_CTORS.has(t)) return TYPE_CTORS.get(t);
  if (t === Types.ObjectId) return "ObjectId";
  if (t === Types.Mixed) return "Mixed";
  return "Mixed";
}

function normalizeField(def) {
  // Array shorthand: [Type] or [subSchema]
  if (Array.isArray(def)) {
    return { kind: "array", of: def.length ? normalizeField(def[0]) : { kind: "Mixed" } };
  }
  if (def instanceof Schema) return { kind: "schema", schema: def };
  if (TYPE_CTORS.has(def) || def === Types.ObjectId || def === Types.Mixed) {
    return { kind: kindOf(def) };
  }
  if (isPlainObject(def) && def.type !== undefined && isTypeLike(def.type)) {
    const field = {
      kind: kindOf(def.type),
      ref: def.ref,
      required: def.required,
      default: def.default,
      select: def.select,
      unique: def.unique,
      validate: def.validate,
      lowercase: def.lowercase,
      uppercase: def.uppercase,
      trim: def.trim,
      enum: def.enum,
    };
    if (Array.isArray(def.type)) field.of = def.type.length ? normalizeField(def.type[0]) : { kind: "Mixed" };
    if (def.type instanceof Schema) field.schema = def.type;
    return field;
  }
  // A bare nested object literal — treat as a free-form (Mixed) subdocument.
  return { kind: "Mixed" };
}

export class Schema {
  constructor(definition = {}, options = {}) {
    this.definition = definition;
    this.options = options;
    this.timestamps = Boolean(options.timestamps);
    this.paths = {};
    this.datePaths = [];
    this.defaultExcluded = [];
    this.uniquePaths = [];
    this.methods = {};
    this.statics = {};
    this.hooks = { save: [] };

    for (const [name, def] of Object.entries(definition)) {
      const field = normalizeField(def);
      this.paths[name] = field;
      if (field.kind === "Date") this.datePaths.push(name);
      if (field.select === false) this.defaultExcluded.push(name);
      if (field.unique) this.uniquePaths.push(name);
    }
    if (this.timestamps) {
      this.datePaths.push("createdAt", "updatedAt");
    }
  }

  pre(hook, fn) {
    if (!this.hooks[hook]) this.hooks[hook] = [];
    this.hooks[hook].push(fn);
    return this;
  }

  // No-op: DynamoDB indexes are provisioned via createTables, not here.
  index() {
    return this;
  }

  set() {
    return this;
  }

  virtual() {
    // Minimal stub — return an object with set/get chaining (unused paths).
    return { get() {}, set() {} };
  }
}
Schema.Types = Types;

// ------------------------------ Document -----------------------------------

const RESERVED = new Set([
  "_model", "_data", "_modified", "_isNew", "_select",
  "save", "toObject", "toJSON", "isModified", "populate", "constructor",
  "then", "catch",
]);

class Document {
  constructor(model, data, { isNew = false, select = null } = {}) {
    this._model = model;
    this._data = data || {};
    this._modified = new Set(isNew ? Object.keys(this._data) : []);
    this._isNew = isNew;
    this._select = select;

    // Bind schema instance methods so `this` resolves to the proxy.
    const proxy = new Proxy(this, docHandler);
    for (const [name, fn] of Object.entries(model.schema.methods)) {
      this[name] = fn.bind(proxy);
    }
    return proxy;
  }

  isModified(path) {
    return this._isNew || this._modified.has(path);
  }

  async save() {
    const model = this._model;
    const proxy = new Proxy(this, docHandler);
    for (const fn of model.schema.hooks.save) {
      await runHook(fn, proxy);
    }
    applyTransforms(model.schema, this._data);
    validateDoc(model.schema, this._data);
    if (model.schema.timestamps) {
      const now = new Date();
      if (this._isNew && !this._data.createdAt) this._data.createdAt = now;
      this._data.updatedAt = now;
    }
    await model._checkUnique(this._data, this._isNew ? null : this._data._id, this._isNew ? null : this._modified);
    await model._put(this._data);
    this._isNew = false;
    this._modified.clear();
    return proxy;
  }

  toObject() {
    return projectItem(shallowClone(this._data), this._select, this._model.schema.defaultExcluded);
  }

  toJSON() {
    return this.toObject();
  }
}

const docHandler = {
  get(target, prop) {
    if (typeof prop === "symbol" || RESERVED.has(prop) || prop in target) {
      const val = target[prop];
      return typeof val === "function" ? val.bind(target) : val;
    }
    return target._data[prop];
  },
  set(target, prop, value) {
    if (typeof prop === "string" && prop.startsWith("_")) {
      target[prop] = value;
      return true;
    }
    target._data[prop] = value;
    target._modified.add(prop);
    return true;
  },
  has(target, prop) {
    return prop in target || prop in target._data;
  },
  deleteProperty(target, prop) {
    if (prop in target._data) {
      delete target._data[prop];
      target._modified.add(prop);
    }
    return true;
  },
  ownKeys(target) {
    return Reflect.ownKeys(target._data);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (prop in target._data) {
      return { enumerable: true, configurable: true, value: target._data[prop] };
    }
    return Reflect.getOwnPropertyDescriptor(target, prop);
  },
};

function shallowClone(data) {
  return { ...data };
}

function runHook(fn, ctx) {
  return new Promise((resolve, reject) => {
    let done = false;
    const next = (err) => {
      if (done) return;
      done = true;
      err ? reject(err) : resolve();
    };
    try {
      const r = fn.call(ctx, next);
      if (r && typeof r.then === "function") {
        r.then(() => { if (!done) { done = true; resolve(); } }, reject);
      }
    } catch (e) {
      reject(e);
    }
  });
}

function applyTransforms(schema, data) {
  for (const [name, field] of Object.entries(schema.paths)) {
    const v = data[name];
    if (typeof v !== "string") continue;
    let s = v;
    if (field.trim) s = s.trim();
    if (field.lowercase) s = s.toLowerCase();
    if (field.uppercase) s = s.toUpperCase();
    data[name] = s;
  }
}

function validateDoc(schema, data) {
  for (const [name, field] of Object.entries(schema.paths)) {
    const v = data[name];
    if (field.required) {
      const missing = v === undefined || v === null || v === "";
      if (missing) {
        const err = new Error(`Path \`${name}\` is required.`);
        err.name = "ValidationError";
        throw err;
      }
    }
    if (field.validate && v !== undefined) {
      const validator = typeof field.validate === "function" ? field.validate : field.validate.validator;
      if (validator && !validator.call(data, v)) {
        const err = new Error(field.validate?.message || `Validation failed for \`${name}\`.`);
        err.name = "ValidationError";
        throw err;
      }
    }
  }
}

function duplicateKeyError(path, value) {
  const err = new Error(`E11000 duplicate key error: ${path}`);
  err.code = 11000;
  err.keyPattern = { [path]: 1 };
  err.keyValue = { [path]: value };
  return err;
}

// -------------------------------- Query ------------------------------------

function normPopulate(arg, select) {
  if (typeof arg === "string") return { path: arg, select, populate: [] };
  const spec = { path: arg.path, select: arg.select, populate: [] };
  if (arg.populate) {
    const arr = Array.isArray(arg.populate) ? arg.populate : [arg.populate];
    spec.populate = arr.map((p) => normPopulate(p));
  }
  return spec;
}

class Query {
  constructor(model, filter, { one = false } = {}) {
    this._model = model;
    this._filter = filter || {};
    this._one = one;
    this._sortSpec = null;
    this._limit = null;
    this._skip = null;
    this._selectSpec = null;
    this._lean = false;
    this._populate = [];
  }

  sort(spec) { this._sortSpec = spec; return this; }
  limit(n) { this._limit = n; return this; }
  skip(n) { this._skip = n; return this; }
  select(spec) { this._selectSpec = spec; return this; }
  lean() { this._lean = true; return this; }
  populate(path, select) { this._populate.push(normPopulate(path, select)); return this; }

  then(onFulfilled, onRejected) {
    return this.exec().then(onFulfilled, onRejected);
  }
  catch(onRejected) {
    return this.exec().catch(onRejected);
  }

  async exec() {
    const model = this._model;
    const filter = this._filter;

    // Fast path: filter pins `_id` to a single string -> GetItem.
    let items;
    const idEq = typeof filter._id === "string" ? filter._id : null;
    if (idEq !== null) {
      const it = await model._get(idEq);
      items = it && matchesFilter(it, filter) ? [it] : [];
    } else {
      const all = await model._scanAll();
      items = all.filter((it) => matchesFilter(it, filter));
    }

    // Revive Date fields on working copies.
    let out = items.map((it) => reviveDates({ ...it }, model.schema.datePaths));

    if (this._sortSpec) out = sortItems(out, parseSort(this._sortSpec));
    if (this._skip) out = out.slice(this._skip);
    if (this._limit != null) out = out.slice(0, this._limit);

    if (this._populate.length) await populatePlain(out, this._populate, model);

    const select = parseSelect(this._selectSpec);
    const wrap = (obj) =>
      this._lean
        ? projectItem(obj, select, model.schema.defaultExcluded)
        : new Document(model, obj, { isNew: false, select });

    if (this._one) return out.length ? wrap(out[0]) : null;
    return out.map(wrap);
  }
}

async function populatePlain(items, specs, model) {
  for (const spec of specs) {
    const pathDef = model.schema.paths[spec.path];
    if (!pathDef) continue;
    const isArray = pathDef.kind === "array";
    // For array-of-ref fields the `ref` lives on the element definition.
    const refName = pathDef.ref || (isArray && pathDef.of && pathDef.of.ref);
    if (!refName) continue;
    const RefModel = byName.get(refName);
    if (!RefModel) continue;

    const ids = new Set();
    for (const it of items) {
      const v = it[spec.path];
      if (v == null) continue;
      if (isArray) { for (const x of v) if (x != null) ids.add(String(x)); }
      else ids.add(String(v));
    }

    const map = new Map();
    await Promise.all(
      [...ids].map(async (id) => {
        const r = await RefModel._get(id);
        if (r) map.set(id, reviveDates({ ...r }, RefModel.schema.datePaths));
      })
    );

    if (spec.populate?.length) {
      await populatePlain([...map.values()], spec.populate, RefModel);
    }

    const sel = parseSelect(spec.select);
    const project = (obj) => projectItem(obj, sel, RefModel.schema.defaultExcluded);

    for (const it of items) {
      const v = it[spec.path];
      if (v == null) { it[spec.path] = isArray ? [] : null; continue; }
      if (isArray) {
        it[spec.path] = v.map((x) => { const o = map.get(String(x)); return o ? project(o) : null; }).filter(Boolean);
      } else {
        const o = map.get(String(v));
        it[spec.path] = o ? project(o) : null;
      }
    }
  }
}

// -------------------------------- Model ------------------------------------

class Model {
  constructor(name, schema) {
    this.modelName = name;
    this.schema = schema;
    this.collection = name; // table suffix (kept readable, e.g. msg_User)
    this.tableName = tableName(name);
    for (const [k, fn] of Object.entries(schema.statics)) this[k] = fn.bind(this);
    byName.set(name, this);
    byCollection.set(name.toLowerCase(), this);
    byCollection.set(pluralize(name), this);
  }

  _applyDefaults(input) {
    const data = { ...input };
    if (!data._id) data._id = uuidv4();
    for (const [name, field] of Object.entries(this.schema.paths)) {
      if (data[name] === undefined && field.default !== undefined) {
        data[name] = typeof field.default === "function" ? field.default() : field.default;
      }
    }
    return data;
  }

  // ---- low-level DynamoDB ops ----
  async _get(id) {
    const { Item } = await ddb.send(new GetCommand({ TableName: this.tableName, Key: { _id: String(id) } }));
    return Item || null;
  }

  async _put(data) {
    await ddb.send(new PutCommand({ TableName: this.tableName, Item: serialize(data) }));
  }

  async _deleteById(id) {
    await ddb.send(new DeleteCommand({ TableName: this.tableName, Key: { _id: String(id) } }));
  }

  async _scanAll() {
    const items = [];
    let ExclusiveStartKey;
    do {
      const res = await ddb.send(new ScanCommand({ TableName: this.tableName, ExclusiveStartKey }));
      if (res.Items) items.push(...res.Items);
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  async _scanAllRevived() {
    const all = await this._scanAll();
    return all.map((it) => reviveDates({ ...it }, this.schema.datePaths));
  }

  async _batchDelete(ids) {
    for (let i = 0; i < ids.length; i += 25) {
      const chunk = ids.slice(i, i + 25);
      await ddb.send(new BatchWriteCommand({
        RequestItems: { [this.tableName]: chunk.map((id) => ({ DeleteRequest: { Key: { _id: String(id) } } })) },
      }));
    }
  }

  async _batchPut(docs) {
    for (let i = 0; i < docs.length; i += 25) {
      const chunk = docs.slice(i, i + 25);
      await ddb.send(new BatchWriteCommand({
        RequestItems: { [this.tableName]: chunk.map((d) => ({ PutRequest: { Item: serialize(d) } })) },
      }));
    }
  }

  async _checkUnique(data, excludeId, modified) {
    for (const path of this.schema.uniquePaths) {
      if (modified && excludeId && !modified.has(path)) continue;
      const value = data[path];
      if (value === undefined || value === null || value === "") continue;
      const all = await this._scanAll();
      const clash = all.find((it) => String(it[path]) === String(value) && String(it._id) !== String(excludeId));
      if (clash) throw duplicateKeyError(path, value);
    }
  }

  // ---- Mongoose-style API ----
  async create(input) {
    if (Array.isArray(input)) return Promise.all(input.map((d) => this.create(d)));
    const data = this._applyDefaults(input);
    const doc = new Document(this, data, { isNew: true });
    await doc.save();
    return doc;
  }

  async insertMany(docs, options = {}) {
    const ordered = options.ordered !== false;
    const valid = [];
    const errors = [];
    for (const input of docs) {
      const data = this._applyDefaults(input);
      applyTransforms(this.schema, data);
      try {
        validateDoc(this.schema, data);
        if (this.schema.timestamps) {
          const now = new Date();
          data.createdAt = data.createdAt || now;
          data.updatedAt = now;
        }
        valid.push(data);
      } catch (e) {
        errors.push(e);
        if (ordered) break;
      }
    }
    await this._batchPut(valid);
    const created = valid.map((d) => new Document(this, d, { isNew: false }));
    if (errors.length) {
      const err = new Error("insertMany: some documents failed validation");
      err.insertedDocs = created;
      err.writeErrors = errors;
      throw err;
    }
    return created;
  }

  find(filter) { return new Query(this, filter, { one: false }); }
  findOne(filter) { return new Query(this, filter, { one: true }); }
  findById(id) {
    if (id === null || id === undefined) return new Query(this, { _id: "\u0000__none__" }, { one: true });
    return new Query(this, { _id: String(id) }, { one: true });
  }

  async findByIdAndUpdate(id, update, options = {}) {
    return this.findOneAndUpdate({ _id: String(id) }, update, options);
  }

  async findOneAndUpdate(filter, update, options = {}) {
    const existing = await this.findOne(filter).lean();
    if (!existing) {
      if (options.upsert) {
        let data = {};
        for (const [k, v] of Object.entries(filter)) if (!isPlainObject(v) && !(v instanceof RegExp)) data[k] = v;
        applyUpdate(data, update);
        data = options.setDefaultsOnInsert ? this._applyDefaults(data) : { _id: data._id || uuidv4(), ...data };
        if (this.schema.timestamps) { const now = new Date(); data.createdAt = data.createdAt || now; data.updatedAt = now; }
        await this._put(data);
        const doc = new Document(this, reviveDates({ ...data }, this.schema.datePaths), { isNew: false });
        return doc;
      }
      return null;
    }
    const before = { ...existing };
    const updated = applyUpdate({ ...existing }, update);
    if (this.schema.timestamps) updated.updatedAt = new Date();
    await this._put(updated);
    const result = options.new ? updated : before;
    return new Document(this, reviveDates({ ...result }, this.schema.datePaths), { isNew: false });
  }

  async findByIdAndDelete(id) {
    return this.findOneAndDelete({ _id: String(id) });
  }

  async findOneAndDelete(filter) {
    const existing = await this.findOne(filter).lean();
    if (!existing) return null;
    await this._deleteById(existing._id);
    return new Document(this, reviveDates({ ...existing }, this.schema.datePaths), { isNew: false });
  }

  async updateOne(filter, update) {
    const existing = await this.findOne(filter).lean();
    if (!existing) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    const updated = applyUpdate({ ...existing }, update);
    if (this.schema.timestamps) updated.updatedAt = new Date();
    await this._put(updated);
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  }

  async updateMany(filter, update) {
    const all = await this._scanAll();
    const matched = all.filter((it) => matchesFilter(it, filter));
    for (const it of matched) {
      const updated = applyUpdate({ ...it }, update);
      if (this.schema.timestamps) updated.updatedAt = new Date();
      await this._put(updated);
    }
    return { acknowledged: true, matchedCount: matched.length, modifiedCount: matched.length };
  }

  async deleteOne(filter) {
    const existing = await this.findOne(filter).lean();
    if (!existing) return { acknowledged: true, deletedCount: 0 };
    await this._deleteById(existing._id);
    return { acknowledged: true, deletedCount: 1 };
  }

  async deleteMany(filter = {}) {
    const all = await this._scanAll();
    const matched = Object.keys(filter).length ? all.filter((it) => matchesFilter(it, filter)) : all;
    await this._batchDelete(matched.map((it) => it._id));
    return { acknowledged: true, deletedCount: matched.length };
  }

  async countDocuments(filter = {}) {
    const all = await this._scanAll();
    if (!Object.keys(filter).length) return all.length;
    return all.filter((it) => matchesFilter(it, filter)).length;
  }

  async estimatedDocumentCount() {
    return this.countDocuments();
  }

  async distinct(field, filter = {}) {
    const all = await this._scanAll();
    const matched = Object.keys(filter).length ? all.filter((it) => matchesFilter(it, filter)) : all;
    const set = new Set();
    for (const it of matched) {
      const v = it[field];
      if (Array.isArray(v)) v.forEach((x) => set.add(x));
      else if (v !== undefined) set.add(v);
    }
    return [...set];
  }

  async exists(filter) {
    const doc = await this.findOne(filter).select("_id").lean();
    return doc ? { _id: doc._id } : null;
  }

  async aggregate(pipeline) {
    const items = await this._scanAllRevived();
    const getCollection = async (name) => {
      const M = byCollection.get(String(name).toLowerCase()) || byName.get(name);
      return M ? M._scanAllRevived() : [];
    };
    return runPipeline(items, pipeline, getCollection);
  }
}

// ------------------------------- factory -----------------------------------

export function model(name, schema) {
  if (byName.has(name)) return byName.get(name);
  return new Model(name, schema);
}

export function getModel(name) {
  return byName.get(name);
}

export function allModels() {
  return [...byName.values()];
}

export { byName, byCollection };

// Default export mimics the shape of the `mongoose` module so model files can
// keep `import mongoose from "..."` with only the path changed.
const mongooseShim = { Schema, model, Types, models: byName };
export default mongooseShim;
