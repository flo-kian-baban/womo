/**
 * Smart HTTP Client — Phase 1
 *
 * Replaces the previous `fetchHtml()` (webResearch.ts) and
 * `fetchHtmlWithHeaders()` (reviewResearch.ts) with a single
 * robust HTTP client that supports:
 *
 *  - Pool of 15+ rotating User-Agent strings
 *  - Configurable retry with exponential backoff (default 3 attempts)
 *  - Cloudflare challenge detection (body + header checks)
 *  - Random request timing jitter (100–500ms between requests)
 *  - Pluggable proxy interface (NoProxy default → Phase 3)
 *  - Automatic scrape event logging for profile/video pages
 */

import { insertScrapeEvent } from "../db";

// ─── Proxy Interface (Phase 3 plug-in point) ─────────────────────────────────

export interface ProxyConfig {
  host: string;
  port: number;
  auth?: { username: string; password: string };
}

export interface ProxyProvider {
  getProxy(): Promise<ProxyConfig | null>;
  reportFailure(proxy: ProxyConfig): void;
  reportSuccess(proxy: ProxyConfig): void;
}

/** Default: no proxy. Direct connection. */
export class NoProxy implements ProxyProvider {
  async getProxy(): Promise<null> { return null; }
  reportFailure(): void {}
  reportSuccess(): void {}
}

// ─── User-Agent Pool ──────────────────────────────────────────────────────────

const USER_AGENTS: string[] = [
  // Chrome on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  // Chrome on Mac
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  // Chrome on Linux
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  // Firefox on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  // Firefox on Mac
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0",
  // Firefox on Linux
  "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
  // Safari on Mac
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  // Chrome on Android
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  // Safari on iOS
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ─── Cloudflare Detection ─────────────────────────────────────────────────────

const CF_CHALLENGE_STRINGS = [
  "Just a moment...",
  "Checking if the site connection is secure",
  "Enable JavaScript and cookies to continue",
  "cf-browser-verification",
  "Attention Required! | Cloudflare",
  "_cf_chl_opt",
];

export interface CloudflareCheckResult {
  isChallenged: boolean;
  reason?: string;
}

function detectCloudflare(body: string, headers: Headers): CloudflareCheckResult {
  // Header check: cf-mitigated
  const cfMitigated = headers.get("cf-mitigated");
  if (cfMitigated) {
    return { isChallenged: true, reason: `cf-mitigated: ${cfMitigated}` };
  }

  // Header check: server = cloudflare with 403/503 pattern
  const server = headers.get("server") ?? "";
  const cfRay = headers.get("cf-ray");
  if (server.toLowerCase().includes("cloudflare") && cfRay && body.length < 50000) {
    // Check body for challenge markers
    for (const marker of CF_CHALLENGE_STRINGS) {
      if (body.includes(marker)) {
        return { isChallenged: true, reason: `body contains "${marker}"` };
      }
    }
  }

  return { isChallenged: false };
}

// ─── Jitter ───────────────────────────────────────────────────────────────────

/** Random delay between 100ms and 500ms */
function randomJitter(): Promise<void> {
  const ms = 100 + Math.floor(Math.random() * 400);
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Retry Logic ──────────────────────────────────────────────────────────────

export interface FetchHtmlOptions {
  /** Extra headers to merge (Referer, etc.) */
  extraHeaders?: Record<string, string>;
  /** Timeout in ms (default: 15000) */
  timeout?: number;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  baseDelay?: number;
  /** Whether to apply random jitter before the request (default: true for non-first requests) */
  jitter?: boolean;
  /** Response type: "text" | "json" (default: "text") */
  responseType?: "text" | "json";
}

export class HttpClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly isCloudflare: boolean = false,
    public readonly isTimeout: boolean = false,
  ) {
    super(message);
    this.name = "HttpClientError";
  }
}

// ─── Singleton Client ─────────────────────────────────────────────────────────

let _proxyProvider: ProxyProvider = new NoProxy();

/** Set a custom proxy provider (Phase 3) */
export function setProxyProvider(provider: ProxyProvider): void {
  _proxyProvider = provider;
}

/**
 * Fetch HTML from a URL with smart retry, User-Agent rotation,
 * Cloudflare detection, and optional proxy support.
 *
 * Drop-in replacement for the previous `fetchHtml()` and
 * `fetchHtmlWithHeaders()` functions.
 */
export async function fetchHtml(
  url: string,
  options: FetchHtmlOptions = {},
): Promise<string> {
  const {
    extraHeaders = {},
    timeout = 15000,
    maxRetries = 3,
    baseDelay = 1000,
  } = options;

  let lastError: Error | null = null;
  const fetchStartTime = Date.now();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Apply jitter between retries (not on the first attempt)
    if (attempt > 1) {
      const delay = baseDelay * Math.pow(2, attempt - 2); // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, delay));
      await randomJitter();
    }

    const userAgent = randomUserAgent();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        headers: {
          "User-Agent": userAgent,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
          ...extraHeaders,
        },
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timer);

      if (!response.ok) {
        lastError = new HttpClientError(
          `HTTP ${response.status} ${response.statusText} for ${url}`,
          response.status,
        );
        // 429 / 503 → retry; 404 → don't retry
        if (response.status === 404 || response.status === 410) {
          throw lastError;
        }
        console.warn(`[httpClient] Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
        continue;
      }

      const body = await response.text();

      // Cloudflare check
      const cfCheck = detectCloudflare(body, response.headers);
      if (cfCheck.isChallenged) {
        lastError = new HttpClientError(
          `Cloudflare challenge on ${url}: ${cfCheck.reason}`,
          undefined,
          true,
        );
        console.warn(`[httpClient] Attempt ${attempt}/${maxRetries}: Cloudflare challenge detected (${cfCheck.reason})`);
        continue;
      }

      logScrapeSuccess(url, body.length, Date.now() - fetchStartTime);
      return body;
    } catch (err) {
      if (err instanceof HttpClientError) {
        // Already handled above; if it's a 404 we re-throw immediately
        if (err.statusCode === 404 || err.statusCode === 410) throw err;
        lastError = err;
      } else if ((err as Error).name === "AbortError") {
        lastError = new HttpClientError(
          `Request timed out after ${timeout}ms for ${url}`,
          undefined,
          false,
          true,
        );
        console.warn(`[httpClient] Attempt ${attempt}/${maxRetries}: timeout`);
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[httpClient] Attempt ${attempt}/${maxRetries}: ${lastError.message}`);
      }
    }
  }

  const finalError = lastError ?? new Error(`fetchHtml failed for ${url} after ${maxRetries} attempts`);
  logScrapeFailure(url, Date.now() - fetchStartTime, finalError);
  throw finalError;
}

// ─── Scrape Event Logging ─────────────────────────────────────────────────────

// Telemetry-drop accounting (Session 5): every scrape_events write that cannot
// be recorded — whether the insert rejected or the logging path itself threw —
// funnels through recordTelemetryDrop(), so dropped telemetry is counted and
// visible in logs instead of vanishing in nested empty catches.
let _droppedScrapeEvents = 0;

/** Number of scrape_events telemetry writes dropped since process start. */
export function getDroppedScrapeEventCount(): number {
  return _droppedScrapeEvents;
}

function recordTelemetryDrop(context: string, err: unknown): void {
  _droppedScrapeEvents++;
  console.warn(
    `[httpClient] scrape_events telemetry write dropped (total ${_droppedScrapeEvents}, ${context}): ` +
    (err instanceof Error ? err.message : String(err)),
  );
}

/** Single fire-and-forget path for scrape_events telemetry writes. */
function logScrapeEventSafe(
  event: Parameters<typeof insertScrapeEvent>[0],
  context: string,
): void {
  try {
    insertScrapeEvent(event).catch(err => recordTelemetryDrop(context, err));
  } catch (err) {
    recordTelemetryDrop(`${context} (sync)`, err);
  }
}

/**
 * Session 7: exported single logging path for collection code that bypasses
 * fetchHtml (Playwright navigations, context.request fetches, axios subtitle/
 * caption downloads, transcription attempts). Fire-and-forget — telemetry must
 * never change scraping behavior; drops are counted via recordTelemetryDrop.
 * The ambient analysis-run id is stamped inside insertScrapeEvent (womo_0006).
 */
export function recordScrapeEvent(
  event: Parameters<typeof insertScrapeEvent>[0],
  context = "instrumented-path",
): void {
  logScrapeEventSafe(event, context);
}

/** Infer platform + scrape method from a URL. Returns null for non-loggable URLs. */
function inferScrapeContext(url: string): { platform: string; scrapeMethod: string } | null {
  const lower = url.toLowerCase();
  // Session 7: label the mobile-web and Google-cache fetch paths accurately
  // (previously both fell through to tiktok_desktop_http).
  if (lower.includes("webcache.googleusercontent.com")) {
    return { platform: "tiktok", scrapeMethod: "tiktok_google_cache" };
  }
  if (lower.includes("picuki.com")) {
    return { platform: "instagram", scrapeMethod: "instagram_picuki" };
  }
  // Only log profile and video page fetches, skip subtitle/caption/API calls
  if (lower.includes("tiktok.com")) {
    const method = lower.includes("m.tiktok.com") ? "tiktok_mobile_http" : "tiktok_desktop_http";
    if (lower.includes("/video/") || lower.match(/tiktok\.com\/@[^/]+\/?$/)) {
      return { platform: "tiktok", scrapeMethod: method };
    }
    return null; // Skip API/search/subtitle URLs
  }
  if (lower.includes("instagram.com")) {
    if (lower.includes("/oembed") || lower.includes("graph.instagram.com")) {
      return { platform: "instagram", scrapeMethod: "instagram_oembed" };
    }
    if (lower.match(/instagram\.com\/[^/]+\/?$/) || lower.includes("/p/")) {
      return { platform: "instagram", scrapeMethod: "instagram_playwright" };
    }
    return null;
  }
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
    return { platform: "youtube", scrapeMethod: "youtube_html" };
  }
  return null; // Not a social media URL — don't log
}

/** Fire-and-forget: log a successful fetch as a scrape event */
function logScrapeSuccess(url: string, bodyLength: number, durationMs: number): void {
  const ctx = inferScrapeContext(url);
  if (!ctx) return;
  try {
    const silentFail = ctx.platform === "tiktok" || ctx.platform === "instagram"
      ? detectSilentFailure(ctx.platform as "tiktok" | "instagram", "", url)
      : { isFailed: false, reason: "" };
    logScrapeEventSafe({
      platform: ctx.platform,
      scrapeMethod: ctx.scrapeMethod,
      urlRequested: url.slice(0, 1000),
      httpStatus: 200,
      responseSizeBytes: bodyLength,
      silentFailureDetected: silentFail.isFailed,
      failureReason: silentFail.isFailed ? silentFail.reason : undefined,
      durationMs,
    }, "fetch-success");
  } catch (err) {
    recordTelemetryDrop("fetch-success (event build)", err);
  }
}

/** Fire-and-forget: log a failed fetch as a scrape event */
function logScrapeFailure(url: string, durationMs: number, error: Error): void {
  const ctx = inferScrapeContext(url);
  if (!ctx) return;
  try {
    const statusCode = error instanceof HttpClientError ? error.statusCode : undefined;
    logScrapeEventSafe({
      platform: ctx.platform,
      scrapeMethod: ctx.scrapeMethod,
      urlRequested: url.slice(0, 1000),
      httpStatus: statusCode,
      silentFailureDetected: false,
      failureReason: error.message.slice(0, 500),
      durationMs,
    }, "fetch-failure");
  } catch (err) {
    recordTelemetryDrop("fetch-failure (event build)", err);
  }
}

/**
 * Convenience: fetch and parse JSON with the same smart client.
 */
export async function fetchJson<T = unknown>(
  url: string,
  options: FetchHtmlOptions = {},
): Promise<T> {
  const html = await fetchHtml(url, options);
  return JSON.parse(html) as T;
}

// FIX 7.x: fetchText removed — was never called anywhere in the codebase.

// ─── Phase 2: Silent Failure Detection ────────────────────────────────────────

export interface SilentFailureResult {
  isFailed: boolean;
  reason: string;
}

/**
 * Detect HTTP 200 responses that actually contain bad/empty data.
 * Each platform has specific soft-block patterns.
 */
export function detectSilentFailure(
  platform: "tiktok" | "instagram",
  body: string,
  requestUrl?: string,
  responseUrl?: string,
): SilentFailureResult {
  if (platform === "tiktok") {
    // TikTok soft block: rehydration JSON exists but itemList empty AND followerCount 0
    const rehydrationMatch = body.match(
      /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (rehydrationMatch) {
      try {
        const data = JSON.parse(rehydrationMatch[1]);
        const userDetail = data?.__DEFAULT_SCOPE__?.["webapp.user-detail"];
        if (userDetail) {
          const stats = userDetail?.userInfo?.stats;
          const itemList = userDetail?.itemList;
          const followerCount = Number(stats?.followerCount ?? 0);
          const itemCount = Array.isArray(itemList) ? itemList.length : 0;

          if (followerCount === 0 && itemCount === 0 && userDetail?.userInfo?.user) {
            return { isFailed: true, reason: "TikTok soft block: rehydration data present but followerCount=0 and itemList empty" };
          }
        }
      } catch { /* parse failure is not a silent failure */ }
    }

    // TikTok redirect loop: response URL differs significantly from request URL
    if (requestUrl && responseUrl) {
      const reqHandle = requestUrl.match(/@([^/?#]+)/)?.[1]?.toLowerCase();
      const resHandle = responseUrl.match(/@([^/?#]+)/)?.[1]?.toLowerCase();
      if (reqHandle && resHandle && reqHandle !== resHandle) {
        return { isFailed: true, reason: `TikTok redirect loop: requested @${reqHandle} but got @${resHandle}` };
      }
      // Redirect to login/captcha page
      if (responseUrl.includes("/login") || responseUrl.includes("/captcha")) {
        return { isFailed: true, reason: `TikTok redirected to login/captcha: ${responseUrl}` };
      }
    }

    // Page too small to contain real data
    if (body.length < 5000 && !body.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__")) {
      return { isFailed: true, reason: "TikTok response too small and missing rehydration data" };
    }

    // NOTE: We intentionally do NOT reject "JS shell" pages (slardar-config present,
    // no rehydration data). While these pages lack structured rehydration JSON,
    // they often contain profile stats embedded in JS bundles that the regex
    // fallback in extractUserInfoFromRegex() can extract.
  }

  if (platform === "instagram") {
    // Instagram soft block: _sharedData exists but user is null
    if (body.includes("_sharedData")) {
      const sdMatch = body.match(/window\._sharedData\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
      if (sdMatch) {
        try {
          const sd = JSON.parse(sdMatch[1]);
          const user = sd?.entry_data?.ProfilePage?.[0]?.graphql?.user;
          if (user === null || user === undefined) {
            return { isFailed: true, reason: "Instagram soft block: _sharedData present but graphql.user is null" };
          }
        } catch { /* parse failure is not a silent failure */ }
      }
    }

    // Instagram rate limit messages
    const rateLimitPhrases = [
      "Please wait a few minutes",
      "Try again later",
      "We limit how often",
      "temporarily blocked",
    ];
    for (const phrase of rateLimitPhrases) {
      if (body.includes(phrase)) {
        return { isFailed: true, reason: `Instagram rate limit detected: "${phrase}"` };
      }
    }

    // Instagram login wall
    if (body.includes("loginForm") && !body.includes("ProfilePage") && !body.includes("graphql")) {
      return { isFailed: true, reason: "Instagram login wall: page requires authentication" };
    }
  }

  return { isFailed: false, reason: "" };
}

// ─── Phase 2: Request Governor (Human-Pattern Timing) ─────────────────────────

interface GovernorState {
  lastRequestTime: number;
  requestsSincePause: number;
}

const _governorState: Record<string, GovernorState> = {};

/**
 * Enforce human-pattern timing between requests per platform.
 *
 * TikTok: 800ms–2000ms between requests, burst of 3 then pause 6–12s
 * Instagram: 3000ms–8000ms between requests, no bursting, pause 10–20s every 5
 */
export async function requestGovernor(platform: "tiktok" | "instagram"): Promise<void> {
  if (!_governorState[platform]) {
    _governorState[platform] = { lastRequestTime: 0, requestsSincePause: 0 };
  }
  const state = _governorState[platform];
  const now = Date.now();

  if (platform === "tiktok") {
    // Burst of 3 then pause 6-12s
    if (state.requestsSincePause >= 3) {
      const pauseMs = 6000 + Math.floor(Math.random() * 6000);
      const elapsed = now - state.lastRequestTime;
      if (elapsed < pauseMs) {
        await new Promise((r) => setTimeout(r, pauseMs - elapsed));
      }
      state.requestsSincePause = 0;
    } else {
      // 800ms-2000ms between requests
      const minGap = 800 + Math.floor(Math.random() * 1200);
      const elapsed = now - state.lastRequestTime;
      if (elapsed < minGap && state.lastRequestTime > 0) {
        await new Promise((r) => setTimeout(r, minGap - elapsed));
      }
    }
    state.requestsSincePause++;
  }

  if (platform === "instagram") {
    // Pause 10-20s every 5 requests
    if (state.requestsSincePause >= 5) {
      const pauseMs = 10000 + Math.floor(Math.random() * 10000);
      const elapsed = now - state.lastRequestTime;
      if (elapsed < pauseMs) {
        await new Promise((r) => setTimeout(r, pauseMs - elapsed));
      }
      state.requestsSincePause = 0;
    } else {
      // 3000ms-8000ms between requests, no bursting
      const minGap = 3000 + Math.floor(Math.random() * 5000);
      const elapsed = now - state.lastRequestTime;
      if (elapsed < minGap && state.lastRequestTime > 0) {
        await new Promise((r) => setTimeout(r, minGap - elapsed));
      }
    }
    state.requestsSincePause++;
  }

  state.lastRequestTime = Date.now();
}


// FIX 7.x: reconcileProfile, PartialProfileSource, ReconciledProfile, ReconciledField removed
// — never called anywhere in the codebase. Keep ProxyProvider (Phase 3 stub).


// ─── Mobile User-Agent Helpers ────────────────────────────────────────────────

const MOBILE_USER_AGENTS: string[] = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1",
];

/** Get a random mobile User-Agent (iOS Safari or Android Chrome) */
export function randomMobileUserAgent(): string {
  return MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];
}

