import mongoose from "../db/odm.js";

// A question is either:
//  - "mcq":      4 options + a correct index
//  - "matching": two columns (A & B) shown to the student, plus answer options
//                (sequence strings like "1-III, 2-I…") with a correct index
// Text/options/columns may contain LaTeX between $...$ for equation rendering.
const questionSchema = new mongoose.Schema(
  {
    // Multi-tenant owner. null/absent = platform (admin) content; a User id =
    // a client's private question, isolated to that client's My Practice.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Optional: test-series questions may not belong to a subject.
    subject: { type: mongoose.Schema.Types.ObjectId, ref: "Subject" },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "Session" },
    quiz: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz" },
    testSeries: { type: mongoose.Schema.Types.ObjectId, ref: "TestSeries" },
    type: { type: String, enum: ["mcq", "matching", "statement", "pair", "pairselect", "image", "table", "assertion"], default: "mcq" },
    text: { type: String, required: true },
    image: { type: String }, // diagram/figure for "image" (and any) questions

    // Assertion & Reason questions: the two statements shown to the student.
    assertion: { type: String }, // "Assertion (A)"
    reason: { type: String }, // "Reason (R)"

    // Table-based questions: a 2D array of cells (rows × columns). Dimensions
    // are dynamic — the table renders exactly as many rows/columns as supplied.
    // First row is treated as the header. Stored as Mixed to allow any shape.
    tableRows: { type: mongoose.Schema.Types.Mixed, default: undefined },

    // MCQ fields
    options: {
      type: [String],
      validate: {
        validator: function (v) {
          // Only enforce the 4-option rule for MCQs.
          return this.type === "matching" || (Array.isArray(v) && v.length === 4);
        },
        message: "A multiple-choice question must have exactly 4 options",
      },
    },
    correct: { type: Number, min: 0 }, // index of the correct option (both types)

    // Matching fields: two columns shown to the student; the answer is still
    // one of the `options` above (each option is a sequence like "1-III, 2-I…").
    columnA: { type: [String], default: undefined },
    columnB: { type: [String], default: undefined },

    difficulty: { type: String, enum: ["Easy", "Medium", "Hard"], default: "Medium" },
    topic: { type: String },
    // For test-series questions: the subject "section" this question belongs to
    // (matches a name in the test's subjectPlan). Groups questions by subject.
    section: { type: String, default: "" },
    explanation: { type: String }, // detailed explanation of the correct answer
    // Optional brief explanation for each option (parallel to `options`), shown
    // after answering so the student learns why each choice is right/wrong.
    optionExplanations: { type: [String], default: undefined },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
  },
  { timestamps: true }
);

// Full-text search index across all searchable question fields (incl. the
// options and matching columns). Powers relevance-ranked search so the exact
// question always surfaces, no matter how large the question bank is.
questionSchema.index(
  { text: "text", options: "text", assertion: "text", reason: "text", explanation: "text", columnA: "text", columnB: "text" },
  {
    name: "question_fulltext",
    weights: { text: 10, options: 6, assertion: 6, reason: 6, columnA: 4, columnB: 4, explanation: 2 },
  }
);

export default mongoose.model("Question", questionSchema);
