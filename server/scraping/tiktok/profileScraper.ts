/**
 * TikTok Profile Scraper — strategy-chain structure (scraper-reliability session).
 *
 * Two named strategies with distinct roles, orchestrated by fetchProfileHtml:
 *
 *   profile_rehydration_http — fast HTTP fetch of the mobile profile page for
 *                              user info (bio, stats, secUid) via rehydration
 *                              JSON. Supplementary; never yields video lists
 *                              (TikTok strips itemList from SSR HTML).
 *   profile_xhr_scroll       — Playwright navigation + /api/post/item_list XHR
 *                              interception with cursor-pagination scrolling.
 *                              The PRIMARY (and only reliable) video source.
 *
 * Empty-capture retry (scraper-reliability Part 2): when profile_xhr_scroll
 * comes back with ZERO videos, the orchestrator classifies the empty before
 * giving up — see classifyEmptyCapture(). Only a CONFIRMED videoCount of 0
 * from a healthy structured read (XHR user-detail or rehydration JSON) means
 * "genuinely no content" (clean fast reject downstream, no retry). A stated
 * videoCount > 0, an ABSENT/unreadable videoCount, or a hard attempt failure
 * all mean the empty is not proven → ONE bounded retry on a fresh context.
 * Rationale (approved amendment): a wasted retry costs seconds; a false
 * "no public content" rejection has caused subject deletions twice.
 *
 * REMOVED (scraper-reliability Part 0, telemetry 2026-06-19 → 2026-07-25):
 *   - Path A desktop HTTP: dead code since FIX 3.4 skipped it (TikTok returns
 *     a JS shell page with no data; wasted 8-15s of retries per run).
 *   - Path D Google webcache: 3 successes in 12 lifetime attempts, the rest
 *     HTTP 429 (all-failed in 5 of the 7 runs that reached it). Google retired
 *     webcache in 2024 — do not restore without evidence it exists again.
 *
 * Telemetry contract (Session 9/10 run-panel math depends on it):
 *   - ONE UNMARKED terminal scrape_event per profile_xhr_scroll invocation
 *     (tiktok_playwright; success / silent-failure / error, as before, now with
 *     a `#profile=profile_xhr_scroll:<outcome>` fragment on url_requested).
 *   - A superseded attempt that the empty-capture retry replaced is recorded
 *     with failure_reason prefixed "profile " — excluded from the run-panel's
 *     path-failure math exactly like "transcript " attempt records.
 *   - profile_rehydration_http download telemetry is emitted by httpClient
 *     (tiktok_desktop_http rows), unchanged.
 *
 * Each path runs detectSilentFailure() before returning.
 * requestGovernor("tiktok") enforces human-pattern timing.
 */

import { fetchHtml, detectSilentFailure, requestGovernor, randomMobileUserAgent, recordScrapeEvent } from "../httpClient";
import { getContext, warmSession, retireContext } from "../browserClient";
// The ONE shared author check every pool source must use — see shared/authorMatch.
import { isAuthorMatch } from "@shared/authorMatch";

// ─── Response Types (mirror Forge API response shapes — unchanged from Phase 1) ──

/** Matches the shape consumed at webResearch.ts and brandTikTokAnalysis.ts */
export interface TikTokUserInfoResponse {
  userInfo: {
    user: {
      id: string;
      secUid: string;
      uniqueId: string;
      nickname: string;
      signature: string;
      avatarLarger?: string;
      verified?: boolean;
    };
    stats: {
      followerCount: number;
      followingCount: number;
      heartCount: number;
      videoCount: number;
      diggCount?: number;
    };
  };
}

/** Matches the shape consumed at webResearch.ts */
export interface TikTokPostListResponse {
  data: {
    itemList: TikTokVideoItem[];
    cursor?: number;
    hasMore?: boolean;
  };
}

export interface TikTokVideoItem {
  id: string;
  desc: string;
  createTime: number;
  stats: {
    playCount: number;
    diggCount: number;
    commentCount: number;
    collectCount: number;
    shareCount: number;
  };
  music: {
    title: string;
    authorName: string;
    original: boolean;
  };
  video: {
    duration: number;
    id?: string;
  };
  author: {
    uniqueId: string;
    nickname: string;
    secUid: string;
  };
  duetEnabled: boolean;
  stitchEnabled: boolean;
  isAd: boolean;
  challenges?: Array<{ title: string }>;
  textExtra?: Array<{ hashtagName?: string; type?: number }>;
}

// ─── Rehydration Data Types ───────────────────────────────────────────────────

interface RehydrationData {
  __DEFAULT_SCOPE__?: {
    "webapp.user-detail"?: {
      userInfo?: {
        user?: Record<string, unknown>;
        stats?: Record<string, unknown>;
      };
      itemList?: unknown[];
    };
  };
}

// ─── Strategy: profile_rehydration_http (mobile web) ─────────────────────────

async function fetchViaMobileWeb(handle: string): Promise<{ html: string; source: string } | null> {
  try {
    await requestGovernor("tiktok");
    const url = `https://m.tiktok.com/@${handle}`;
    const html = await fetchHtml(url, {
      extraHeaders: {
        Referer: "https://m.tiktok.com/",
        "User-Agent": randomMobileUserAgent(),
      },
    });

    const check = detectSilentFailure("tiktok", html, url);
    if (check.isFailed) {
      console.warn(`[profileScraper] Path B (mobile web) silent failure: ${check.reason}`);
      return null;
    }

    return { html, source: "mobile-web" };
  } catch (err) {
    console.warn(`[profileScraper] Path B (mobile web) failed:`, (err as Error).message);
    return null;
  }
}

// ─── Strategy: profile_xhr_scroll (Playwright + XHR interception) ────────────

interface PlaywrightResult {
  html: string;
  source: string;
  /** Captured video items from XHR interception (ACCUMULATED from multiple XHR responses) */
  xhrVideoItems?: unknown[];
  /** Captured user detail from XHR interception */
  xhrUserDetail?: Record<string, unknown>;
}

/** Attempt-level event payload; the ORCHESTRATOR records it (so a superseded
 * attempt can be marked with the "profile " prefix — see module header). */
interface ProfileAttemptEvent {
  httpStatus?: number;
  responseSizeBytes?: number;
  silentFailureDetected?: boolean;
  failureReason?: string;
  durationMs: number;
}

async function attemptProfileXhrScroll(
  handle: string,
): Promise<{ result: PlaywrightResult | null; event: ProfileAttemptEvent }> {
  let ctx: Awaited<ReturnType<typeof getContext>> | null = null;
  const scrapeStart = Date.now();
  const profileUrl = `https://www.tiktok.com/@${handle}`;
  let navStatus: number | undefined;
  try {
    await requestGovernor("tiktok");
    ctx = await getContext("desktop-chrome");
    const { page, context } = ctx;

    // ── XHR Interception Setup ──
    // ACCUMULATE video items from ALL XHR responses (not just the first)
    const capturedVideoItems: unknown[] = [];
    let capturedUserDetail: Record<string, unknown> | null = null;
    let xhrResponseCount = 0;
    // Session 11 (Commit 5): the feed's own pagination signal, updated from each
    // item_list response, so the scroll loop below knows when there are no more
    // pages. Undefined until we see one; an explicit false stops paging.
    let lastHasMore: boolean | undefined;

    page.on("response", async (response) => {
      try {
        const url = response.url();
        // Session 10 (1a): match ONLY the creator's own post-list endpoint.
        // The bare `item_list` substring also matched TikTok's recommended /
        // related / trending feeds (/api/recommend/item_list/, /api/related/…),
        // which injected other creators' videos into the pool. Narrowed to the
        // /api/post/item_list endpoint (covers both the trailing "/" and "?").
        if (url.includes("/api/post/item_list")) {
          const status = response.status();
          if (status === 200) {
            const body = await response.json().catch(() => null);
            if (body) {
              const items = (body as Record<string, unknown>).itemList as unknown[]
                ?? (body as Record<string, unknown>).items as unknown[]
                ?? [];
              if (items.length > 0) {
                capturedVideoItems.push(...items);  // APPEND, not overwrite
                xhrResponseCount++;
                console.log(`[profileScraper] @${handle}: XHR response #${xhrResponseCount} captured ${items.length} videos (running total: ${capturedVideoItems.length})`);
              }
              // Session 11 (Commit 5): capture the feed's pagination signal so the
              // scroll loop can stop when TikTok reports no further cursor pages.
              const b = body as Record<string, unknown>;
              if ("hasMore" in b || "has_more" in b) {
                lastHasMore = Boolean(b.hasMore ?? b.has_more ?? false);
              }
            }
          }
        }

        // Intercept user detail API
        if (
          url.includes("/api/user/detail/") ||
          url.includes("/api/user/detail?") ||
          url.includes("user/detail") ||
          url.includes("webapp/user-detail")
        ) {
          const status = response.status();
          if (status === 200) {
            const body = await response.json().catch(() => null);
            if (body && !capturedUserDetail) {
              capturedUserDetail = body as Record<string, unknown>;
              console.log(`[profileScraper] @${handle}: XHR captured user detail API response`);
            }
          }
        }
      } catch { /* response body read failure — ignore */ }
    });

    // Session warming: visit homepage first
    await warmSession(page, "https://www.tiktok.com/", 2000, 4000);

    // Navigate to profile — use networkidle for full JS execution
    const url = profileUrl;
    const navResponse = await page.goto(url, { waitUntil: "networkidle", timeout: 25000 }).catch((err: Error) => {
      // FIX 1.2: Log navigation failure instead of silently swallowing
      console.warn(`[tiktokScraper] @${handle}: navigation failed (page may still be usable): ${err.message}`);
      return null;
    });
    navStatus = navResponse?.status();

    // Wait for rehydration data to appear
    await page.waitForSelector("#__UNIVERSAL_DATA_FOR_REHYDRATION__", { timeout: 8000 }).catch((err: Error) => {
      console.warn(`[tiktokScraper] @${handle}: rehydration data not found: ${err.message}`);
    });

    // ── CURSOR PAGINATION via infinite scroll (Session 11, Commit 5) ──
    // TikTok's item_list endpoint requires signed params we can't forge, so we
    // drive its cursor the way the site does: scroll to the bottom and let the
    // page fetch the next cursor page, capturing each item_list XHR above. The old
    // code scrolled 6 fixed pixel offsets and stopped — under-sampling large
    // channels (whatever ~6 shallow scrolls happened to load). Now we page until
    // we hit the cap, the feed reports no more pages (hasMore=false), or two
    // rounds add nothing (safety). Every captured item is author-guarded
    // downstream, so a wider pool cannot admit foreign videos.
    //
    // Cap rationale: 6-3-3 needs 12 sampled videos (with transcripts) and D-23
    // wants a trailing-90-day recency window. 90 videos covers the full 90 days
    // even for a daily poster, reaches the mid bucket organically for typical
    // 2-3x/week creators, and is a ~7x margin over the sample — far below fetching
    // a whole back-catalogue.
    const MAX_POOL_VIDEOS = 90;
    const MAX_SCROLL_ROUNDS = 15; // hard safety bound (~1.2-2.2s per round)
    let scrollRounds = 0;
    let lastCount = -1;
    let stagnantRounds = 0;
    while (
      scrollRounds < MAX_SCROLL_ROUNDS &&
      capturedVideoItems.length < MAX_POOL_VIDEOS &&
      lastHasMore !== false &&
      stagnantRounds < 2
    ) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      // Random delay between 1.2s and 2.2s to appear human
      await page.waitForTimeout(1200 + Math.floor(Math.random() * 1000));
      scrollRounds++;
      if (capturedVideoItems.length === lastCount) stagnantRounds++;
      else stagnantRounds = 0;
      lastCount = capturedVideoItems.length;
    }

    // Extra wait for any final XHR responses to complete
    await page.waitForTimeout(3000);
    console.log(`[profileScraper] @${handle}: pagination stopped after ${scrollRounds} round(s) — ${capturedVideoItems.length} videos (cap ${MAX_POOL_VIDEOS}, hasMore=${String(lastHasMore)})`);

    console.log(`[profileScraper] @${handle}: Playwright scroll complete — ${xhrResponseCount} XHR responses, ${capturedVideoItems.length} total videos captured`);

    const html = await page.content();

    const check = detectSilentFailure("tiktok", html, url, page.url());
    if (check.isFailed && capturedVideoItems.length === 0 && !capturedUserDetail) {
      console.warn(`[profileScraper] profile_xhr_scroll silent failure: ${check.reason}`);
      await retireContext(context);
      return {
        result: null,
        event: {
          httpStatus: navStatus, responseSizeBytes: html.length,
          silentFailureDetected: true, failureReason: check.reason,
          durationMs: Date.now() - scrapeStart,
        },
      };
    }

    await page.close();
    return {
      result: {
        html,
        source: "playwright-desktop",
        xhrVideoItems: capturedVideoItems.length > 0 ? capturedVideoItems : undefined,
        xhrUserDetail: capturedUserDetail ?? undefined,
      },
      event: {
        httpStatus: navStatus, responseSizeBytes: html.length,
        silentFailureDetected: check.isFailed,
        failureReason: check.isFailed ? check.reason : undefined,
        durationMs: Date.now() - scrapeStart,
      },
    };
  } catch (err) {
    console.warn(`[profileScraper] profile_xhr_scroll failed:`, (err as Error).message);
    if (ctx) {
      try { await ctx.page.close(); } catch { /* ignore */ }
    }
    return {
      result: null,
      event: {
        httpStatus: navStatus,
        failureReason: (err as Error).message.slice(0, 500),
        durationMs: Date.now() - scrapeStart,
      },
    };
  }
}

// ─── oEmbed for individual video metadata ────────────────────────────────────

interface OEmbedResponse {
  author_name?: string;
  author_url?: string;
  title?: string;
  thumbnail_url?: string;
}

async function fetchOEmbed(handle: string, videoId: string): Promise<OEmbedResponse | null> {
  try {
    const url = `https://www.tiktok.com/oembed?url=https://www.tiktok.com/@${handle}/video/${videoId}`;
    const text = await fetchHtml(url, { timeout: 8000, maxRetries: 1 });
    return JSON.parse(text) as OEmbedResponse;
  } catch {
    return null;
  }
}

// ─── Empty-capture discriminator (scraper-reliability Part 2) ────────────────

/** How the stated videoCount was read; structured sources are "healthy" reads. */
export type StatedCountSource = "xhr" | "rehydration" | "regex" | null;

export interface ProfileCaptureAssessment {
  /** Videos in the final capture (XHR + rehydration supplement). */
  videosCaptured: number;
  /** The profile's own stated videoCount, when readable; null = absent/unreadable. */
  statedVideoCount: number | null;
  statedCountSource: StatedCountSource;
  /** True when the bounded empty-capture retry ran. */
  emptyCaptureRetried: boolean;
  /** True only for a CONFIRMED 0 from a healthy structured read. */
  genuineEmpty: boolean;
}

/**
 * Decide what an empty video capture means (approved amendment 1):
 *   - statedVideoCount === 0 from a HEALTHY structured read (XHR user-detail or
 *     rehydration JSON) → "genuine_empty": the creator truly has no public
 *     posts; reject cleanly and fast, never retry.
 *   - anything else — stated > 0, or ABSENT/unreadable (degraded captures lose
 *     profile fields), or only a weak regex read of 0 — → "retry": the empty is
 *     unproven. A wasted retry costs seconds; a false "no public content"
 *     rejection has caused subject deletions and orphaned telemetry twice.
 * Exported for tests.
 */
export function classifyEmptyCapture(input: {
  statedVideoCount: number | null;
  statedCountSource: StatedCountSource;
}): "genuine_empty" | "retry" {
  if (
    input.statedVideoCount === 0 &&
    (input.statedCountSource === "xhr" || input.statedCountSource === "rehydration")
  ) {
    return "genuine_empty";
  }
  return "retry";
}

/** Read the profile's own stated videoCount from the best available source. */
function readStatedVideoCount(
  xhrUserDetail: Record<string, unknown> | undefined,
  html: string | null,
): { statedVideoCount: number | null; statedCountSource: StatedCountSource } {
  // 1. XHR user-detail (structured)
  const xhrInfo = xhrUserDetail?.userInfo as Record<string, unknown> | undefined;
  const xhrStats = (xhrInfo?.stats ?? (xhrUserDetail as Record<string, unknown> | undefined)?.stats) as
    | Record<string, unknown>
    | undefined;
  if (xhrStats && xhrStats.videoCount != null && Number.isFinite(Number(xhrStats.videoCount))) {
    return { statedVideoCount: Number(xhrStats.videoCount), statedCountSource: "xhr" };
  }
  // 2. Rehydration JSON (structured)
  if (html) {
    const pageData = extractRehydrationData(html);
    const stats = pageData?.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.userInfo?.stats as
      | Record<string, unknown>
      | undefined;
    if (stats && stats.videoCount != null && Number.isFinite(Number(stats.videoCount))) {
      return { statedVideoCount: Number(stats.videoCount), statedCountSource: "rehydration" };
    }
    // 3. Regex (weak — a 0 here never proves genuine-empty)
    const m = html.match(/"videoCount":(\d+)/);
    if (m?.[1]) {
      return { statedVideoCount: parseInt(m[1], 10), statedCountSource: "regex" };
    }
  }
  return { statedVideoCount: null, statedCountSource: null };
}

// ─── Multi-Path Orchestrator ─────────────────────────────────────────────────

interface FetchResult {
  html: string;
  source: string;
  xhrVideoItems?: unknown[];
  xhrUserDetail?: Record<string, unknown>;
  /** Present when video capture ran (retryEmptyCapture callers). */
  capture?: ProfileCaptureAssessment;
  /** Base fields from a leg that reads them directly. See profile_embed_json. */
  baseFields?: TikTokBaseFields | null;
  /**
   * Videos harvested off the rendered grid, in TikTok's own item shape so they
   * merge through the SAME `parseItemList` and author guard as every other pool
   * source. Present only when the XHR pool came back empty — see the harvest
   * block in `fetchProfileHtml`.
   */
  renderedGridItems?: Array<Record<string, unknown>>;
}

/** Record one profile_xhr_scroll attempt event (see module-header contract). */
function recordProfileAttempt(
  handle: string,
  event: ProfileAttemptEvent,
  outcome: string,
  opts: { superseded: boolean },
): void {
  const url = `https://www.tiktok.com/@${handle}#profile=profile_xhr_scroll:${outcome}`;
  recordScrapeEvent({
    platform: "tiktok",
    scrapeMethod: "tiktok_playwright",
    urlRequested: url,
    httpStatus: event.httpStatus,
    responseSizeBytes: event.responseSizeBytes,
    silentFailureDetected: opts.superseded ? undefined : event.silentFailureDetected,
    failureReason: opts.superseded
      ? `profile profile_xhr_scroll: superseded by retry — ${event.failureReason ?? "empty capture"}`.slice(0, 500)
      : event.failureReason,
    durationMs: event.durationMs,
  });
}

/**
 * Two-phase profile fetch:
 *   Phase 1: profile_rehydration_http for user info (fast — bio, stats, secUid)
 *   Phase 2: ALWAYS profile_xhr_scroll for video collection
 *
 * The HTTP path never has video lists (TikTok strips itemList from SSR HTML).
 * Playwright XHR interception is the ONLY reliable video source.
 *
 * opts.retryEmptyCapture (creator pipeline): when Phase 2 produces ZERO videos
 * or fails outright, classify via classifyEmptyCapture() and run ONE bounded
 * retry on a fresh context unless the empty is a confirmed genuine-empty.
 * User-info-only callers (brand path) leave it off — no behavior change there.
 */
async function fetchProfileHtml(
  handle: string,
  opts?: { retryEmptyCapture?: boolean },
): Promise<FetchResult> {
  /*
    ── Leg 1: profile_embed_json ────────────────────────────────────────────
    FIRST because it is the only source that returned base fields for every
    account tested while the other two legs were being refused: 3/3 on the
    handles the pipeline had just parked, in the same minute they 403'd here.
    It hits a DIFFERENT endpoint from the other two (which both target
    tiktok.com/@handle and therefore share one refusal), so it is a leg rather
    than a third attempt at the same door.

    It supplies base fields ONLY — no video list, no secUid — so it never
    short-circuits the rest of the chain. Phases 1 and 2 still run for the pool
    and for the exact counts they carry when they work.
  */
  const embed = await attemptProfileEmbedJson(handle);
  let embedFields = embed.outcome === "success" ? embed.fields : null;

  // ── Phase 1: Fast HTTP for user info (bio, stats, secUid) ──
  let httpHtml: string | null = null;
  let httpSource = "";

  const pathHttp = await fetchViaMobileWeb(handle);
  if (pathHttp) {
    httpHtml = pathHttp.html;
    httpSource = pathHttp.source;
    console.log(`[profileScraper] @${handle}: Phase 1 — HTTP user info via mobile web`);
  }

  // ── Phase 2: ALWAYS run profile_xhr_scroll for video collection ──
  console.log(`[profileScraper] @${handle}: Phase 2 — profile_xhr_scroll for video collection (always runs)`);
  let attempt = await attemptProfileXhrScroll(handle);
  let emptyCaptureRetried = false;

  // ── Empty-capture classification + bounded retry (Part 2) ──
  const capturedCount = attempt.result?.xhrVideoItems?.length ?? 0;
  let stated = readStatedVideoCount(attempt.result?.xhrUserDetail, attempt.result?.html ?? httpHtml);
  if (opts?.retryEmptyCapture && capturedCount === 0) {
    const classification = classifyEmptyCapture(stated);
    if (classification === "retry") {
      // Mark the superseded attempt, then retry once on a fresh context.
      recordProfileAttempt(handle, attempt.event, attempt.result ? "empty-retrying" : "error-retrying", { superseded: true });
      console.warn(
        `[profileScraper] @${handle}: empty capture (stated videoCount=${stated.statedVideoCount ?? "unknown"}, source=${stated.statedCountSource ?? "none"}) — retrying once`,
      );
      await new Promise((r) => setTimeout(r, 2000 + Math.floor(Math.random() * 2000)));
      emptyCaptureRetried = true;
      attempt = await attemptProfileXhrScroll(handle);
      stated = readStatedVideoCount(attempt.result?.xhrUserDetail, attempt.result?.html ?? httpHtml);
    } else {
      console.log(`[profileScraper] @${handle}: confirmed genuine-empty (stated videoCount=0 via ${stated.statedCountSource}) — no retry`);
    }
  }

  const finalCount = attempt.result?.xhrVideoItems?.length ?? 0;
  const terminalOutcome = attempt.result
    ? (finalCount > 0 ? "success" : "empty")
    : (attempt.event.silentFailureDetected ? "silent_failure" : "error");
  recordProfileAttempt(handle, attempt.event, `${terminalOutcome}${emptyCaptureRetried ? "-after-retry" : ""}`, { superseded: false });

  /*
    ── SECOND POOL SOURCE ────────────────────────────────────────────────────
    THE GATE IS THE POOL, NOT THE BASE FIELDS. `profile_rendered_text` used to
    run only under `if (!embedFields)` — and since profile_embed_json answers
    15/15, it had never run in production at all. That gate asks "do we still
    need a follower count?", which is the wrong question for a pool: on
    2026-07-30 the embed leg answered perfectly for all five creators while
    profile_xhr_scroll returned zero videos for all five, so the base-field gate
    was closed at exactly the moment the pool needed a second source.

    So the harvest is gated on `finalCount === 0` — the pool being empty —
    independently of whether base fields succeeded. When the header is ALSO
    still missing, the one navigation serves both and the base-field call below
    is skipped rather than repeated.
  */
  let renderedGrid: RenderedGridHarvest | undefined;
  let renderedLeg: ProfileLegResult | null = null;
  if (finalCount === 0) {
    renderedLeg = await attemptProfileRenderedText(handle, { harvestGrid: true });
    renderedGrid = renderedLeg.grid;
    // The header half is free once we are here; take it if we still lack fields.
    if (!embedFields && renderedLeg.outcome === "success") embedFields = renderedLeg.fields;
  }
  const renderedCount = renderedGrid?.items.length ?? 0;

  const capture: ProfileCaptureAssessment = {
    // The pool this capture actually produced, from whichever legs answered.
    videosCaptured: finalCount + renderedCount,
    statedVideoCount: stated.statedVideoCount,
    statedCountSource: stated.statedCountSource,
    emptyCaptureRetried,
    /*
      UNCHANGED, DELIBERATELY. `genuineEmpty` still requires a CONFIRMED zero
      from a structured read (`classifyEmptyCapture`), and an empty rendered
      grid is not one: the page may have rendered a shell, a challenge, or a
      layout this parser does not know. Widening the proof of absence to include
      "we saw no anchors" is exactly the fail-open that the blocked-vs-empty fix
      exists to prevent. The grid can only ever ADD videos, never prove there are
      none.
    */
    genuineEmpty: finalCount + renderedCount === 0 && classifyEmptyCapture(stated) === "genuine_empty",
  };

  if (attempt.result) {
    console.log(`[profileScraper] @${handle}: Phase 2 — profile_xhr_scroll succeeded: ${finalCount} videos`);
    // Merge: use Playwright HTML + videos, but keep HTTP user info if Playwright didn't capture it
    return {
      html: attempt.result.html,
      source: httpSource ? `${httpSource}+${attempt.result.source}` : attempt.result.source,
      xhrVideoItems: attempt.result.xhrVideoItems,
      xhrUserDetail: attempt.result.xhrUserDetail,
      capture,
      baseFields: embedFields,
      renderedGridItems: renderedGrid?.items,
    };
  }

  console.warn(`[profileScraper] @${handle}: Phase 2 — profile_xhr_scroll failed, falling back to HTTP-only`);

  // Playwright failed entirely — fall back to HTTP HTML only.
  // (The Google-webcache last resort that used to follow was removed — see
  // module header: 3/12 lifetime, 429-walled, webcache retired by Google.)
  if (httpHtml) {
    return {
      html: httpHtml, source: httpSource, capture, baseFields: embedFields,
      renderedGridItems: renderedGrid?.items,
    };
  }

  /*
    THE EMBED LEG IS A FLOOR. If both page-based legs were refused but the embed
    answered, we have a real profile — followers, following, hearts, bio — and
    throwing here would discard it and park a live account as unreachable, which
    is exactly the failure this leg was added to end. No html means no video
    pool, and the gate will still refuse a campaign with no content; but it will
    refuse holding the base fields rather than holding nothing.
  */
  /*
    LAST LEG. Only reached when the embed and both page legs produced nothing —
    at which point one evaluate() on a page we were going to load anyway is the
    difference between a base profile and none.

    `renderedLeg` is checked first so this never navigates twice: when the pool
    was empty the rendered read has ALREADY run above (for the grid) and its
    header half was taken there.
  */
  if (!embedFields && !renderedLeg) {
    const rendered = await attemptProfileRenderedText(handle);
    if (rendered.outcome === "success") embedFields = rendered.fields;
  }

  if (embedFields) {
    console.warn(
      `[profileScraper] @${handle}: page legs refused — continuing on profile_embed_json base fields alone`,
    );
    return {
      html: "", source: "profile_embed_json", capture, baseFields: embedFields,
      renderedGridItems: renderedGrid?.items,
    };
  }

  /*
    The grid alone is still a capture. If the header was refused but the page
    rendered a usable grid, we have a real pool and no base fields — better than
    throwing, which parks a live account as unreachable.
  */
  if (renderedCount > 0) {
    console.warn(
      `[profileScraper] @${handle}: base fields refused — continuing on profile_rendered_grid alone (${renderedCount} videos)`,
    );
    return {
      html: "", source: "profile_rendered_grid", capture, baseFields: null,
      renderedGridItems: renderedGrid?.items,
    };
  }

  throw new Error(`[profileScraper] All scrape paths failed for @${handle}`);
}

// ─── Public API (same signatures as Phase 1) ─────────────────────────────────

/**
 * Fetch TikTok user info from the profile page.
 * Returns the same shape as the Phase 1 version.
 */
export async function scrapeTikTokUserInfo(
  handle: string,
): Promise<TikTokUserInfoResponse> {
  const { html, source } = await fetchProfileHtml(handle);
  const pageData = extractRehydrationData(html);
  const userDetail = pageData?.__DEFAULT_SCOPE__?.["webapp.user-detail"];

  if (!userDetail?.userInfo) {
    return extractUserInfoFromRegex(html, handle);
  }

  const user = (userDetail.userInfo.user ?? {}) as Record<string, unknown>;
  const stats = (userDetail.userInfo.stats ?? {}) as Record<string, unknown>;

  console.log(`[profileScraper] @${handle}: user info extracted via ${source}`);

  return {
    userInfo: {
      user: {
        id: String(user.id ?? ""),
        secUid: String(user.secUid ?? ""),
        uniqueId: String(user.uniqueId ?? handle),
        nickname: String(user.nickname ?? handle),
        signature: String(user.signature ?? ""),
        avatarLarger: (user.avatarLarger as string) ?? undefined,
        verified: Boolean(user.verified ?? false),
      },
      stats: {
        followerCount: Number(stats.followerCount ?? 0),
        followingCount: Number(stats.followingCount ?? 0),
        heartCount: Number(stats.heartCount ?? stats.heart ?? 0),
        videoCount: Number(stats.videoCount ?? 0),
        diggCount: Number(stats.diggCount ?? 0),
      },
    },
  };
}

/**
 * Fetch user's post list from the profile page.
 * Returns the same shape as the Phase 1 version.
 */
export async function scrapeTikTokUserPosts(
  handle: string,
): Promise<TikTokPostListResponse> {
  const { html, source } = await fetchProfileHtml(handle);
  const pageData = extractRehydrationData(html);
  const userDetail = pageData?.__DEFAULT_SCOPE__?.["webapp.user-detail"];
  const rawItemList = (userDetail?.itemList as unknown[]) ?? [];
  const itemList = parseItemList(rawItemList, handle);

  console.log(`[profileScraper] @${handle}: ${itemList.length} videos extracted via ${source}`);

  return {
    data: {
      itemList,
      hasMore: false,
    },
  };
}

/**
 * Fetch popular posts sorted by play count.
 */
export async function scrapeTikTokPopularPosts(
  handle: string,
): Promise<TikTokPostListResponse> {
  const postsResponse = await scrapeTikTokUserPosts(handle);
  const sorted = [...postsResponse.data.itemList].sort(
    (a, b) => (b.stats.playCount ?? 0) - (a.stats.playCount ?? 0),
  );

  return {
    data: {
      itemList: sorted.slice(0, 20),
      hasMore: false,
    },
  };
}

/**
 * Combined scrape: returns user info, post list, and the capture assessment
 * (scraper-reliability Part 2 — the creator pipeline uses it to distinguish a
 * transient empty capture from a genuinely postless creator).
 */
export async function scrapeTikTokProfile(handle: string): Promise<{
  userInfo: TikTokUserInfoResponse;
  posts: TikTokPostListResponse;
  capture?: ProfileCaptureAssessment;
}> {
  const fetchResult = await fetchProfileHtml(handle, { retryEmptyCapture: true });
  const { html, source, xhrVideoItems, xhrUserDetail } = fetchResult;
  const pageData = extractRehydrationData(html);
  const userDetail = pageData?.__DEFAULT_SCOPE__?.["webapp.user-detail"];

  // ── User Info ──
  // Priority: XHR user detail > rehydration data > regex fallback
  let userInfo: TikTokUserInfoResponse;

  // Try XHR-captured user detail first
  const xhrUserInfo = xhrUserDetail?.userInfo as Record<string, unknown> | undefined
    ?? (xhrUserDetail as Record<string, unknown>)?.user ? xhrUserDetail : undefined;

  if (xhrUserInfo) {
    const user = ((xhrUserInfo as Record<string, unknown>).user ?? xhrUserInfo) as Record<string, unknown>;
    const stats = ((xhrUserInfo as Record<string, unknown>).stats ?? {}) as Record<string, unknown>;
    userInfo = {
      userInfo: {
        user: {
          id: String(user.id ?? ""),
          secUid: String(user.secUid ?? ""),
          uniqueId: String(user.uniqueId ?? handle),
          nickname: String(user.nickname ?? handle),
          signature: String(user.signature ?? ""),
          avatarLarger: (user.avatarLarger as string) ?? undefined,
          verified: Boolean(user.verified ?? false),
        },
        stats: {
          followerCount: Number(stats.followerCount ?? 0),
          followingCount: Number(stats.followingCount ?? 0),
          heartCount: Number(stats.heartCount ?? stats.heart ?? 0),
          videoCount: Number(stats.videoCount ?? 0),
          diggCount: Number(stats.diggCount ?? 0),
        },
      },
    };
    console.log(`[profileScraper] @${handle}: user info from XHR interception`);
  } else if (userDetail?.userInfo) {
    const user = (userDetail.userInfo.user ?? {}) as Record<string, unknown>;
    const stats = (userDetail.userInfo.stats ?? {}) as Record<string, unknown>;
    userInfo = {
      userInfo: {
        user: {
          id: String(user.id ?? ""),
          secUid: String(user.secUid ?? ""),
          uniqueId: String(user.uniqueId ?? handle),
          nickname: String(user.nickname ?? handle),
          signature: String(user.signature ?? ""),
          avatarLarger: (user.avatarLarger as string) ?? undefined,
          verified: Boolean(user.verified ?? false),
        },
        stats: {
          followerCount: Number(stats.followerCount ?? 0),
          followingCount: Number(stats.followingCount ?? 0),
          heartCount: Number(stats.heartCount ?? stats.heart ?? 0),
          videoCount: Number(stats.videoCount ?? 0),
          diggCount: Number(stats.diggCount ?? 0),
        },
      },
    };
  } else {
    userInfo = extractUserInfoFromRegex(html, handle);
  }

  /*
    MERGE, NEVER OVERWRITE. The XHR and rehydration reads are EXACT; the embed
    is a separate fetch that may be seconds stale. So the embed only fills a
    field the structured reads left at zero — which, when they are being
    refused, is all of them.
  */
  const bf = fetchResult.baseFields;
  if (bf) {
    const st = userInfo.userInfo.stats;
    const us = userInfo.userInfo.user;
    if (!(st.followerCount > 0) && bf.followerCount != null) st.followerCount = bf.followerCount;
    if (!(st.followingCount > 0) && bf.followingCount != null) st.followingCount = bf.followingCount;
    if (!(st.heartCount > 0) && bf.heartCount != null) st.heartCount = bf.heartCount;
    if (!(st.videoCount > 0) && bf.videoCount != null) st.videoCount = bf.videoCount;
    if (!us.signature && bf.signature) us.signature = bf.signature;
    if (!us.nickname || us.nickname === handle) us.nickname = bf.nickname ?? us.nickname;
    if (!us.secUid && bf.secUid) us.secUid = bf.secUid;
    if (bf.verified != null && !us.verified) us.verified = bf.verified;
  }

  // ── Post List ──
  // Priority: XHR video items > rehydration itemList
  // Playwright is now the PRIMARY video source (always runs in fetchProfileHtml),
  // so we no longer need a separate Playwright fallback here.
  let itemList: TikTokVideoItem[] = [];
  let finalSource = source;

  if (xhrVideoItems && xhrVideoItems.length > 0) {
    // Best path: XHR-captured video list with full engagement stats
    itemList = parseItemList(xhrVideoItems, handle);
    finalSource = `${source}+xhr-video-list`;
    console.log(`[profileScraper] @${handle}: ${itemList.length} videos from XHR interception`);
  }

  // Supplemental: if XHR got < 5 videos, also check rehydration data
  if (itemList.length < 5) {
    const rawItemList = (userDetail?.itemList as unknown[]) ?? [];
    const rehydrationItems = parseItemList(rawItemList, handle);
    if (rehydrationItems.length > 0) {
      // Merge, dedup by video ID
      const existingIds = new Set(itemList.map(v => v.id));
      const newItems = rehydrationItems.filter(v => !existingIds.has(v.id));
      if (newItems.length > 0) {
        itemList.push(...newItems);
        console.log(`[profileScraper] @${handle}: +${newItems.length} videos from rehydration data (supplemental)`);
      }
    }
  }

  /*
    ── Rendered-grid merge, LAST ─────────────────────────────────────────────
    Last because it is the thinnest source: a grid item carries an id, a caption
    and a display-precision view count, where the two structured sources above
    carry full stats and a real createTime. So it only ever fills a gap the
    others left, and dedup by video id means a video both sources saw keeps the
    structured copy.

    It goes through `parseItemList` like everything else — one shape, one place
    that builds it. The author guard in `fetchTikTokVideosFromAPI` then applies
    to these items exactly as it does to the XHR and search paths.
  */
  const gridRaw = fetchResult.renderedGridItems ?? [];
  if (gridRaw.length > 0) {
    const gridItems = parseItemList(gridRaw, handle);
    const existingIds = new Set(itemList.map(v => v.id));
    const newItems = gridItems.filter(v => !existingIds.has(v.id));
    if (newItems.length > 0) {
      itemList.push(...newItems);
      finalSource = `${finalSource}+profile_rendered_grid`;
      console.log(`[profileScraper] @${handle}: +${newItems.length} videos from profile_rendered_grid`);
    }
  }

  const confidence = itemList.length >= 20 ? "high" : itemList.length >= 5 ? "medium" : "low";
  console.log(`[profileScraper] @${handle}: final result — ${itemList.length} videos, confidence: ${confidence}, via ${finalSource}`);

  // The assessment's videosCaptured reflects the FINAL pool (XHR capture plus
  // the rehydration supplement merged above), not just the XHR attempt.
  const capture: ProfileCaptureAssessment | undefined = fetchResult.capture
    ? { ...fetchResult.capture, videosCaptured: itemList.length, genuineEmpty: itemList.length === 0 && fetchResult.capture.genuineEmpty }
    : undefined;

  return {
    userInfo,
    posts: { data: { itemList, hasMore: false } },
    capture,
  };
}

/** Exported for use by oEmbed supplementation */
export { fetchOEmbed };

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Leg: profile_embed_json ─────────────────────────────────────────────────
//
// THE PRIMARY BASE-FIELD LEG. A plain HTTP GET of the EMBED page, which
// carries the user payload as JSON while the profile URL does not.
//
// Why the embed and not the profile page: profile_xhr_scroll — the only leg
// that ever supplied base fields — went from 85% to 5% between 27 and 30 July.
// The obvious replacement, a direct GET of /@handle, is the leg this codebase
// ALREADY deleted once ("Path A desktop HTTP: dead code since FIX 3.4") and it
// is still dead: it returns a 1,462-byte JS shell with no state container at
// all, measured on gordonramsayofficial, markrober and jamescharles. The embed
// endpoint returns 317-330KB with the payload intact for the same handles, in
// the same minute — it is refused independently of both the profile page and
// the XHR endpoint, which is exactly what makes it a leg rather than a retry.
//
// THE PARSER MUST NOT SILENTLY ACCEPT THE WRONG CONTAINER. If no known state
// container is present, that is `shape_change` — a DISTINCT outcome from "the
// profile is empty" and from "we were blocked". Conflating them is how the last
// drift went unnoticed for fourteen days. This taxonomy earned its keep on its
// first run: pointed at the dead profile URL it correctly reported `blocked` on
// a 1,462-byte stub rather than inventing a TikTok redesign.

export type ProfileLegOutcome =
  | "success"
  | "blocked"        // the platform refused us (403/429/5xx, or a stub body)
  | "shape_change"   // we got a page and neither known container was in it
  | "empty";         // containers present, no user payload — a real absence

export interface ProfileLegResult {
  leg: string;
  outcome: ProfileLegOutcome;
  durationMs: number;
  fields: TikTokBaseFields | null;
  detail?: string;
  /**
   * The video grid read off the same page, when the caller asked for it.
   *
   * Independent of `fields` and of `outcome`: those describe the HEADER read,
   * and the two halves fail separately. A page whose header shape changed can
   * still have rendered a full grid, and throwing the pool away because the
   * follower count moved would repeat the mistake this leg exists to fix.
   */
  grid?: RenderedGridHarvest;
}

/** The base fields a profile leg can supply. Null = this leg did not carry it. */
export interface TikTokBaseFields {
  uniqueId: string | null;
  nickname: string | null;
  signature: string | null;
  followerCount: number | null;
  followingCount: number | null;
  heartCount: number | null;
  videoCount: number | null;
  verified: boolean | null;
  secUid: string | null;
}

const EMBED_BUDGET_MS = 20_000;

/**
 * Pull base fields out of a rehydration document (profile-page shape).
 *
 * Returns `null` when the container exists but carries no user-detail payload,
 * which the caller reports as `empty` — a fact about the account — as opposed
 * to the container being missing entirely, which is a fact about US.
 */
export function baseFieldsFromRehydration(data: RehydrationData | null): TikTokBaseFields | null {
  const detail = data?.__DEFAULT_SCOPE__?.["webapp.user-detail"];
  const info = (detail as { userInfo?: Record<string, unknown> } | undefined)?.userInfo;
  if (!info) return null;
  const user = (info.user ?? {}) as Record<string, unknown>;
  const stats = (info.stats ?? info.statsV2 ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };
  return {
    uniqueId: (user.uniqueId as string) ?? null,
    nickname: (user.nickname as string) ?? null,
    signature: (user.signature as string) ?? null,
    followerCount: num(stats.followerCount),
    followingCount: num(stats.followingCount),
    heartCount: num(stats.heartCount ?? stats.heart),
    videoCount: num(stats.videoCount),
    verified: typeof user.verified === "boolean" ? user.verified : null,
    secUid: (user.secUid as string) ?? null,
  };
}

/** Does this page carry EITHER known state container? */
function hasKnownContainer(html: string): boolean {
  return html.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__") || html.includes("SIGI_STATE");
}

/**
 * The embed page's own payload shape.
 *
 * It is NOT the profile page's `webapp.user-detail` tree — the embed inlines a
 * flatter user object. Parsed with the same null-means-absent discipline so a
 * missing field is never silently a zero.
 *
 * KNOWN GAPS, measured not assumed: the embed carries no `videoCount` and no
 * `secUid`. secUid matters — it is what cursor pagination keys on — so the
 * embed can supply a profile but cannot replace profile_xhr_scroll for pooling.
 */
export function baseFieldsFromEmbed(html: string): TikTokBaseFields | null {
  const pick = (k: string): string | null => {
    const m = html.match(new RegExp(`"${k}":"((?:[^"\\\\]|\\\\.)*)"`));
    return m ? m[1]! : null;
  };
  const pickNum = (k: string): number | null => {
    const m = html.match(new RegExp(`"${k}":(\\d+)`));
    return m ? Number(m[1]) : null;
  };
  const uniqueId = pick("uniqueId");
  const followerCount = pickNum("followerCount");
  // Neither present => this is not an embed payload we understand.
  if (uniqueId === null && followerCount === null) return null;
  const verifiedMatch = html.match(/"verified":(true|false)/);
  return {
    uniqueId,
    nickname: pick("nickname"),
    signature: pick("signature"),
    followerCount,
    followingCount: pickNum("followingCount"),
    heartCount: pickNum("heartCount"),
    videoCount: pickNum("videoCount"),
    verified: verifiedMatch ? verifiedMatch[1] === "true" : null,
    secUid: pick("secUid"),
  };
}

// ─── Leg: profile_rendered_text ──────────────────────────────────────────────
//
// THE FLOOR. Reads base fields out of the rendered page's own text, on a page
// the browser leg is loading anyway — so it costs one evaluate() and nothing
// else. Last in the chain deliberately: it yields fewer fields than the embed
// and none of the exactness of the XHR, and it exists for the case where both
// of those are refused and the alternative is nothing at all.
//
// It reads TEXT, not the JSON containers. That is the point: on 30 July
// jamescharles rendered a full page with 30 video links and its identity block
// in innerText at the same moment profile_xhr_scroll was getting 403/39B on the
// same handle. The render path and the data-fetch paths are refused
// independently, and text survives a container rename that would break both
// JSON readers at once.
//
// HONEST ABOUT ITS OWN RELIABILITY: on the same run markrober rendered an
// 81-character shell and yielded nothing. This leg is a floor, not a fix — it
// reports `blocked` on a shell rather than pretending, and the chain moves on.
const RENDERED_TEXT_SETTLE_MS = 4_000;

/**
 * Parse the profile header out of rendered text.
 *
 * TikTok renders the counts as `<count>\nFollowing`, `<count>\nFollowers`,
 * `<count>\nLikes` — the number is the line BEFORE its label, so matching that
 * way keeps a bio containing the word "followers" from being read as a count.
 * Exported for the harness: this is the whole extraction.
 */
export function parseTikTokRenderedHeader(innerText: string): {
  followersRaw: string | null; followingRaw: string | null; likesRaw: string | null;
} {
  const lines = innerText.split("\n").map(l => l.trim());
  const COUNT = /^[\d.,]+\s*[KMB]?$/i;
  let followersRaw: string | null = null, followingRaw: string | null = null, likesRaw: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const label = lines[i]!.toLowerCase();
    const prev = lines[i - 1]!;
    if (!COUNT.test(prev)) continue;
    if (label === "followers" && followersRaw === null) followersRaw = prev;
    if (label === "following" && followingRaw === null) followingRaw = prev;
    if (label === "likes" && likesRaw === null) likesRaw = prev;
  }
  return { followersRaw, followingRaw, likesRaw };
}

/** "1.6B" -> 1600000000. Display precision: TikTok rounds what it renders. */
export function parseDisplayCount(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, "").trim().match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase()] ?? 1;
  return Math.round(n * mult);
}

// ─── Leg: profile_rendered_grid (the POOL half of the rendered read) ─────────
//
// THE SECOND POOL SOURCE. `profile_xhr_scroll` has been the ONLY one since Path
// A was deleted, and on 2026-07-30 it returned HTTP 403 with a 39-byte body on
// 30 of 30 attempts across five creators — so every pool that day came from
// search augmentation, a SUPPLEMENT carrying the whole load. Volume fell 78%
// (chriswillx 146 videos → 16, khaby.lame 95 → 7) and lynlecheung was refused
// outright.
//
// The grid is on the page the rendered-text leg already navigates. The module
// header above records the decisive observation: jamescharles rendered a full
// page with 30 video links in innerText at the same moment profile_xhr_scroll
// was getting 403/39B on the same handle. Render and data-fetch are refused
// INDEPENDENTLY, which is what makes this a leg and not a retry.
//
// WHAT A TILE CARRIES, and what it does not. An anchor gives the video id and —
// critically — the AUTHOR, because the href is `/@author/video/<id>`. The
// thumbnail's alt text carries the caption. The tile's own text carries a view
// count at DISPLAY precision ("1.2M"). Nothing else is there: no like/comment/
// share/save counts, no music, no duration, and NO createTime. Those are zero
// here and must stay zero — the same rule the Instagram pool item follows, for
// the same reason. A fabricated createTime would be worse than none: the 6-3-3
// sampler sorts on it, so inventing one would silently reorder the sample.
//
// HONEST ABOUT ITS OWN CEILING: a grid item is a POINTER plus a caption. It is
// enough to know a video exists, enough to attribute it, and enough to feed the
// transcript chain — which is what the pool is for.

/** One anchor as read off the rendered grid, before any interpretation. */
export interface RenderedGridTile {
  /** The anchor's href — the only place the author is stated. */
  href: string | null;
  /** Thumbnail alt text; TikTok puts the caption here. */
  alt?: string | null;
  /** The tile's own rendered text; carries a display-precision view count. */
  tileText?: string | null;
}

export interface RenderedGridHarvest {
  /**
   * Author-verified items, in DOM order, shaped like TikTok's own item records
   * so they go through the SAME `parseItemList` and the SAME author guard in
   * `fetchTikTokVideosFromAPI` that every other pool source does.
   */
  items: Array<Record<string, unknown>>;
  /** Anchors refused because the author could not be verified — fail-closed. */
  rejected: number;
  /** Distinct video ids seen, verified or not. */
  anchorsSeen: number;
}

/**
 * Turn rendered grid anchors into pool items. PURE — exported for the harness,
 * because this is the whole extraction and it must be provable without a
 * browser.
 *
 * FAIL-CLOSED ON ATTRIBUTION, exactly as the search path is: an anchor whose
 * href does not state an author that `isAuthorMatch` verifies as this creator
 * is REJECTED and counted. A profile grid is not self-evidently the creator's —
 * TikTok renders reposts and recommendation strips on the same page — so "we
 * are on their profile" is not attribution. The href is.
 */
export function parseRenderedGridTiles(
  handle: string,
  tiles: RenderedGridTile[],
): RenderedGridHarvest {
  const items: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  let rejected = 0;

  for (const tile of tiles) {
    const href = tile.href ?? "";
    // `/@author/video/1234` — both captures required. A bare `/video/<id>` with
    // no author segment is unattributable and therefore refused.
    const m = href.match(/\/@([^/?#]+)\/video\/(\d+)/);
    if (!m) { rejected++; continue; }
    const [, author, videoId] = m;

    if (seen.has(videoId!)) continue;
    seen.add(videoId!);

    if (!isAuthorMatch(handle, author)) { rejected++; continue; }

    // The view count is the only number a tile carries, at display precision.
    // Absent or unparseable → 0, never a guess.
    const views = parseDisplayCount(
      (tile.tileText ?? "").split("\n").map(l => l.trim()).find(l => /^[\d.,]+\s*[KMB]?$/i.test(l)) ?? null,
    ) ?? 0;

    items.push({
      id: videoId,
      desc: (tile.alt ?? "").trim(),
      // NOT KNOWN from a tile. Zero means "unknown" to the sampler, which is
      // the truth; a fabricated timestamp would reorder the 6-3-3 sample.
      createTime: 0,
      stats: { playCount: views, diggCount: 0, commentCount: 0, collectCount: 0, shareCount: 0 },
      music: { title: "", authorName: "", original: false },
      video: { duration: 0, id: videoId },
      author: { uniqueId: author, nickname: "", secUid: "" },
      duetEnabled: false,
      stitchEnabled: false,
      isAd: false,
    });
  }

  return { items, rejected, anchorsSeen: seen.size };
}

export async function attemptProfileRenderedText(
  handle: string,
  /**
   * Harvest the video grid from the same navigation.
   *
   * Off by default so the base-field leg's cost and behaviour are unchanged
   * where it already runs. The caller turns it on when the POOL is empty — see
   * `fetchProfileHtml`, which is where the two needs are reconciled into one
   * navigation.
   */
  opts?: { harvestGrid?: boolean },
): Promise<ProfileLegResult> {
  const started = Date.now();
  const leg = "profile_rendered_text";
  const url = `https://www.tiktok.com/@${handle}`;
  let ctx: Awaited<ReturnType<typeof getContext>> | null = null;
  /** Filled by the grid read below, and attached to EVERY return path. */
  let grid: RenderedGridHarvest | undefined;
  const record = (outcome: ProfileLegOutcome, fields: TikTokBaseFields | null, detail?: string): ProfileLegResult => {
    recordScrapeEvent({
      platform: "tiktok", scrapeMethod: "tiktok_playwright",
      urlRequested: `${url}#profile=${leg}:${outcome}`,
      silentFailureDetected: outcome === "shape_change",
      failureReason: outcome === "success" ? undefined : `profile ${leg}: ${outcome}${detail ? ` — ${detail}` : ""}`,
      durationMs: Date.now() - started,
    });
    return { leg, outcome, durationMs: Date.now() - started, fields, detail, grid };
  };
  /**
   * The grid's OWN terminal event. One per invocation, because the pool half and
   * the header half succeed and fail independently and a single event could only
   * report one of them.
   */
  const recordGrid = (outcome: string, detail?: string): void => {
    recordScrapeEvent({
      platform: "tiktok", scrapeMethod: "tiktok_playwright",
      urlRequested: `${url}#profile=profile_rendered_grid:${outcome}`,
      failureReason: outcome === "success" ? undefined : `profile profile_rendered_grid: ${outcome}${detail ? ` — ${detail}` : ""}`,
      durationMs: Date.now() - started,
    });
  };

  try {
    await requestGovernor("tiktok");
    ctx = await getContext("desktop-chrome", 1);
    const resp = await ctx.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const status = resp?.status();
    if (status && status >= 400) {
      if (opts?.harvestGrid) recordGrid("blocked", `HTTP ${status}`);
      return record("blocked", null, `HTTP ${status}`);
    }
    await ctx.page.waitForTimeout(RENDERED_TEXT_SETTLE_MS);

    /*
      ── The POOL half, read BEFORE the header ────────────────────────────────
      Before, because the header's own early returns (`blocked` on a shell,
      `shape_change` on a moved count) must not be able to discard a grid the
      page did render. Same navigation, same settle, one extra evaluate().
    */
    if (opts?.harvestGrid) {
      // String-form evaluate for the same bundler reason as the header read.
      const rawTiles = (await ctx.page.evaluate(`(() => {
        const anchors = Array.from(document.querySelectorAll('a[href*="/video/"]'));
        return anchors.map(a => {
          let node = a;
          for (let i = 0; i < 3 && node.parentElement; i++) node = node.parentElement;
          const img = a.querySelector('img');
          return {
            href: a.getAttribute('href'),
            alt: img ? img.getAttribute('alt') : null,
            tileText: node.innerText || null,
          };
        });
      })()`)) as RenderedGridTile[] | null;

      grid = parseRenderedGridTiles(handle, Array.isArray(rawTiles) ? rawTiles : []);
      if (grid.items.length > 0) {
        recordGrid("success");
        console.log(
          `[profileScraper] @${handle}: profile_rendered_grid — ${grid.items.length} videos harvested ` +
          `(${grid.anchorsSeen} anchors, ${grid.rejected} refused by the author guard)`,
        );
      } else {
        recordGrid("empty", `${grid.anchorsSeen} anchors seen, ${grid.rejected} refused`);
        console.warn(
          `[profileScraper] @${handle}: profile_rendered_grid — no usable videos ` +
          `(${grid.anchorsSeen} anchors, ${grid.rejected} refused)`,
        );
      }
    }

    // String-form evaluate: a function argument is instrumented by the bundler
    // and arrives in the page as `__name is not defined`.
    const text = (await ctx.page.evaluate("document.body.innerText")) as string | null;
    if (!text || text.length < 200) {
      return record("blocked", null, `rendered ${text?.length ?? 0} chars — shell page`);
    }
    const { followersRaw, followingRaw, likesRaw } = parseTikTokRenderedHeader(text);
    if (followersRaw === null && followingRaw === null) {
      return record("shape_change", null, `rendered ${text.length} chars with no count/label pair`);
    }
    const fields: TikTokBaseFields = {
      uniqueId: handle,
      nickname: null,
      signature: null,
      followerCount: parseDisplayCount(followersRaw),
      followingCount: parseDisplayCount(followingRaw),
      heartCount: parseDisplayCount(likesRaw),
      videoCount: null,
      verified: null,
      secUid: null,
    };
    console.log(
      `[profileScraper] @${handle}: ${leg} — followers="${followersRaw}"->${fields.followerCount} ` +
      `following="${followingRaw}" likes="${likesRaw}" (display precision)`,
    );
    return record("success", fields);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    return record(/timeout|timed out/i.test(msg) ? "blocked" : "blocked", null, msg.slice(0, 140));
  } finally {
    if (ctx) await retireContext(ctx.context).catch(() => {});
  }
}

export async function attemptProfileEmbedJson(handle: string): Promise<ProfileLegResult> {
  const started = Date.now();
  const leg = "profile_embed_json";
  const url = `https://www.tiktok.com/embed/@${handle}`;
  const record = (outcome: ProfileLegOutcome, fields: TikTokBaseFields | null, detail?: string): ProfileLegResult => {
    recordScrapeEvent({
      platform: "tiktok",
      scrapeMethod: "tiktok_desktop_http",
      urlRequested: `${url}#profile=${leg}:${outcome}`,
      silentFailureDetected: outcome === "shape_change",
      failureReason: outcome === "success" ? undefined : `profile ${leg}: ${outcome}${detail ? ` — ${detail}` : ""}`,
      durationMs: Date.now() - started,
    });
    return { leg, outcome, durationMs: Date.now() - started, fields, detail };
  };

  try {
    await requestGovernor("tiktok");
    const html = await fetchHtml(url, { timeout: EMBED_BUDGET_MS, maxRetries: 1 });
    if (!html || html.length < 5_000) {
      return record("blocked", null, `body ${html?.length ?? 0} bytes — stub/challenge page`);
    }
    const fields = baseFieldsFromEmbed(html);
    if (!fields) {
      // A full-size embed page carrying neither uniqueId nor followerCount is
      // a shape we do not recognise — report it as such, loudly, not as empty.
      return record("shape_change", null,
        `embed page ${html.length} bytes with no uniqueId or followerCount`);
    }
    console.log(
      `[profileScraper] @${handle}: ${leg} — followers=${fields.followerCount} following=${fields.followingCount} ` +
      `hearts=${fields.heartCount} videos=${fields.videoCount ?? "ABSENT"} secUid=${fields.secUid ? "yes" : "ABSENT"}`,
    );
    return record("success", fields);
  } catch (err) {
    return record("blocked", null, ((err as Error).message ?? String(err)).slice(0, 140));
  }
}

function extractRehydrationData(html: string): RehydrationData | null {
  const match = html.match(
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) {
    console.warn("[profileScraper] No __UNIVERSAL_DATA_FOR_REHYDRATION__ found in page");
    return null;
  }
  try {
    return JSON.parse(match[1]) as RehydrationData;
  } catch (err) {
    console.warn("[profileScraper] Failed to parse rehydration JSON:", (err as Error).message);
    return null;
  }
}

function parseItemList(rawItemList: unknown[], handle: string): TikTokVideoItem[] {
  const itemList: TikTokVideoItem[] = [];

  for (const rawItem of rawItemList) {
    const item = rawItem as Record<string, unknown>;
    const videoId = String(item.id ?? "");
    if (!videoId) continue;

    const statsObj = (item.stats as Record<string, unknown>) ?? {};
    const musicObj = (item.music as Record<string, unknown>) ?? {};
    const videoObj = (item.video as Record<string, unknown>) ?? {};
    const authorObj = (item.author as Record<string, unknown>) ?? {};
    const challenges = (item.challenges as Array<Record<string, unknown>>) ?? [];
    const textExtra = (item.textExtra as Array<Record<string, unknown>>) ?? [];

    itemList.push({
      id: videoId,
      desc: String(item.desc ?? ""),
      createTime: Number(item.createTime ?? 0),
      stats: {
        playCount: Number(statsObj.playCount ?? 0),
        diggCount: Number(statsObj.diggCount ?? 0),
        commentCount: Number(statsObj.commentCount ?? 0),
        collectCount: Number(statsObj.collectCount ?? 0),
        shareCount: Number(statsObj.shareCount ?? 0),
      },
      music: {
        title: String(musicObj.title ?? ""),
        authorName: String(musicObj.authorName ?? ""),
        original: Boolean(musicObj.original ?? false),
      },
      video: {
        duration: Number(videoObj.duration ?? 0),
        id: String(videoObj.id ?? videoId),
      },
      author: {
        // Session 10: do NOT fabricate the target handle for an author-less item.
        // The old `?? handle` default stamped every author-less item as the
        // creator, so any downstream author guard would accept it (fail open).
        // Keep it empty so the guard can fail closed.
        uniqueId: String(authorObj.uniqueId ?? ""),
        nickname: String(authorObj.nickname ?? ""),
        secUid: String(authorObj.secUid ?? ""),
      },
      duetEnabled: Boolean(item.duetEnabled ?? false),
      stitchEnabled: Boolean(item.stitchEnabled ?? false),
      isAd: Boolean(item.isAd ?? false),
      challenges: challenges.map(c => ({ title: String(c.title ?? c.name ?? "") })),
      textExtra: textExtra.map(te => ({
        hashtagName: String(te.hashtagName ?? ""),
        type: Number(te.type ?? 0),
      })),
    });
  }

  return itemList;
}

function extractUserInfoFromRegex(html: string, handle: string): TikTokUserInfoResponse {
  const result: TikTokUserInfoResponse = {
    userInfo: {
      user: { id: "", secUid: "", uniqueId: handle, nickname: handle, signature: "" },
      stats: { followerCount: 0, followingCount: 0, heartCount: 0, videoCount: 0 },
    },
  };

  const patterns: Array<{ field: string; regex: RegExp }> = [
    { field: "followerCount", regex: /"followerCount":(\d+)/ },
    { field: "heartCount", regex: /"heartCount":(\d+)/ },
    { field: "videoCount", regex: /"videoCount":(\d+)/ },
    { field: "nickname", regex: /"nickname":"([^"]+)"/ },
    { field: "signature", regex: /"signature":"([^"]*)"/ },
    { field: "secUid", regex: /"secUid":"([^"]+)"/ },
    { field: "id", regex: /"id":"(\d+)"/ },
  ];

  for (const { field, regex } of patterns) {
    const match = html.match(regex);
    if (match?.[1]) {
      const value = match[1];
      if (field === "followerCount" || field === "heartCount" || field === "videoCount") {
        (result.userInfo.stats as Record<string, unknown>)[field] = parseInt(value, 10);
      } else {
        (result.userInfo.user as Record<string, unknown>)[field] = value
          .replace(/\\n/g, " ")
          .replace(/\\u[\dA-Fa-f]{4}/g, "")
          .trim();
      }
    }
  }

  return result;
}
