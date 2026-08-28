import mongoose from "../db/odm.js";

// An AI provider API key managed from the admin panel. Each key has its own
// base URL and model list (OpenAI-compatible). The AI generator uses all
// ENABLED keys — several keys with the same model act as quota fallbacks.
const aiKeySchema = new mongoose.Schema(
  {
    // Who owns this key. null = a PLATFORM / built-in ("inbuilt") key managed by
    // the admin and shared with clients who use built-in mode. A user id = a
    // client's OWN key, usable only by that client. Existing keys have no owner
    // field, so { owner: null } matches them as platform keys.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    label: { type: String, trim: true, default: "" }, // friendly name, e.g. "Gemini account 1"
    baseUrl: { type: String, trim: true, default: "https://generativelanguage.googleapis.com/v1beta/openai" },
    models: { type: String, trim: true, default: "gemini-2.5-flash" }, // comma-separated model ids
    key: { type: String, trim: true, required: true }, // the secret API key
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    // Result of the last "Test" — so the admin can see active/inactive.
    // "limited" = the key is VALID but was rate-limited / out of quota during the
    // test (429). It's not broken — it just needs quota to be available.
    lastStatus: { type: String, enum: ["", "ok", "error", "limited"], default: "" },
    lastError: { type: String, default: "" },
    lastCheckedAt: { type: Date, default: null },
    // Usage tracked by THIS app (providers don't expose remaining credits).
    usedRequests: { type: Number, default: 0 },
    usedTokens: { type: Number, default: 0 },
    // Optional token budget the admin enters, so "remaining" can be computed
    // (remaining = creditLimit − usedTokens). 0 = not set.
    creditLimit: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("AiKey", aiKeySchema);
