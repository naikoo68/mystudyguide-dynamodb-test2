import express from "express";
import mongoose from "./db/odm.js";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

// Patch Express to handle async errors globally — any async route handler or
// middleware that throws/rejects will have the error forwarded to the error
// handler automatically, without needing individual try/catch or asyncHandler
// wrappers on every route. This is equivalent to the `express-async-errors` pkg.
import Layer from "express/lib/router/layer.js";
const origHandle = Layer.prototype.handle_request;
Layer.prototype.handle_request = function handleRequest(req, res, next) {
  try {
    const ret = origHandle.call(this, req, res, next);
    if (ret && typeof ret.catch === "function") {
      ret.catch(next);
    }
  } catch (err) {
    next(err);
  }
};
const origHandleErr = Layer.prototype.handle_error;
Layer.prototype.handle_error = function handleError(err, req, res, next) {
  try {
    const ret = origHandleErr.call(this, err, req, res, next);
    if (ret && typeof ret.catch === "function") {
      ret.catch(next);
    }
  } catch (e) {
    next(e);
  }
};

import authRoutes from "./routes/authRoutes.js";
import contentRoutes from "./routes/contentRoutes.js";
import testRoutes from "./routes/testRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import storageRoutes from "./routes/storageRoutes.js";
import quizRoutes from "./routes/quizRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import setupRoutes from "./routes/setupRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import examRoutes from "./routes/examRoutes.js";
import studyRoutes from "./routes/studyRoutes.js";
import feedbackRoutes from "./routes/feedbackRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import noticeRoutes from "./routes/noticeRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import practiceRoutes from "./routes/practiceRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import companionRoutes from "./routes/companionRoutes.js";
import couponRoutes from "./routes/couponRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import studentSubscriptionRoutes from "./routes/studentSubscriptionRoutes.js";
import tenantRoutes from "./routes/tenantRoutes.js";
import instituteSignupRoutes from "./routes/instituteSignupRoutes.js";
import cbtRoutes from "./routes/cbtRoutes.js";
import facebookRoutes from "./routes/facebookRoutes.js";
import userManualRoutes from "./routes/userManualRoutes.js";
import backupRoutes from "./routes/backupRoutes.js";
import recycleBinRoutes from "./routes/recycleBinRoutes.js";
import { shareTestPreview } from "./controllers/testController.js";
import { sitemap } from "./controllers/sitemapController.js";
import { releaseEndedCbtExams } from "./controllers/cbtController.js";
import { runDueFbSchedules } from "./config/facebook.js";
import { notFound, errorHandler } from "./middleware/error.js";
import { isMailConfigured, verifyMail } from "./config/mailer.js";
import { isCloudinaryConfigured } from "./config/cloudinary.js";

import { protect, authorize } from "./middleware/auth.js";
import { resolveTenant } from "./middleware/tenant.js";

const app = express();

// Security & parsing.
// In production, restrict CORS to the configured CLIENT_URL (and common Vercel
// preview URLs). In development, allow any origin for convenience.
app.use(helmet());
// CORS. Authentication is a stateless JWT sent in the Authorization header
// (never a cookie), so the browser's same-origin policy already stops another
// site from reading a logged-in user's token or forging an authenticated
// request. CORS here is defence-in-depth, and we NEVER enable credentialed
// (cookie) CORS.
//
// Default = permissive (reflect the request origin). This is deliberate: in the
// white-label model each institute serves the app from its OWN custom domain /
// subdomain, which isn't known ahead of time, so a fixed allowlist would break
// them. To lock the API down to a known set of origins, set the env var
// CORS_ALLOWED_ORIGINS to a comma-separated list — requests from anything else
// are then refused. (CLIENT_URL is always included; Vercel/Netlify preview URLs
// are allowed; requests with no Origin — curl, mobile, server-to-server — pass.)
const allowList = [process.env.CLIENT_URL, ...(process.env.CORS_ALLOWED_ORIGINS || "").split(",")]
  .map((o) => String(o || "").trim().replace(/\/$/, ""))
  .filter(Boolean);

const corsOrigin =
  allowList.length && process.env.CORS_ALLOWED_ORIGINS
    ? (origin, callback) => {
        if (!origin) return callback(null, true); // not a browser CORS request
        const o = origin.replace(/\/$/, "");
        if (allowList.includes(o) || /\.vercel\.app$/.test(o) || /\.netlify\.app$/.test(o)) {
          return callback(null, true);
        }
        console.warn(`[CORS] blocked request from origin: ${origin}`);
        return callback(new Error("Not allowed by CORS"));
      }
    : true; // permissive (see note above)
app.use(cors({ origin: corsOrigin, credentials: false }));
// Restore endpoints accept large backup files — they attach their own 60mb JSON
// parser at the route level. Skip the global 10mb parser for them so it doesn't
// reject a big backup before the route-level parser runs.
const RESTORE_PATHS = ["/api/practice/restore/start", "/api/admin/restore/start"];
const globalJson = express.json({ limit: "10mb" });
app.use((req, res, next) => {
  if (RESTORE_PATHS.includes(req.path)) return next();
  return globalJson(req, res, next);
});
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== "test") app.use(morgan("dev"));

// Multi-tenancy: resolve the current institute (from X-Tenant header / custom
// domain / subdomain / default) and run the rest of the request inside its
// tenant context. Harmless when enforcement is off — it just annotates the
// request; the model plugin only auto-scopes queries when TENANT_ENFORCEMENT=on.
app.use(resolveTenant);

// Rate limit auth endpoints
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });

// Health check — also reports whether email (SMTP) is configured so you can
// verify your Render settings by visiting /api/health in a browser.
// It ALSO opportunistically declares any CBT results that are now due. The
// keep-alive workflow pings this endpoint regularly, so results release on
// their own (auto: at exam end · manual: at the scheduled timer) even when the
// free-tier server had been asleep and the in-process timer wasn't running —
// no admin refresh required. Throttled + fire-and-forget so health stays fast.
const DB_STATES = ["disconnected", "connected", "connecting", "disconnecting", "uninitialized"];
let lastCbtSweep = 0;
app.get("/api/health", async (req, res) => {
  const now = Date.now();
  if (now - lastCbtSweep > 60 * 1000) {
    lastCbtSweep = now;
    releaseEndedCbtExams().catch(() => {});
    runDueFbSchedules().catch(() => {}); // fire any due Facebook scheduled posts (safety net for sleepy hosts)
  }

  // Report the real database status so this endpoint is trustworthy for
  // "is the site down?" checks. readyState tells us if Mongoose thinks it's
  // connected; a short, timeout-guarded ping confirms Atlas is actually
  // answering (e.g. not paused or over-quota). Kept fast so health stays snappy.
  const state = mongoose.connection?.readyState ?? 0;
  let dbStatus = DB_STATES[state] || "unknown";
  let dbOk = state === 1;
  if (state === 1) {
    try {
      await Promise.race([
        mongoose.connection.db.admin().ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("ping timeout")), 4000)),
      ]);
      dbOk = true;
    } catch {
      dbOk = false;
      dbStatus = "unreachable";
    }
  }

  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? "ok" : "degraded",
    service: "my-study-guide-api",
    db: dbStatus,
    dbOk,
    // Bump this whenever backend code changes so we can verify Render actually
    // redeployed: open /api/health and check `version`. If it's older than the
    // latest, the backend did NOT deploy and server-side fixes aren't live.
    version: "2026-08-13-db-aware-health-v47",
    features: ["ai-scope", "ai-key-owner", "extract-batches", "matching-labels", "documents", "extract-remaining", "notes-gen", "latex-json-repair", "no-currency-dollar", "parallel-small-chunks", "provider-timeout", "addtotest-drilldown", "mytest-subjectplan", "reshuffle-subjects-questions-options", "db-indexes", "extend-verify-numeric", "extend-verify-matching-pairs", "generate-extract-formula-verify", "regenerate-question", "wrap-numeric-options-latex", "regenerate-fixall-render", "regenerate-columns-not-in-stem", "regenerate-table-not-in-stem", "regenerate-strip-list-markers", "youtube-transcript-source", "shared-link-tracker", "shared-link-opens", "youtube-innertube-retry", "cbt-online-exams", "cbt-emailed-results", "cbt-rankings", "cbt-exam-portal", "cbt-live-toggle", "cbt-deferred-results", "cbt-otp-registration", "cbt-scheduled-window", "cbt-one-attempt", "cbt-portal-registration", "cbt-portal-login-password", "cbt-student-dashboard", "cbt-reset-password", "cbt-change-password", "cbt-admin-candidates", "cbt-late-entry-cutoff", "cbt-entry-allowlist", "cbt-student-status", "cbt-late-entry-access", "cbt-manual-result-mode", "cbt-result-autorelease-on-ping"],
    mailConfigured: isMailConfigured(),
    uploadConfigured: isCloudinaryConfigured(),
  });
});

// Diagnostic: tests the SMTP login (does NOT send an email) and returns the
// real error if it fails. Protected — admin only.
app.get("/api/health/mail", protect, authorize("admin"), async (req, res) => res.json(await verifyMail()));

// Routes
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api", contentRoutes); // /subjects, /sessions, /questions
app.use("/api/tests", testRoutes);
app.use("/api/quiz", quizRoutes); // /quiz/:sessionId/submit
app.use("/api/users", userRoutes);
app.use("/api", analyticsRoutes); // /admin/analytics, /me/dashboard, /leaderboard
app.use("/api", storageRoutes); // /admin/storage — DB usage + old-attempt cleanup (admin)
app.use("/api/upload", uploadRoutes);
app.use("/api/setup", setupRoutes); // one-time bootstrap (auto-disabled after first admin)
app.use("/api/settings", settingsRoutes); // site branding & theme (public read, admin write)
app.use("/api/messages", messageRoutes); // contact-form inbox
app.use("/api", examRoutes); // /exams, /exams/:id/posts, /posts
app.use("/api", studyRoutes); // study material: institutions → subjects → classes → files
app.use("/api/feedback", feedbackRoutes); // student feedback (per-question + overall)
app.use("/api/reviews", reviewRoutes); // student/client reviews (public submit, admin approve)
app.use("/api/notices", noticeRoutes); // scrolling notice board (public read, admin write)
app.use("/api/admin", backupRoutes); // full content-library backup & restore (admin)
app.use("/api/recycle-bin", recycleBinRoutes); // content-library Recycle Bin (soft delete restore/purge)
app.use("/api/documents", documentRoutes); // standalone text documents (PDF text extraction)
app.use("/api/practice", practiceRoutes); // "Practice Quizzes" section (My Quiz / My Test Series)
app.use("/api", searchRoutes); // global metadata search (streams/subjects/topics/quizzes/tests)
app.use("/api/ai", aiRoutes); // AI question generator (admin)
app.use("/api/companion", companionRoutes); // My Study Guide Companion (browser extension bridge)
app.use("/api/coupons", couponRoutes); // discount coupons (admin manage; used at client checkout)
app.use("/api/payments", paymentRoutes); // Razorpay: create orders + config for client checkout
app.use("/api/subscriptions", subscriptionRoutes); // client self-serve upgrade/renew (works when expired)
app.use("/api/student-subscriptions", studentSubscriptionRoutes); // student self-serve subscribe/renew (works when expired)
app.use("/api/tenants", tenantRoutes); // multi-tenant SaaS: super-admin management of institutes (Phase 1 foundation)
app.use("/api/institute-signup", instituteSignupRoutes); // public paid institute self-signup → auto-provision (Phase 5)
app.use("/api/cbt", cbtRoutes); // CBT online exams (public name+email sign-in, emailed results, admin rankings)
app.use("/api/facebook", facebookRoutes); // scheduled Facebook question auto-posting (admin)
app.use("/api/manual", userManualRoutes); // editable User Manual (public read, admin write)

// Rich social preview for a shared quiz/test link (WhatsApp/Facebook crawlers).
// Serves per-item Open Graph HTML (subject, topic, name + first question) and
// redirects a human visitor on to the in-app player. Public, no auth.
app.get("/s/:token", shareTestPreview);

// Dynamic XML sitemap (served at the site root; the frontend host proxies
// /sitemap.xml here — see frontend/vercel.json). Lists the fixed public pages
// plus every real, public subject/stream/exam landing page. Public, no auth.
app.get("/sitemap.xml", sitemap);

// Errors
app.use(notFound);
app.use(errorHandler);

export default app;
