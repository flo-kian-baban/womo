/**
 * Environment configuration (internal local-only app).
 *
 * API keys:
 *   GEMINI_API_KEY      — Google AI Studio (Gemini 2.5 Flash LLM)
 *   OPENAI_API_KEY      — OpenAI Whisper transcription (optional fallback)
 *   GOOGLE_MAPS_API_KEY — Google Maps Places API (brand analysis)
 */

export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",

  // ─── Direct API keys ───────────────────────────────────────────────────────
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",

  // ─── Analysis timeout (local-first, C2) ────────────────────────────────────
  // The analyze race deadline. Default 300s (the long-standing value); there is
  // no gateway locally, so ANALYSIS_TIMEOUT_MS may be raised (e.g. 600000) for
  // hard creators. Unset env → default behavior.
  analysisTimeoutMs: (() => {
    const raw = parseInt(process.env.ANALYSIS_TIMEOUT_MS ?? "", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 300_000;
  })(),
};
