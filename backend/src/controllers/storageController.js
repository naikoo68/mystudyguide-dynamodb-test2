import mongoose from "../db/odm.js";
import Attempt from "../models/Attempt.js";
import PublicAttempt from "../models/PublicAttempt.js";
import CbtAttempt from "../models/CbtAttempt.js";

// Free-tier (M0) storage cap. The Atlas alert fires on the logical data size
// approaching this, so we show usage against it.
const LIMIT_MB = 512;
const MB = 1048576;
const toMB = (bytes) => Math.round(((bytes || 0) / MB) * 10) / 10;
const cutoffFor = (days) => new Date(Date.now() - Math.max(1, Number(days) || 90) * 86400000);

// GET /api/admin/storage?days=90
// Storage usage overview: total data size vs the 512 MB free-tier limit, the
// biggest collections, and how many old attempt records could be cleaned up.
export async function storageStats(req, res) {
  const days = Math.max(1, Math.min(3650, parseInt(req.query?.days, 10) || 90));
  const cutoff = cutoffFor(days);
  const db = mongoose.connection.db;

  const dbStats = await db.stats();
  // Per-collection sizes (data + indexes), biggest first.
  let collections = [];
  try {
    const names = (await db.listCollections().toArray()).map((c) => c.name);
    const per = await Promise.all(
      names.map(async (name) => {
        try {
          const s = await db.command({ collStats: name });
          return { name, dataMB: toMB(s.size), storageMB: toMB(s.storageSize), indexMB: toMB(s.totalIndexSize), docs: s.count || 0 };
        } catch {
          return { name, dataMB: 0, storageMB: 0, indexMB: 0, docs: 0 };
        }
      })
    );
    collections = per.sort((a, b) => (b.dataMB + b.indexMB) - (a.dataMB + a.indexMB)).slice(0, 15);
  } catch {
    collections = [];
  }

  // How many old records the cleanup would affect (so the UI can preview it).
  const [oldUser, oldPublic, oldCbt, oldCbtWithReview] = await Promise.all([
    Attempt.countDocuments({ createdAt: { $lt: cutoff } }),
    PublicAttempt.countDocuments({ createdAt: { $lt: cutoff } }),
    CbtAttempt.countDocuments({ createdAt: { $lt: cutoff } }),
    CbtAttempt.countDocuments({ createdAt: { $lt: cutoff }, review: { $exists: true } }),
  ]);

  const dataMB = toMB(dbStats.dataSize);
  const indexMB = toMB(dbStats.indexSize);
  res.set("Cache-Control", "no-store");
  res.json({
    limitMB: LIMIT_MB,
    dataMB,
    indexMB,
    storageMB: toMB(dbStats.storageSize),
    totalMB: Math.round((dataMB + indexMB) * 10) / 10, // data + indexes ~ what counts against the cap
    usedPct: Math.min(100, Math.round(((dataMB + indexMB) / LIMIT_MB) * 100)),
    objects: dbStats.objects || 0,
    collections,
    days,
    cleanup: {
      userAttempts: oldUser,
      publicAttempts: oldPublic,
      cbtAttempts: oldCbt,
      cbtWithReview: oldCbtWithReview,
    },
  });
}

// POST /api/admin/storage/cleanup
// Body: { days, userAttempts, publicAttempts, cbtAttempts, stripCbtReview }
// Deletes the selected kinds of attempt records older than `days` (and/or drops
// only the heavy `review` snapshot from old CBT attempts, keeping their scores).
export async function cleanupAttempts(req, res) {
  const b = req.body || {};
  const cutoff = cutoffFor(b.days);
  const result = { deletedUserAttempts: 0, deletedPublicAttempts: 0, deletedCbtAttempts: 0, strippedCbtReview: 0 };

  if (b.userAttempts) {
    const r = await Attempt.deleteMany({ createdAt: { $lt: cutoff } });
    result.deletedUserAttempts = r.deletedCount || 0;
  }
  if (b.publicAttempts) {
    const r = await PublicAttempt.deleteMany({ createdAt: { $lt: cutoff } });
    result.deletedPublicAttempts = r.deletedCount || 0;
  }
  if (b.cbtAttempts) {
    const r = await CbtAttempt.deleteMany({ createdAt: { $lt: cutoff } });
    result.deletedCbtAttempts = r.deletedCount || 0;
  } else if (b.stripCbtReview) {
    // Only strip the review snapshot when NOT deleting the whole attempt.
    const r = await CbtAttempt.updateMany(
      { createdAt: { $lt: cutoff }, review: { $exists: true } },
      { $unset: { review: "" } },
      { timestamps: false }
    );
    result.strippedCbtReview = r.modifiedCount || 0;
  }

  res.set("Cache-Control", "no-store");
  res.json({ message: "Cleanup complete.", ...result });
}
