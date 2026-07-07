/**
 * Environment configuration — Phase 1 (Forge-free)
 *
 * New API keys:
 *   GEMINI_API_KEY     — Google AI Studio (Gemini 2.5 Flash LLM)
 *   OPENAI_API_KEY     — OpenAI Whisper transcription
 *   GOOGLE_MAPS_API_KEY — Google Maps Places API (own key)
 *
 * Deprecated (Phase 1): forgeApiUrl and forgeApiKey are kept for
 * non-data modules (storage, notification, heartbeat, imageGeneration)
 * that still depend on Forge infrastructure. A console.warn is emitted
 * if they are set, to help track remaining dependencies.
 */

// Emit deprecation warning at startup if Forge keys are still configured
if (process.env.BUILT_IN_FORGE_API_URL || process.env.BUILT_IN_FORGE_API_KEY) {
  console.warn(
    "[env] ⚠️  BUILT_IN_FORGE_API_URL / BUILT_IN_FORGE_API_KEY are still set. " +
    "Data collection no longer uses Forge. These are only needed for: " +
    "storage.ts, notification.ts, heartbeat.ts, imageGeneration.ts, storageProxy.ts. " +
    "Remove them once those modules are migrated."
  );
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",

  // ─── Pilot PIN auth ────────────────────────────────────────────────────────
  pinCode: process.env.PIN_CODE ?? "1234",

  // ─── New direct API keys (Phase 1) ────────────────────────────────────────
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",

  // ─── CORS — comma-separated list of allowed origins ───────────────────────
  // In Railway, set to your Vercel URL: https://your-app.vercel.app
  allowedOrigins: process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:3001",

  // ─── Deprecated: Forge keys (kept for non-data modules) ───────────────────
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};

// ─── Development warnings ──────────────────────────────────────────────────

// Warn if using default PIN
if (!process.env.PIN_CODE) {
  console.warn("[auth] ⚠️  Using default PIN code — set PIN_CODE env var for production");
}

// ─── Production required-variable check ───────────────────────────────────────
// Crash fast on startup if critical env vars are missing in production.
// This prevents a misconfigured deployment from passing the health check
// and then failing mysteriously on the first real request.

const REQUIRED_IN_PRODUCTION = [
  "PIN_CODE",
  "GEMINI_API_KEY",
  "DATABASE_URL",
  "JWT_SECRET",
  "ALLOWED_ORIGINS",
] as const;

if (process.env.NODE_ENV === "production") {
  const missing = REQUIRED_IN_PRODUCTION.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `[env] FATAL: Missing required env vars in production: ${missing.join(", ")}\n` +
      `[env] Set these in Railway's Variables panel before deploying.`
    );
    process.exit(1);
  }
  // Warn if ALLOWED_ORIGINS still contains localhost in production
  if (ENV.allowedOrigins.includes("localhost")) {
    console.warn(
      "[env] ⚠️  ALLOWED_ORIGINS contains 'localhost' in production — " +
      "cross-origin requests from your Vercel frontend will be blocked. " +
      "Set ALLOWED_ORIGINS to your Vercel deployment URL."
    );
  }
}
