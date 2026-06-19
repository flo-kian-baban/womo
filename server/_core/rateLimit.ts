/**
 * Rate Limiting Middleware for tRPC
 *
 * In-memory, per-IP rate limiter designed for pilot-scale traffic.
 * Uses a sliding-window approach: stores timestamps of recent requests
 * per IP, and rejects requests that exceed the configured limit.
 *
 * Not suitable for multi-instance deployments (use Redis-backed
 * rate limiting for horizontal scaling post-pilot).
 */

import { TRPCError } from "@trpc/server";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { t } from "./trpc";

// ─── Types ───────────────────────────────────────────────────────────────────

type RateLimitConfig = {
  /** Maximum requests allowed within the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Human-readable procedure name for logging */
  procedureName: string;
  /** Custom error message (optional) */
  errorMessage?: string;
};

// ─── In-Memory Store ─────────────────────────────────────────────────────────

/**
 * Map<ip, timestamp[]> — stores request timestamps per IP.
 * Each key is an IP address; each value is an array of Unix-ms timestamps
 * of requests made within the current window.
 */
const requestStore = new Map<string, number[]>();

/**
 * Periodically clean up expired entries to prevent memory leaks.
 * Runs every 5 minutes. Removes IPs whose most recent request
 * is older than 1 hour (the maximum window we support).
 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_WINDOW_MS = 60 * 60 * 1000; // 1 hour (maximum rate limit window)

setInterval(() => {
  const now = Date.now();
  const entries = Array.from(requestStore.entries());
  for (let i = 0; i < entries.length; i++) {
    const [ip, timestamps] = entries[i]!;
    // Filter out timestamps older than the max window
    const valid = timestamps.filter((ts: number) => now - ts < MAX_WINDOW_MS);
    if (valid.length === 0) {
      requestStore.delete(ip);
    } else {
      requestStore.set(ip, valid);
    }
  }
}, CLEANUP_INTERVAL_MS).unref(); // .unref() so it doesn't keep the process alive

// ─── IP Extraction ───────────────────────────────────────────────────────────

function getClientIp(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): string {
  // Check x-forwarded-for first (behind reverse proxy / load balancer)
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0];
    if (first) return first.trim();
  }
  return req.ip ?? "unknown";
}

// ─── Middleware Factory ──────────────────────────────────────────────────────

/**
 * Creates a tRPC middleware that enforces per-IP rate limiting.
 */
function createRateLimitMiddleware(config: RateLimitConfig) {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;
    const ip = getClientIp(ctx.req);
    const now = Date.now();

    // Get existing timestamps for this IP, filter to current window
    const existing = requestStore.get(ip) ?? [];
    const windowStart = now - config.windowMs;
    const recentRequests = existing.filter((ts) => ts > windowStart);

    if (recentRequests.length >= config.maxRequests) {
      console.warn(
        `[rateLimit] IP ${ip} exceeded limit on ${config.procedureName} ` +
          `(${recentRequests.length}/${config.maxRequests} in ${config.windowMs / 1000}s window)`
      );
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message:
          config.errorMessage ??
          "Analysis limit reached. Please wait before running another analysis.",
      });
    }

    // Record this request
    recentRequests.push(now);
    requestStore.set(ip, recentRequests);

    return next();
  });
}

// ─── Pilot auth middleware (cookie check) ────────────────────────────────────

const requirePilotAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.authenticated) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({ ctx });
});

// ─── Pre-Built Rate-Limited Procedures ───────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Procedure: rate limited at 5 attempts per 15 minutes (no auth required).
 * Used for: auth.login (brute-force protection)
 */
export const loginRateLimitedProcedure = t.procedure.use(
  createRateLimitMiddleware({
    maxRequests: 5,
    windowMs: FIFTEEN_MINUTES_MS,
    procedureName: "auth.login",
    errorMessage: "Too many login attempts. Please wait 15 minutes.",
  })
);

/**
 * Procedure: auth required + rate limited at 10 requests/hour.
 * Used for: creator.analyze, brand.analyze
 */
export const analysisRateLimitedProcedure = t.procedure
  .use(requirePilotAuth)
  .use(
    createRateLimitMiddleware({
      maxRequests: 10,
      windowMs: ONE_HOUR_MS,
      procedureName: "analysis",
    })
  );

/**
 * Procedure: auth required + rate limited at 20 requests/hour.
 * Used for: fit.calculate
 */
export const fitRateLimitedProcedure = t.procedure
  .use(requirePilotAuth)
  .use(
    createRateLimitMiddleware({
      maxRequests: 20,
      windowMs: ONE_HOUR_MS,
      procedureName: "fit.calculate",
    })
  );

/**
 * Procedure: auth required + rate limited at 2 requests/hour.
 * Used for: creator.bulkAnalyze
 */
export const bulkRateLimitedProcedure = t.procedure
  .use(requirePilotAuth)
  .use(
    createRateLimitMiddleware({
      maxRequests: 2,
      windowMs: ONE_HOUR_MS,
      procedureName: "creator.bulkAnalyze",
    })
  );
