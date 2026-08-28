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

// Ordered list of home-page sections with visibility (admin drag-to-reorder).
const homeSectionSchema = new mongoose.Schema(
  { key: { type: String }, visible: { type: Boolean, default: true } },
  { _id: false }
);
const DEFAULT_HOME_SECTIONS = ["hero", "stats", "quickAccess", "features", "howItWorks", "cta"].map((key) => ({ key, visible: true }));

// Singleton site-wide settings the admin can customise.
const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "site", unique: true },
    // One-time migration flag: existing test series were made private-by-default.
    testsPrivatized: { type: Boolean, default: false },
    siteName: { type: String, default: "My Study Guide" },
    tagline: { type: String, default: "Prepare Smart, Achieve More." },
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
    aboutStats: {
      type: [aboutStatSchema],
      default: () => [
        { value: "1,20,000+", label: "Total Students" },
        { value: "8,500+", label: "Total Quizzes" },
        { value: "640+", label: "Total Test Series" },
      ],
    },
  },
  { timestamps: true }
);

export default mongoose.model("Settings", settingsSchema);
