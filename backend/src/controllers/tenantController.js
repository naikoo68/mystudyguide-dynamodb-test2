import mongoose from "../db/odm.js";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import Question from "../models/Question.js";
import TestSeries from "../models/TestSeries.js";
import { runUnscoped } from "../utils/tenantContext.js";
import { clearTenantCache } from "../middleware/tenant.js";

// Super-admin management of tenants (institutes) + the super-admin console data
// (per-institute stats, create an institute admin). All routes run behind
// [protect, superAdminOnly] — never an institute_admin action.
//
// Counts are gathered with runUnscoped() so they aggregate ACROSS institutes
// regardless of the current request's tenant context.

const RESERVED_SLUGS = new Set([
  "www", "api", "app", "admin", "mail", "static", "assets", "cdn", "help",
  "support", "status", "blog", "docs", "dashboard", "login", "signup",
]);

const normSlug = (s) =>
  String(s || "").toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

const sanitize = (t, stats) => ({
  id: t._id,
  name: t.name,
  slug: t.slug,
  customDomain: t.customDomain || "",
  status: t.status,
  isDefault: !!t.isDefault,
  ownerName: t.ownerName || "",
  ownerEmail: t.ownerEmail || "",
  subscriptionPlan: t.subscriptionPlan,
  isTrial: t.isTrial,
  expiresAt: t.expiresAt,
  createdAt: t.createdAt,
  features: t.features || {},
  ...(stats ? { stats } : {}),
});

// Build { [tenantId]: { students, instituteAdmins, clients, questions, tests } }
// for the given tenant ids, aggregating across all institutes.
async function statsFor(ids) {
  if (!ids.length) return {};
  const [userAgg, qAgg, tAgg] = await runUnscoped(() =>
    Promise.all([
      User.aggregate([
        { $match: { tenantId: { $in: ids } } },
        { $group: { _id: { t: "$tenantId", r: "$role" }, c: { $sum: 1 } } },
      ]),
      Question.aggregate([{ $match: { tenantId: { $in: ids } } }, { $group: { _id: "$tenantId", c: { $sum: 1 } } }]),
      TestSeries.aggregate([{ $match: { tenantId: { $in: ids } } }, { $group: { _id: "$tenantId", c: { $sum: 1 } } }]),
    ])
  );
  const out = {};
  const ensure = (id) => (out[id] ||= { students: 0, instituteAdmins: 0, clients: 0, questions: 0, tests: 0 });
  for (const r of userAgg) {
    const s = ensure(String(r._id.t));
    if (r._id.r === "student") s.students += r.c;
    else if (r._id.r === "institute_admin") s.instituteAdmins += r.c;
    else if (r._id.r === "client") s.clients += r.c;
  }
  for (const r of qAgg) ensure(String(r._id)).questions += r.c;
  for (const r of tAgg) ensure(String(r._id)).tests += r.c;
  return out;
}

// GET /api/tenants — list all institutes (newest first) with per-institute stats.
export async function listTenants(req, res) {
  const search = String(req.query.search || "").trim();
  const filter = { deleted: { $ne: true } };
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: rx }, { slug: rx }, { ownerEmail: rx }];
  }
  const tenants = await runUnscoped(() => Tenant.find(filter).sort("-createdAt").lean());
  const stats = await statsFor(tenants.map((t) => t._id));
  res.json({ tenants: tenants.map((t) => sanitize(t, stats[String(t._id)] || {})), total: tenants.length });
}

// GET /api/tenants/:id
export async function getTenant(req, res) {
  const t = await runUnscoped(() => Tenant.findById(req.params.id));
  if (!t || t.deleted) return res.status(404).json({ message: "Tenant not found" });
  const stats = await statsFor([t._id]);
  res.json(sanitize(t, stats[String(t._id)] || {}));
}

// POST /api/tenants — create an institute (super-admin, manual).
export async function createTenant(req, res) {
  try {
    const name = String(req.body?.name || "").trim();
    const slug = normSlug(req.body?.slug || name);
    if (!name) return res.status(400).json({ message: "Institute name is required" });
    if (!slug) return res.status(400).json({ message: "A valid subdomain is required" });
    if (RESERVED_SLUGS.has(slug)) return res.status(409).json({ message: "That subdomain is reserved. Please choose another." });

    const exists = await runUnscoped(() => Tenant.findOne({ slug }));
    if (exists) return res.status(409).json({ message: "That subdomain is already taken" });

    const t = await Tenant.create({
      name,
      slug,
      ownerName: String(req.body?.ownerName || "").trim(),
      ownerEmail: String(req.body?.ownerEmail || "").toLowerCase().trim(),
      status: req.body?.status === "active" ? "active" : "pending",
    });
    return res.status(201).json(sanitize(t));
  } catch (e) {
    // Always respond — never let an error leave the request hanging.
    if (e?.code === 11000) return res.status(409).json({ message: "That subdomain is already in use." });
    return res.status(500).json({ message: e.message || "Could not create the institute." });
  }
}

// PATCH /api/tenants/:id/status — activate / suspend an institute.
export async function updateTenantStatus(req, res) {
  const status = String(req.body?.status || "");
  if (!["pending", "active", "suspended"].includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }
  const t = await runUnscoped(() => Tenant.findById(req.params.id));
  if (!t || t.deleted) return res.status(404).json({ message: "Tenant not found" });
  t.status = status;
  await t.save();
  res.json(sanitize(t));
}

// PATCH /api/tenants/:id/features — set which features this institute can use.
// Body: { features: { <featureKey>: true|false, … } }. Stored as-is; the front
// end treats a missing/true key as enabled and false as hidden. Super-admin only.
export async function updateTenantFeatures(req, res) {
  const input = req.body?.features;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return res.status(400).json({ message: "features must be an object of key → boolean." });
  }
  // Coerce every value to a strict boolean so we never store junk.
  const features = {};
  for (const [k, v] of Object.entries(input)) features[String(k)] = v !== false;

  const t = await runUnscoped(() => Tenant.findById(req.params.id));
  if (!t || t.deleted) return res.status(404).json({ message: "Tenant not found" });
  t.features = features;
  t.markModified("features"); // Mixed type — tell Mongoose it changed
  await t.save();
  clearTenantCache(); // so the institute admin picks up the change on next load
  res.json(sanitize(t));
}

// PATCH /api/tenants/features — set the SAME feature access on EVERY institute
// at once (all non-default, non-deleted tenants). Body: { features: {...} }.
// Overwrites each institute's individual feature settings. Super-admin only.
export async function updateAllTenantsFeatures(req, res) {
  const input = req.body?.features;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return res.status(400).json({ message: "features must be an object of key → boolean." });
  }
  const features = {};
  for (const [k, v] of Object.entries(input)) features[String(k)] = v !== false;

  const result = await runUnscoped(() =>
    Tenant.updateMany({ isDefault: { $ne: true }, deleted: { $ne: true } }, { $set: { features } })
  );
  clearTenantCache();
  res.json({ ok: true, updated: result?.modifiedCount ?? 0, features });
}

// Basic hostname validation (a registrable domain, e.g. exam.brightfuture.com).
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const cleanDomain = (d) =>
  String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");

// PATCH /api/tenants/:id/domain — set or clear an institute's custom domain.
// Super-admin only. The institute must then point that domain's DNS at the
// platform (and the frontend host must serve it with SSL) — see the response's
// `dns` guidance. resolveTenant already maps a matching Host → this tenant.
export async function setTenantDomain(req, res) {
  try {
  const t = await runUnscoped(() => Tenant.findById(req.params.id));
  if (!t || t.deleted) return res.status(404).json({ message: "Tenant not found" });

  const domain = cleanDomain(req.body?.customDomain);

  if (!domain) {
    // UNSET the field (don't store "") so the sparse unique index ignores it.
    await runUnscoped(() => Tenant.updateOne({ _id: t._id }, { $unset: { customDomain: 1 } }));
    clearTenantCache();
    t.customDomain = undefined;
    return res.json(sanitize(t));
  }

  if (!DOMAIN_RE.test(domain)) {
    return res.status(400).json({ message: "Enter a valid domain, e.g. exam.yourinstitute.com" });
  }
  // Never allow claiming the platform's own domain / a subdomain of it.
  const root = String(process.env.ROOT_DOMAIN || "").toLowerCase().replace(/^\./, "");
  if (root && (domain === root || domain.endsWith("." + root))) {
    return res.status(400).json({ message: "Use a domain the institute owns — not the platform domain." });
  }
  const taken = await runUnscoped(() =>
    Tenant.findOne({ customDomain: domain, _id: { $ne: t._id }, deleted: { $ne: true } }).select("_id")
  );
  if (taken) return res.status(409).json({ message: "That domain is already used by another institute." });

  t.customDomain = domain;
  await t.save();
  clearTenantCache(); // so the new mapping takes effect immediately

  return res.json({
    ...sanitize(t),
    // DNS the institute must configure for the domain to resolve here.
    dns: {
      cname: { host: domain, pointsTo: root ? `app.${root}` : "your platform frontend host" },
      note: "Add this domain in your frontend host (e.g. Vercel) so it's served with SSL. Apex domains may need an A record instead of CNAME — follow your host's instructions.",
    },
  });
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ message: "That domain is already used by another institute." });
    return res.status(500).json({ message: e.message || "Could not update the custom domain." });
  }
}

// POST /api/tenants/:id/admin — create an INSTITUTE ADMIN for a tenant.
export async function createTenantAdmin(req, res) {
  try {
    const t = await runUnscoped(() => Tenant.findById(req.params.id));
    if (!t || t.deleted) return res.status(404).json({ message: "Tenant not found" });

    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").toLowerCase().trim();
    const password = String(req.body?.password || "");
    if (!name || !email || !password) return res.status(400).json({ message: "Name, email and password are required" });
    if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

    const exists = await runUnscoped(() => User.findOne({ email }).select("_id"));
    if (exists) return res.status(409).json({ message: "Email already registered" });

    // Explicit tenantId (not from context) — this admin belongs to THIS institute.
    const user = await runUnscoped(() =>
      User.create({ name, email, password, role: "institute_admin", tenantId: t._id, isEmailVerified: true })
    );
    return res.status(201).json({ id: user._id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId });
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ message: "That email is already registered." });
    return res.status(500).json({ message: e.message || "Could not create the institute admin." });
  }
}

// DELETE /api/tenants/:id — PERMANENTLY delete an institute and ALL of its data.
// Super-admin only. This removes every document belonging to the institute
// (its admins, students, clients, questions, tests, settings, attempts, …)
// across every collection that carries a tenantId, then removes the institute
// record itself so the subdomain/slug becomes available again. Irreversible.
// The default (platform) institute can never be deleted.
export async function deleteTenant(req, res) {
  try {
    const t = await runUnscoped(() => Tenant.findById(req.params.id));
    if (!t || t.deleted) return res.status(404).json({ message: "Tenant not found" });
    if (t.isDefault) return res.status(400).json({ message: "The default institute can't be deleted." });

    const tenantId = t._id;
    const purged = {};

    await runUnscoped(async () => {
      // Purge this institute's data from every collection that is tenant-scoped.
      // We iterate registered models (skipping the Tenant registry itself) and
      // delete only rows stamped with THIS tenantId — other institutes and the
      // platform (default tenant) are untouched.
      for (const name of mongoose.modelNames()) {
        if (name === "Tenant") continue;
        const Model = mongoose.model(name);
        if (!Model?.schema?.path("tenantId")) continue;
        try {
          const r = await Model.deleteMany({ tenantId });
          if (r?.deletedCount) purged[name] = r.deletedCount;
        } catch {
          /* skip a model that can't be bulk-deleted; continue with the rest */
        }
      }
      // Finally remove the institute record so its slug/domain frees up.
      await Tenant.deleteOne({ _id: tenantId });
    });

    clearTenantCache(); // drop any cached host/slug → tenant mapping immediately
    return res.json({ ok: true, id: String(tenantId), purged });
  } catch (e) {
    return res.status(500).json({ message: e.message || "Could not delete the institute." });
  }
}
