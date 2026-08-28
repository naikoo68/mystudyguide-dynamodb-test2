import mongoose from "../db/odm.js";

const testSeriesSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Multi-tenant owner. null/absent = platform (admin) content; a User id =
    // a client's private practice item, visible/editable only by that client.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Hierarchy: Exam → Post → Category → Test.
    exam: { type: mongoose.Schema.Types.ObjectId, ref: "Exam" },
    post: { type: mongoose.Schema.Types.ObjectId, ref: "ExamPost" },
    category: {
      type: String,
      enum: ["Full-Length", "Subject-wise", "Chapter-wise", "Previous Year"],
      required: true,
    },
    // "Practice Quizzes" section: when practice=true this item lives under a
    // PracticeStream → PracticeSubject instead of Exam → Post, and is excluded
    // from the normal Test Series listing. practiceKind is "quiz" or "test".
    practice: { type: Boolean, default: false },
    practiceKind: { type: String, enum: ["quiz", "test", "paper"], default: "test" },
    // Previous Papers extras (used when practiceKind === "paper"): the uploaded
    // question-paper PDF, the answer-key PDF, and free-text additional info that
    // students can view alongside the paper.
    paperPdfUrl: { type: String, default: "" },
    // Legacy single answer key. Kept in sync with answerKeys[0] for backward
    // compatibility; new code reads answerKeys (below).
    answerKeyPdfUrl: { type: String, default: "" },
    // Multiple answer keys (e.g. the original key plus a revised key). Each is
    // { label, url }. Admins add as many as needed; students see one button
    // per key, labelled accordingly.
    answerKeys: [
      {
        _id: false,
        label: { type: String, default: "" },
        url: { type: String, default: "" },
      },
    ],
    additionalInfo: { type: String, default: "" },
    practiceStream: { type: mongoose.Schema.Types.ObjectId, ref: "PracticeStream" },
    practiceSubject: { type: mongoose.Schema.Types.ObjectId, ref: "PracticeSubject" },
    practiceTopic: { type: mongoose.Schema.Types.ObjectId, ref: "PracticeTopic" }, // My Quiz only
    // Remembered AI generator inputs for this item, so reopening the generator
    // pre-fills the topic/subtopics — the admin/client recognises what this
    // quiz/test was built from and can continue coverage from where they left.
    aiTopic: { type: String, default: "" },
    aiSubtopics: { type: String, default: "" },
    duration: { type: Number, required: true }, // minutes
    marks: { type: Number, required: true },
    difficulty: { type: String, enum: ["Easy", "Medium", "Hard"], default: "Medium" },
    questions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Question" }],
    // Manual blueprint the admin types when creating a test: which subjects and
    // how many questions each. Just a plan/guide — questions are added manually.
    subjectPlan: [
      {
        subject: { type: String, trim: true },
        count: { type: Number, default: 0 },
      },
    ],
    negativeMarking: { type: Number, default: 0.25 },
    schedule: { type: Date },
    status: { type: String, enum: ["draft", "scheduled", "published"], default: "draft" },
    attempts: { type: Number, default: 0 },
    // Total times this quiz/test was OPENED to play, across ALL audiences
    // (students, clients, free previews and public share links). Unlike
    // publicViews (public links only), this is shown to END USERS on the play
    // page — not just to the admin.
    views: { type: Number, default: 0 },
    // Public share link. When publicShare is on, ANYONE with the publicToken
    // URL can take this test without an account or login (read-only public
    // access — attempts are graded but not stored against a user).
    publicShare: { type: Boolean, default: false },
    publicToken: { type: String, index: true, default: null },
    // Optional expiry for the public link. When set and in the past, the link
    // stops working (null = never expires).
    publicExpiresAt: { type: Date, default: null },
    // How many people OPENED the public link (counted once per browser). Lets the
    // admin see reach/impressions, not just completions.
    publicViews: { type: Number, default: 0 },
    // Cached social-preview image: a rendered card of the FIRST question, shown
    // in the WhatsApp/Facebook link preview instead of the generic logo card.
    // publicPreviewKey marks which question it was built from so it re-renders
    // only when the first question changes.
    publicPreviewImage: { type: String, default: "" },
    publicPreviewKey: { type: String, default: "" },
    // CBT (Computer-Based Test) online exam. Exams are surfaced on ONE public
    // exam-portal web page (a single shareable link). cbtEnabled = this test has
    // been ADDED to that portal; cbtLive = the admin's live on/off switch that
    // controls whether candidates can currently take it. Candidates sign in with
    // just their name + email (no OTP). Results are DEFERRED: a candidate's rank
    // and scorecard are emailed and viewable only AFTER the exam is over — i.e.
    // after cbtEndAt passes (or the admin releases results manually), so ranks
    // are final across all candidates. cbtResultsReleased latches that release
    // (also stops the exam being taken and drops it from the portal).
    cbtEnabled: { type: Boolean, default: false }, // added to the exam portal
    cbtLive: { type: Boolean, default: false }, // live on/off toggle
    cbtToken: { type: String, index: true, default: null },
    cbtRequireOtp: { type: Boolean, default: true }, // email OTP verification before taking
    // Entry control: when cbtRestrictEntry is on, only emails in cbtAllowedEmails
    // may take the exam (an admin-approved allowlist). Off = open to anyone who
    // registered on the portal.
    cbtRestrictEntry: { type: Boolean, default: false },
    // Emails granted explicit access. Doubles as a LATE-ENTRY allowlist: an
    // email here may START the exam even after the cbtEntryCloseAt cutoff has
    // passed (lets the admin re-admit a specific late candidate). When
    // cbtRestrictEntry is on, ONLY these emails may take the exam (private mode).
    cbtAllowedEmails: { type: [String], default: [] },
    // Emails that have STARTED this exam (were handed the questions). Lets the
    // admin see a live "in progress" status per candidate. Reset when the exam
    // is (re)added to the portal.
    cbtStartedEmails: { type: [String], default: [] },
    cbtStartAt: { type: Date, default: null }, // exam opens at this time (null = as soon as Live)
    cbtEntryCloseAt: { type: Date, default: null }, // LATEST time a student may START (late-entry cutoff; null = until end)
    cbtEndAt: { type: Date, default: null }, // exam end (stops taking / new entry; null = admin ends manually)
    // Result declaration mode:
    //  - "auto"   : results are declared automatically when the exam ends
    //               (at cbtEndAt) — the original behaviour.
    //  - "manual" : results are NOT declared at the end. They are declared
    //               either at cbtResultAt (a scheduled "declare results" timer,
    //               which may be later than the exam end) or when the admin
    //               clicks "Release results". If cbtResultAt is null, only the
    //               button declares them.
    cbtResultMode: { type: String, enum: ["auto", "manual"], default: "auto" },
    cbtResultAt: { type: Date, default: null }, // manual-mode scheduled result-declaration time
    cbtResultsReleased: { type: Boolean, default: false }, // results emailed + viewable
    cbtViews: { type: Number, default: 0 }, // opens (counted once per browser)
    // Per-user access control. Test series are PRIVATE by default: a new
    // student sees a test only if visibleToAll is turned on, or they have an
    // explicit access entry (visible:true, optionally time-limited).
    visibleToAll: { type: Boolean, default: false },
    // Admin "disable" switch for a practice item (quiz/test/paper). When true the
    // item is hidden from all student/public/client browse lists and cannot be
    // played, but stays visible in the admin manager so it can be re-enabled.
    disabled: { type: Boolean, default: false },
    access: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        visible: { type: Boolean, default: true },
        validUntil: { type: Date, default: null },
      },
    ],
    // Account-to-account sharing: registered users this practice item (quiz/test)
    // has been shared with. A recipient sees it (with its full Stream › Subject ›
    // Topic hierarchy) in their own dashboard and can play/take it, but cannot
    // edit it. Sharing a stream/subject/topic simply adds the recipient here on
    // every item beneath that node.
    sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

export default mongoose.model("TestSeries", testSeriesSchema);
