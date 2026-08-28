import mongoose from "../db/odm.js";

const socialSchema = new mongoose.Schema(
  { platform: { type: String, default: "website" }, url: { type: String, default: "" } },
  { _id: false }
);

const contactSchema = new mongoose.Schema(
  { type: { type: String, default: "email" }, value: { type: String, default: "" } },
  { _id: false }
);

const aboutValueSchema = new mongoose.Schema(
  { title: { type: String, default: "" }, desc: { type: String, default: "" } },
  { _id: false }
);

const aboutStatSchema = new mongoose.Schema(
  { value: { type: String, default: "" }, label: { type: String, default: "" }, metric: { type: String, default: "" } },
  { _id: false }
);

// Student testimonials shown on the home page (admin-editable).
const testimonialSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },   // student name
    exam: { type: String, default: "" },   // exam cleared / role, e.g. "NEET 2025"
    text: { type: String, default: "" },   // the quote
    rating: { type: Number, default: 5 },  // 1–5 stars
    photo: { type: String, default: "" },  // optional image URL / base64
  },
  { _id: false }
);

// Ordered list of home-page sections with visibility (admin drag-to-reorder).
const homeSectionSchema = new mongoose.Schema(
  { key: { type: String }, visible: { type: Boolean, default: true } },
  { _id: false }
);

// Admin-editable announcement shown in the client welcome popup (the modal that
// appears every time a client opens their workspace).
const clientAnnouncementSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    title: { type: String, default: "" },
    message: { type: String, default: "" },
  },
  { _id: false }
);

// One admin-editable FAQ entry (question + answer) for the public /faq page.
const faqItemSchema = new mongoose.Schema(
  { q: { type: String, default: "" }, a: { type: String, default: "" } },
  { _id: false }
);

// FAQ content for the public /faq page, grouped by audience. Empty arrays mean
// "use the built-in default FAQs" — the front end falls back to its defaults
// per audience, so leaving an audience blank keeps the shipped questions.
const faqsSchema = new mongoose.Schema(
  {
    student: { type: [faqItemSchema], default: () => [] },
    creator: { type: [faqItemSchema], default: () => [] },
    institute: { type: [faqItemSchema], default: () => [] },
  },
  { _id: false }
);

// A client subscription plan (admin-managed). Carries BOTH pricing
// (label/months/price) AND the AI generation limits granted to a client on the
// plan (maxPerBatch per generation, perWindow questions per windowMinutes).
const clientPlanSchema = new mongoose.Schema(
  {
    key: { type: String, default: "" }, // stable id (e.g. "1m"); referenced by user.subscriptionPlan
    label: { type: String, default: "Plan" },
    cycle: { type: String, default: "" }, // billing group: Monthly | Quarterly | Semi-Annually | Yearly | Trial (blank = inferred from months)
    months: { type: Number, default: 1 },
    // Free-trial length in DAYS. Only used when this is the trial plan
    // (months = 0). 0 = fall back to the built-in default.
    days: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    trial: { type: Boolean, default: false },
    maxPerBatch: { type: Number, default: 50 },
    perWindow: { type: Number, default: 100 },
    windowMinutes: { type: Number, default: 5 },
  },
  { _id: false }
);
// A STUDENT subscription plan (admin-managed). Students don't get the AI
// generator, so a student plan carries ONLY pricing (label/months/price) — no
// AI limits (unlike clientPlanSchema above).
const studentPlanSchema = new mongoose.Schema(
  {
    key: { type: String, default: "" }, // stable id (e.g. "1m"); referenced by user.studentPlan
    label: { type: String, default: "Plan" },
    cycle: { type: String, default: "" }, // Monthly | Quarterly | Semi-Annually | Yearly | Trial (blank = inferred from months)
    months: { type: Number, default: 1 },
    // Free-trial length in DAYS. Only used when this is the trial plan
    // (months = 0). 0 = fall back to the built-in default.
    days: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    trial: { type: Boolean, default: false },
  },
  { _id: false }
);
const DEFAULT_HOME_SECTIONS = ["hero", "stats", "quickAccess", "features", "howItWorks", "testimonials", "cta"].map((key) => ({ key, visible: true }));

// Singleton site-wide settings the admin can customise.
const settingsSchema = new mongoose.Schema(
  {
    // NOT globally unique anymore: each tenant has its own "site" settings doc.
    // Uniqueness is enforced per-tenant by the compound index defined below.
    key: { type: String, default: "site" },
    // One-time migration flag: existing test series were made private-by-default.
    testsPrivatized: { type: Boolean, default: false },
    // One-time migration flag: existing client accounts were granted AI access
    // (every subscription plan includes AI limits, so any active client may use
    // the generator unless an admin explicitly turns it off afterwards).
    aiClientAccessBackfilled: { type: Boolean, default: false },
    aiClientGeneratorBackfilled: { type: Boolean, default: false },
    creatorGuideGrandfathered: { type: Boolean, default: false },
    // One-time flag: existing data was assigned to the default tenant (Phase 2
    // multi-tenancy backfill). Prevents the startup backfill from repeating.
    tenantsBackfilled: { type: Boolean, default: false },
    // First-run setup wizard: an institute admin is walked through branding,
    // company/contact and policy setup right after signup. Set true once they
    // finish (or skip the optional final step) so it won't auto-open again.
    onboardingCompleted: { type: Boolean, default: false },
    // Per-institute legal/resource page content. When set, the Privacy / Terms /
    // Refund pages render this text instead of the generic default copy.
    privacyPolicy: { type: String, default: "" },
    termsOfService: { type: String, default: "" },
    refundPolicy: { type: String, default: "" },
    siteName: { type: String, default: "My Study Guide" },
    tagline: { type: String, default: "Prepare Smart, Achieve More." },
    // Home-page hero content (the big banner). Blank = fall back to the built-in
    // default copy on the front end, so an institute can leave them or customise.
    heroBadge: { type: String, default: "" },   // small pill above the headline
    heroTitle: { type: String, default: "" },   // the big headline
    heroSubtitle: { type: String, default: "" }, // the paragraph under the headline
    logoUrl: { type: String, default: "" }, // image URL or base64 data URI
    primaryColor: { type: String, default: "#2563eb" },
    accentColor: { type: String, default: "#f97316" },
    fontFamily: { type: String, default: "Inter" },
    // ---- Navbar (header) appearance ----
    navHeight: { type: Number, default: 64 }, // px
    navBrandSize: { type: Number, default: 18 }, // site-name font size (px)
    navFontSize: { type: Number, default: 14 }, // menu link font size (px)
    navFontWeight: { type: String, default: "500" }, // 400 | 500 | 600 | 700
    navFontFamily: { type: String, default: "" }, // "" = use site font
    navTextTransform: { type: String, default: "none" }, // none | uppercase | capitalize
    defaultZoom: { type: Number, default: 80 }, // default page zoom % for new visitors (50–200)
    // Screenshot watermark shown over quiz/test question pages.
    watermarkEnabled: { type: Boolean, default: true },
    watermarkText: { type: String, default: "" }, // "" = use "<siteName> ©"
    watermarkOpacity: { type: Number, default: 10 }, // % (2–60)
    watermarkSize: { type: Number, default: 14 }, // px (8–48)
    watermarkMode: { type: String, default: "always" }, // "always" | "screenshot" (best-effort)
    restrictCopy: { type: Boolean, default: true }, // block copy/right-click/selection for students
    screenshotGuard: { type: Boolean, default: false }, // hide content when window loses focus (anti-screenshot, desktop best-effort)
    statsAuto: { type: Boolean, default: true }, // true = live counts, false = manual aboutStats values
    guardHoldMs: { type: Number, default: 1500 }, // how long the screen-guard cover stays after a screenshot key (ms)
    // Email + notice-board announcement when a new quiz/test is added.
    notifyOnNewContent: { type: Boolean, default: false },
    // Platform-wide public visibility switches. When OFF, the corresponding
    // account type is hidden everywhere on the PUBLIC site (sign-up tabs,
    // pricing audience, sign-in links) and its register route is blocked, so
    // visitors can't discover or join that feature. Default ON.
    publicClientEnabled: { type: Boolean, default: true },
    publicInstituteEnabled: { type: Boolean, default: true },
    // Welcome popup shown to clients each time they open their workspace.
    clientAnnouncement: {
      type: clientAnnouncementSchema,
      default: () => ({ enabled: false, title: "", message: "" }),
    },
    // ---- Facebook Page auto-posting (Graph API) ----
    fbEnabled: { type: Boolean, default: false }, // master on/off for Facebook posting
    fbPageId: { type: String, default: "" }, // the Facebook Page's numeric ID
    fbPageAccessToken: { type: String, default: "" }, // SENSITIVE — long-lived Page access token; never sent to the browser
    fbAutoOnNotice: { type: Boolean, default: false }, // auto-post to the Page whenever a Notice is added
    fbGraphVersion: { type: String, default: "v21.0" }, // Graph API version
    // Hashtags: a global set appended to EVERY question post, plus auto tags
    // generated from each question's subject/topic/section.
    fbDefaultHashtags: { type: String, default: "" },
    fbAutoHashtags: { type: Boolean, default: true },
    // Extra Facebook Pages to cross-post to (each needs its OWN page token).
    // Facebook GROUPS cannot be posted to via the API (deprecated), so only
    // Pages you manage can be added here.
    fbExtraTargets: {
      type: [new mongoose.Schema({ label: { type: String, default: "" }, pageId: { type: String, default: "" }, token: { type: String, default: "" } }, { _id: false })],
      default: () => [],
    },
    // Selfie watermark overlaid on every Facebook/Instagram image post.
    // Stored as a Cloudinary URL after the admin uploads their photo.
    fbSelfieWatermarkUrl: { type: String, default: "" },
    fbSelfieWatermarkEnabled: { type: Boolean, default: true },
    fbSelfieWatermarkPosition: { type: String, default: "bottom-right" }, // bottom-right | bottom-left | top-right | top-left
    fbSelfieWatermarkSize: { type: Number, default: 120 }, // px (diameter/width of the watermark)
    fbSelfieWatermarkOpacity: { type: Number, default: 90 }, // % (10–100)
    fbSelfieWatermarkShape: { type: String, default: "circle" }, // circle | rectangle
    // Instagram cross-posting (uses the same Page token; IG account linked to the Page)
    igEnabled: { type: Boolean, default: false },
    igUserId: { type: String, default: "" }, // Instagram Business account id (blank = auto-detect from the Page)
    // ---- Google Drive backup ----
    // OAuth Web Client ID (from Google Cloud Console). NOT a secret — it is meant
    // to be public in the browser. When set, the "Back up / Restore to Google
    // Drive" buttons turn on for admins and clients. Blank = feature hidden.
    // White-label buyers paste their own Client ID here.
    googleClientId: { type: String, default: "" },
    socialLinks: {
      type: [socialSchema],
      default: () => [
        { platform: "facebook", url: "" },
        { platform: "instagram", url: "" },
        { platform: "whatsapp", url: "" },
        { platform: "youtube", url: "" },
      ],
    },
    contacts: {
      type: [contactSchema],
      default: () => [
        { type: "email", value: "hello@mystudyguide.com" },
        { type: "phone", value: "+91 98765 43210" },
        { type: "address", value: "Knowledge Park, New Delhi, India" },
      ],
    },
    // Editable "About Us" page content
    aboutHeading: { type: String, default: "Built by educators, loved by toppers" },
    aboutIntro: {
      type: String,
      default:
        "My Study Guide started with one belief — that smart, structured practice beats endless cramming. We combine curated question banks with real-time analytics to help you study exactly what matters.",
    },
    aboutValues: {
      type: [aboutValueSchema],
      default: () => [
        { title: "Our Mission", desc: "Make high-quality exam preparation accessible and affordable for every student." },
        { title: "Our Vision", desc: "Become the most trusted self-study companion powered by data-driven learning." },
        { title: "Our Promise", desc: "Honest content, transparent analytics and relentless focus on student outcomes." },
      ],
    },
    homeSections: {
      type: [homeSectionSchema],
      default: () => DEFAULT_HOME_SECTIONS,
    },
    // ---- AI generation limits ----
    // The admin's own per-batch cap AND the hard ceiling no plan can exceed.
    aiMaxPerBatch: { type: Number, default: 500 },
    // Client subscription plans (pricing + AI limits). A client's AI limits come
    // from the plan they purchased (user.subscriptionPlan). Registration,
    // checkout and upgrade all read these. Defaults mirror the original prices.
    clientPlans: {
      type: [clientPlanSchema],
      default: () => [
        { key: "trial", label: "1-Day Free Trial", cycle: "Trial", months: 0, price: 0, trial: true, maxPerBatch: 50, perWindow: 50, windowMinutes: 5 },
        { key: "1m", label: "1 Month", cycle: "Monthly", months: 1, price: 299, maxPerBatch: 50, perWindow: 100, windowMinutes: 5 },
        { key: "2m", label: "2 Months", cycle: "Monthly", months: 2, price: 499, maxPerBatch: 100, perWindow: 200, windowMinutes: 5 },
        { key: "6m", label: "6 Months", cycle: "Semi-Annually", months: 6, price: 699, maxPerBatch: 200, perWindow: 400, windowMinutes: 5 },
        { key: "1y", label: "1 Year", cycle: "Yearly", months: 12, price: 899, maxPerBatch: 500, perWindow: 1000, windowMinutes: 5 },
      ],
    },
    // Student subscription plans (pricing only — students have no AI generator).
    // A student unlocks quiz/test attempts + their performance Dashboard while
    // their plan is active. Registration is free; students subscribe from the
    // paywall / pricing page.
    studentPlans: {
      type: [studentPlanSchema],
      default: () => [
        { key: "trial", label: "1-Day Free Trial", cycle: "Trial", months: 0, price: 0, trial: true },
        { key: "1m", label: "1 Month", cycle: "Monthly", months: 1, price: 149 },
        { key: "3m", label: "3 Months", cycle: "Quarterly", months: 3, price: 399 },
        { key: "6m", label: "6 Months", cycle: "Semi-Annually", months: 6, price: 699 },
        { key: "1y", label: "1 Year", cycle: "Yearly", months: 12, price: 899 },
      ],
    },
    // Institute (tenant) subscription plans — what an institute pays to run its
    // own space on the platform (used by the public institute self-signup).
    // Pricing only. Lives on the DEFAULT tenant's settings (the platform level).
    tenantPlans: {
      type: [studentPlanSchema],
      default: () => [
        { key: "trial", label: "14-Day Free Trial", cycle: "Trial", months: 0, price: 0, trial: true },
        { key: "1m", label: "1 Month", cycle: "Monthly", months: 1, price: 1499 },
        { key: "6m", label: "6 Months", cycle: "Semi-Annually", months: 6, price: 6999 },
        { key: "1y", label: "1 Year", cycle: "Yearly", months: 12, price: 11999 },
      ],
    },
    aboutStats: {
      type: [aboutStatSchema],
      default: () => [
        { value: "1,20,000+", label: "Total Students" },
        { value: "8,500+", label: "Total Quizzes" },
        { value: "640+", label: "Total Test Series" },
      ],
    },
    // Admin-editable FAQ content for the public /faq page, per audience
    // (Students / Creators / Institutes). Any audience left empty falls back to
    // the front end's built-in default questions for that audience.
    faqs: {
      type: faqsSchema,
      default: () => ({ student: [], creator: [], institute: [] }),
    },
    // Student testimonials for the home page.
    testimonials: {
      type: [testimonialSchema],
      default: () => [
        { name: "Aisha Khan", exam: "Cleared SSC CGL 2025", rating: 5, text: "The subject-wise quizzes and instant solutions made my revision so much faster. The analytics showed exactly where I was weak.", photo: "" },
        { name: "Rahul Verma", exam: "NEET Aspirant", rating: 5, text: "Full-length mock tests feel just like the real exam. Timers, palette, auto-submit — everything is spot on.", photo: "" },
        { name: "Sneha Patil", exam: "State PSC 2025", rating: 5, text: "I love that I can practise for free and track my rank. It kept me motivated every single day.", photo: "" },
      ],
    },
  },
  { timestamps: true }
);

// Per-tenant uniqueness: one settings doc per (tenant, key). Replaces the old
// global-unique index on `key` (dropped at startup — see ensureSettingsIndexes
// in server.js) so each institute can have its own "site" settings document.
settingsSchema.index({ tenantId: 1, key: 1 }, { unique: true });

export default mongoose.model("Settings", settingsSchema);
