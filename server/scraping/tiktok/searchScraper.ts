/**
 * TikTok Search Scraper — strategy-chain structure (scraper-reliability session).
 *
 * One real path, one named strategy, mirroring transcriptStrategies.ts:
 *
 *   search_xhr_scroll — Playwright navigation to the search page, XHR
 *                       interception of the search API (accumulated across
 *                       in-page scroll pagination).
 *
 * plus ONE bounded transient-retry owned by the orchestrator: when an attempt
 * dies from a transient runtime failure (context/page death, navigation abort),
 * the query is retried once on a FRESH owned context. A clean zero-result
 * response is NOT transient and is never retried here (the empty-capture
 * discriminator lives in the profile phase, where profile stats exist to
 * distinguish transient empties from genuinely postless creators).
 *
 * REMOVED (scraper-reliability Part 0, telemetry 2026-06-19 → 2026-07-25):
 *   - HTML-parse fallback (SIGI_STATE / rehydration parse of the search page):
 *     0 successes in 38 lifetime attempts — it has never parsed a single result
 *     on today's TikTok search pages, and cost ~19s of futility per invocation.
 *     Do not restore it without fresh evidence that the parse target exists.
 *
 * Telemetry contract (Session 9/10 run-panel math depends on it):
 *   - Exactly ONE UNMARKED terminal scrape_event per query:
 *       success    → clean tiktok_search_xhr row
 *       zero-items → silent tiktok_search_xhr row ("no results via XHR capture";
 *                    formerly logged under tiktok_search_html — same 1-attempt/
 *                    1-failure panel accounting, method label now truthful)
 *       error      → tiktok_search_xhr row with the raw failure reason
 *   - A superseded transient attempt (one that a retry replaced) is recorded
 *     with failure_reason prefixed "search " — the run-panel query math skips
 *     that prefix exactly as it skips "transcript " attempt records, so a
 *     retried-then-recovered query still counts as ONE attempted, ZERO failed.
 *
 * Powers:
 *   - Supplemental video discovery in webResearch.ts
 *   - Brand mention collection (Track B) in brandTikTokAnalysis.ts
 */

import { requestGovernor, recordScrapeEvent } from "../httpClient";
import { getContext, warmSession, retireContext, randomDelay } from "../browserClient";

// ─── Response Type (same shape as the former Forge search response) ───────────

export interface TikTokSearchResponse {
  item_list: TikTokSearchItem[];
  cursor?: number;
  has_more: boolean;
  search_id?: string;
}

export interface TikTokSearchItem {
  id: string;
  desc: string;
  createTime?: number;
  stats?: {
    playCount?: number;
    diggCount?: number;
    commentCount?: number;
    collectCount?: number;
    shareCount?: number;
  };
  author?: {
    uniqueId?: string;
    nickname?: string;
    secUid?: string;
  };
  music?: {
    title?: string;
    authorName?: string;
    original?: boolean;
  };
  video?: {
    duration?: number;
    id?: string;
  };
  duetEnabled?: boolean;
  stitchEnabled?: boolean;
  isAd?: boolean;
  challenges?: Array<{ title?: string }>;
  textExtra?: Array<{ hashtagName?: string }>;
}

// ─── Strategy result (attempt-level; the orchestrator owns all telemetry) ─────

export type SearchAttemptOutcome = "success" | "empty" | "error";

interface SearchAttemptResult {
  outcome: SearchAttemptOutcome;
  response?: TikTokSearchResponse;
  navStatus?: number;
  errorMessage?: string;
  durationMs: number;
}

/**
 * Transient = the attempt died from runtime plumbing (context/page death,
 * navigation abort/timeout, socket reset) — conditions where a fresh context
 * plausibly succeeds. A clean zero-result page is NOT transient. Exported for
 * tests.
 */
export function isTransientSearchFailure(message: string | undefined): boolean {
  if (!message) return false;
  return /Target (page|context|browser)|browser has been closed|has been closed|Navigation failed|net::ERR|Timeout \d+ms exceeded|frame was detached/i.test(
    message,
  );
}

// ─── The one real strategy: search_xhr_scroll ────────────────────────────────

async function attemptSearchXhrScroll(
  keyword: string,
  sharedContext?: import("playwright").BrowserContext,
): Promise<SearchAttemptResult> {
  // Session 11 (Commit 2): when the caller runs the query batch concurrently it
  // hands in ONE dedicated context shared across the queries. We open a fresh page
  // on it and NEVER retire it here — closing a shared context would break sibling
  // queries mid-flight (the retire race). The caller closes it once when the batch
  // is done. Without a shared context we own one from the pool, exactly as before.
  let ownedCtx: Awaited<ReturnType<typeof getContext>> | null = null;
  let sharedPage: import("playwright").Page | undefined;
  const scrapeStart = Date.now();
  let navStatus: number | undefined;

  try {
    await requestGovernor("tiktok");
    let page: import("playwright").Page;
    let context: import("playwright").BrowserContext;
    if (sharedContext) {
      context = sharedContext;
      page = await sharedContext.newPage();
      sharedPage = page;
    } else {
      ownedCtx = await getContext("desktop-chrome");
      page = ownedCtx.page;
      context = ownedCtx.context;
    }

    // Session warming: visit homepage first
    await warmSession(page, "https://www.tiktok.com/", 2000, 4000);

    // Set up XHR accumulation for search API responses
    // (captures multiple batches as the page scrolls — in-page pagination)
    const capturedItems: unknown[] = [];
    let lastCursor: number | undefined;
    let lastHasMore = false;
    let lastSearchId: string | undefined;
    let xhrResponseCount = 0;

    page.on("response", async (response) => {
      try {
        const url = response.url();
        if (
          (url.includes("/api/search/") ||
            url.includes("search/item") ||
            url.includes("search/video")) &&
          response.status() === 200
        ) {
          const body = await response.json().catch(() => null);
          if (body && typeof body === "object") {
            const result = body as Record<string, unknown>;
            const items = (result.item_list ?? result.data) as unknown[];
            if (Array.isArray(items) && items.length > 0) {
              capturedItems.push(...items);
              xhrResponseCount++;
              lastCursor = Number(result.cursor ?? 0);
              lastHasMore = Boolean(result.has_more ?? false);
              const logPb = result.log_pb as Record<string, unknown> | undefined;
              lastSearchId = String(result.search_id ?? logPb?.impr_id ?? "");
              console.log(`[searchScraper] "${keyword}" XHR #${xhrResponseCount}: +${items.length} items (total: ${capturedItems.length})`);
            }
          }
        }
      } catch { /* response body read failure — ignore */ }
    });

    // Navigate to search page
    const searchUrl = `https://www.tiktok.com/search/video?q=${encodeURIComponent(keyword)}`;
    const navResponse = await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    navStatus = navResponse?.status();

    // Wait for initial search results XHR to arrive
    await randomDelay(2000, 4000);
    for (let i = 0; i < 15 && capturedItems.length === 0; i++) {
      await randomDelay(500, 500);
    }

    // Scroll down to trigger additional search API calls (in-page pagination)
    // Each scroll triggers a new XHR with the next cursor — TikTok loads ~12-15 per batch
    if (capturedItems.length > 0) {
      const scrollPositions = [800, 1800, 3000];
      for (const yPos of scrollPositions) {
        await page.evaluate((y) => window.scrollTo(0, y), yPos);
        await randomDelay(1500, 2500);
      }
      // Wait for final XHR responses to complete
      await randomDelay(1000, 2000);
    }

    if (capturedItems.length > 0) {
      console.log(`[searchScraper] Captured ${capturedItems.length} total results for "${keyword}" (${xhrResponseCount} XHR batches)`);
      await page.close();
      return {
        outcome: "success",
        navStatus,
        durationMs: Date.now() - scrapeStart,
        response: {
          item_list: normalizeSearchItems(capturedItems),
          has_more: lastHasMore,
          cursor: lastCursor,
          search_id: lastSearchId,
        },
      };
    }

    // Zero items captured on a page that otherwise loaded — a clean empty, not
    // a transient failure. (The HTML-parse fallback that used to run here was
    // removed: 0/38 lifetime successes — see module header.)
    console.warn(`[searchScraper] No results captured for "${keyword}"`);
    // Only retire a context we own; a shared context is the caller's to close.
    if (ownedCtx) { await retireContext(ownedCtx.context); } else { await page.close().catch(() => {}); }
    return { outcome: "empty", navStatus, durationMs: Date.now() - scrapeStart };
  } catch (err) {
    const message = (err as Error).message;
    console.warn(`[searchScraper] Playwright search failed for "${keyword}":`, message);
    // Close only the page we opened; never retire a shared context on error.
    if (ownedCtx) {
      try { await ownedCtx.page.close(); } catch { /* ignore */ }
    } else if (sharedPage) {
      try { await sharedPage.close(); } catch { /* ignore */ }
    }
    return { outcome: "error", navStatus, errorMessage: message, durationMs: Date.now() - scrapeStart };
  }
}

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizeSearchItems(rawItems: unknown[]): TikTokSearchItem[] {
  const items: TikTokSearchItem[] = [];

  for (const rawItem of rawItems) {
    const item = rawItem as Record<string, unknown>;
    const videoId = String(item.id ?? item.video_id ?? "");
    if (!videoId) continue;

    const statsObj = (item.stats ?? item.statistics ?? {}) as Record<string, unknown>;
    const authorObj = (item.author ?? {}) as Record<string, unknown>;
    const musicObj = (item.music ?? {}) as Record<string, unknown>;
    const videoObj = (item.video ?? {}) as Record<string, unknown>;

    items.push({
      id: videoId,
      desc: String(item.desc ?? item.description ?? ""),
      createTime: Number(item.createTime ?? item.create_time ?? 0),
      stats: {
        playCount: Number(statsObj.playCount ?? statsObj.play_count ?? 0),
        diggCount: Number(statsObj.diggCount ?? statsObj.digg_count ?? 0),
        commentCount: Number(statsObj.commentCount ?? statsObj.comment_count ?? 0),
        collectCount: Number(statsObj.collectCount ?? statsObj.collect_count ?? 0),
        shareCount: Number(statsObj.shareCount ?? statsObj.share_count ?? 0),
      },
      author: {
        uniqueId: String(authorObj.uniqueId ?? authorObj.unique_id ?? ""),
        nickname: String(authorObj.nickname ?? ""),
        secUid: String(authorObj.secUid ?? authorObj.sec_uid ?? ""),
      },
      music: {
        title: String(musicObj.title ?? ""),
        authorName: String(musicObj.authorName ?? musicObj.author ?? ""),
        original: Boolean(musicObj.original ?? false),
      },
      video: {
        duration: Number(videoObj.duration ?? 0),
        id: String(videoObj.id ?? videoId),
      },
      duetEnabled: Boolean(item.duetEnabled ?? item.duet_enabled ?? false),
      stitchEnabled: Boolean(item.stitchEnabled ?? item.stitch_enabled ?? false),
      isAd: Boolean(item.isAd ?? item.is_ad ?? false),
      challenges: Array.isArray(item.challenges)
        ? (item.challenges as Array<Record<string, unknown>>).map(c => ({ title: String(c.title ?? "") }))
        : [],
      textExtra: Array.isArray(item.textExtra ?? item.text_extra)
        ? ((item.textExtra ?? item.text_extra) as Array<Record<string, unknown>>).map(te => ({
            hashtagName: String(te.hashtagName ?? te.hashtag_name ?? ""),
          }))
        : [],
    });
  }

  return items;
}

// ─── Orchestrator / Public API ────────────────────────────────────────────────

const STRATEGY_NAME = "search_xhr_scroll";

/**
 * Search TikTok for videos matching a keyword.
 *
 * Runs the search_xhr_scroll strategy; on a TRANSIENT failure (context/page
 * death, nav abort — see isTransientSearchFailure) retries ONCE on a fresh
 * owned context, never reusing the possibly-dead shared context. Clean empties
 * are terminal. The orchestrator records all scrape_events (see module header
 * for the marking contract).
 */
export async function searchTikTokVideos(
  keyword: string,
  _options?: { cursor?: number; searchId?: string },
  sharedContext?: import("playwright").BrowserContext,
): Promise<TikTokSearchResponse> {
  const searchUrlForLog = `https://www.tiktok.com/search/video?q=${encodeURIComponent(keyword)}`;

  const first = await attemptSearchXhrScroll(keyword, sharedContext);

  let final = first;
  let retried = false;
  if (first.outcome === "error" && isTransientSearchFailure(first.errorMessage)) {
    // Record the superseded attempt with the "search " prefix so the run-panel
    // query math skips it (one query = one terminal record).
    recordScrapeEvent({
      platform: "tiktok", scrapeMethod: "tiktok_search_xhr",
      urlRequested: `${searchUrlForLog}#search=${STRATEGY_NAME}:transient-retry`,
      httpStatus: first.navStatus,
      failureReason: `search ${STRATEGY_NAME}: transient — ${String(first.errorMessage).slice(0, 400)}`,
      durationMs: first.durationMs,
    });
    console.warn(`[searchScraper] "${keyword}": transient failure — retrying once on a fresh context`);
    await randomDelay(2000, 4000);
    retried = true;
    // Fresh owned context on purpose: the shared context is the prime suspect.
    final = await attemptSearchXhrScroll(keyword, undefined);
  }

  // Exactly one unmarked terminal event per query (Session 9/10 panel contract).
  const fragment = `#search=${STRATEGY_NAME}:${final.outcome}${retried ? "-after-retry" : ""}`;
  if (final.outcome === "success") {
    recordScrapeEvent({
      platform: "tiktok", scrapeMethod: "tiktok_search_xhr",
      urlRequested: `${searchUrlForLog}${fragment}`,
      httpStatus: final.navStatus, durationMs: final.durationMs,
    });
    return final.response!;
  }
  if (final.outcome === "empty") {
    recordScrapeEvent({
      platform: "tiktok", scrapeMethod: "tiktok_search_xhr",
      urlRequested: `${searchUrlForLog}${fragment}`,
      httpStatus: final.navStatus, silentFailureDetected: true,
      failureReason: "no results via XHR capture",
      durationMs: final.durationMs,
    });
    console.warn(`[searchScraper] All search attempts exhausted for "${keyword}"`);
    return { item_list: [], has_more: false };
  }
  recordScrapeEvent({
    platform: "tiktok", scrapeMethod: "tiktok_search_xhr",
    urlRequested: `${searchUrlForLog}${fragment}`,
    httpStatus: final.navStatus,
    failureReason: String(final.errorMessage ?? "unknown error").slice(0, 500),
    durationMs: final.durationMs,
  });
  console.warn(`[searchScraper] All search attempts exhausted for "${keyword}"`);
  return { item_list: [], has_more: false };
}
