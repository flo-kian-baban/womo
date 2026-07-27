/**
 * FAILURE CLASSIFICATION — the retry ladder's only input.
 *
 * ─── The defect this pins ───────────────────────────────────────────────────
 * `classifyPhaseError` decides whether a failed phase retries or parks for a
 * human. It tested for `"timeout"`. Nothing this system throws contains that
 * substring — all three of our own timeouts say "timed out":
 *
 *   _core/llm.ts           `Gemini API request timed out after 60000ms`
 *   scraping/httpClient    `Request timed out after 15000ms for <url>`
 *   scraping/browserClient `[browserClient] Browser launch timed out`
 *
 * so every timeout in the system was classified `structural` and parked without
 * a single retry. Found live in `llm_invocations` twice — a brand extraction and
 * a `creator_symbol_decoding` — so this was already costing creator campaigns
 * before brand existed.
 *
 * ─── What this file is for ──────────────────────────────────────────────────
 * The classifier is shared by every phase of every subject, so a change to it
 * changes creator retry behaviour. This enumerates the WHOLE table: the cases
 * that change (and must), and the cases that must not — including the 401/403
 * credential class, which stays structural deliberately.
 */
import { describe, expect, it } from "vitest";
import { classifyPhaseError } from "./phases/collectionPhases";

/** The literal strings the codebase constructs, quoted from their call sites. */
const REAL_MESSAGES = {
  geminiTimeout: "Gemini API request timed out after 60000ms (purpose: creator_symbol_decoding)",
  httpTimeout: "Request timed out after 15000ms for https://www.tiktok.com/@x",
  browserLaunchTimeout: "[browserClient] Browser launch timed out",
  playwrightTimeout: "Timeout 30000ms exceeded.",
  http429: "HTTP 429 Too Many Requests for https://www.tiktok.com/@x",
  http503: "HTTP 503 Service Unavailable for https://example.com",
  http502: "HTTP 502 Bad Gateway for https://example.com",
  http500: "HTTP 500 Internal Server Error for https://example.com",
  http401: "LLM invoke failed: 401 Unauthorized – Request had invalid authentication credentials.",
  http403: "HTTP 403 Forbidden for https://picuki.com/profile/x",
  http404: "HTTP 404 Not Found for https://m.tiktok.com/@x",
  allPathsFailed: "[profileScraper] All scrape paths failed for @nobody",
  noKey: "GEMINI_API_KEY is not configured",
  browserClosed: "Target page, context or browser has been closed",
  econnreset: "read ECONNRESET",
  etimedout: "connect ETIMEDOUT 1.2.3.4:443",
  eaiAgain: "getaddrinfo EAI_AGAIN api.example.com",
  quota: "Quota exceeded for quota metric",
  parseFail: "Unexpected token < in JSON at position 0",
} as const;

describe("timeouts are TRANSIENT — the defect, fixed", () => {
  /**
   * The headline. Each of these parked a campaign permanently before the fix,
   * and each is a fresh-attempt-plausibly-succeeds failure.
   */
  it.each([
    ["Gemini", REAL_MESSAGES.geminiTimeout],
    ["httpClient", REAL_MESSAGES.httpTimeout],
    ["browser launch", REAL_MESSAGES.browserLaunchTimeout],
  ])("%s's 'timed out' is transient", (_label, msg) => {
    expect(classifyPhaseError(new Error(msg))).toBe("transient");
  });

  it("the old 'timeout' spelling still works — Playwright uses it", () => {
    // Kept, not replaced. It was never wrong, only insufficient.
    expect(classifyPhaseError(new Error(REAL_MESSAGES.playwrightTimeout))).toBe("transient");
  });

  it("ETIMEDOUT is not a superstring of 'timeout' and was slipping through", () => {
    expect("connect etimedout".includes("timeout")).toBe(false);
    expect(classifyPhaseError(new Error(REAL_MESSAGES.etimedout))).toBe("transient");
  });
});

describe("upstream 'come back later' statuses are TRANSIENT", () => {
  it.each([
    ["429", REAL_MESSAGES.http429],
    ["500", REAL_MESSAGES.http500],
    ["502", REAL_MESSAGES.http502],
    ["503", REAL_MESSAGES.http503],
  ])("HTTP %s is transient", (_s, msg) => {
    expect(classifyPhaseError(new Error(msg))).toBe("transient");
  });

  it("a temporary DNS failure is transient", () => {
    expect(classifyPhaseError(new Error(REAL_MESSAGES.eaiAgain))).toBe("transient");
  });

  it("a 4xx that is NOT 429 stays structural — the host is not asking us to wait", () => {
    expect(classifyPhaseError(new Error(REAL_MESSAGES.http403))).toBe("structural");
    expect(classifyPhaseError(new Error(REAL_MESSAGES.http404))).toBe("structural");
  });
});

/**
 * ─── CREATOR BEHAVIOUR, OTHERWISE UNTOUCHED ────────────────────────────────
 *
 * Everything below classified exactly this way BEFORE the change, and must
 * continue to. The classifier is shared, so this is the proof that the fix
 * widened the transient set and altered nothing else.
 */
describe("every other class is unchanged", () => {
  it.each([
    ["quota", REAL_MESSAGES.quota, "transient"],
    ["ECONNRESET", REAL_MESSAGES.econnreset, "transient"],
    ["socket hang up", "socket hang up", "transient"],
    ["rate limit", "rate limit exceeded", "transient"],
    ["usage exhausted", "usage exhausted for today", "transient"],
    ["browser dead", REAL_MESSAGES.browserClosed, "transient"],
    ["all paths failed", REAL_MESSAGES.allPathsFailed, "structural"],
    ["missing API key", REAL_MESSAGES.noKey, "structural"],
    ["malformed JSON", REAL_MESSAGES.parseFail, "structural"],
    ["404", REAL_MESSAGES.http404, "structural"],
  ])("%s → %s", (_label, msg, expected) => {
    expect(classifyPhaseError(new Error(msg))).toBe(expected);
  });

  /**
   * THE ONE JUDGEMENT CALL, MADE EXPLICIT.
   *
   * A 401 is a dead or rotated key. It does not heal on a 30-second backoff, so
   * parking it for a human is correct and it stays structural — even though the
   * derive phase's generous ladder was written with "the credential/quota
   * failure class" in mind. Quota heals; credentials do not.
   *
   * Six such invocations landed in one day during the live key incident; four
   * silent retries per phase would have made it slower to notice, not faster.
   */
  it("401 / invalid credentials stays STRUCTURAL — a dead key needs a human", () => {
    expect(classifyPhaseError(new Error(REAL_MESSAGES.http401))).toBe("structural");
    expect(classifyPhaseError(new Error("Request had invalid authentication credentials"))).toBe("structural");
  });

  it("an unrecognised failure defaults to structural, not transient", () => {
    // The safe default: park for a human rather than loop on something we do
    // not understand.
    expect(classifyPhaseError(new Error("something nobody has seen before"))).toBe("structural");
    expect(classifyPhaseError("a bare string")).toBe("structural");
    expect(classifyPhaseError(null)).toBe("structural");
  });
});

describe("classification is case-insensitive on the whole table", () => {
  it.each(Object.entries(REAL_MESSAGES))("%s classifies identically upper-cased", (_k, msg) => {
    expect(classifyPhaseError(new Error(msg.toUpperCase())))
      .toBe(classifyPhaseError(new Error(msg.toLowerCase())));
  });
});
