/**
 * TikTok Profile Scraper — Phase 2 (Multi-Path)
 *
 * Replaces:
 *   - callDataApi("TikTok/get_user_info")
 *   - callDataApi("TikTok/get_user_post_list")
 *   - callDataApi("TikTok/get_user_popular_posts")
 *
 * Multi-path fallback chain:
 *   Path A: Desktop HTTP (Phase 1 — same as before)
 *   Path B: Mobile web (m.tiktok.com — lighter CF protection)
 *   Path C: Playwright desktop (headless Chromium + stealth)
 *   Path D: oEmbed + Google cache (partial data, last resort)
 *
 * Each path runs detectSilentFailure() before returning.
 * requestGovernor("tiktok") enforces human-pattern timing.
 */

import { fetchHtml, detectSilentFailure, requestGovernor, randomMobileUserAgent } from "../httpClient";
import { getContext, warmSession, retireContext } from "../browserClient";

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

// ─── Path A: Desktop HTTP (Phase 1) ──────────────────────────────────────────

async function fetchViaDesktopHttp(handle: string): Promise<{ html: string; source: string } | null> {
  try {
    await requestGovernor("tiktok");
    const url = `https://www.tiktok.com/@${handle}`;
    const html = await fetchHtml(url, {
      extraHeaders: { Referer: "https://www.tiktok.com/" },
    });

    const check = detectSilentFailure("tiktok", html, url);
    if (check.isFailed) {
      console.warn(`[profileScraper] Path A (desktop HTTP) silent failure: ${check.reason}`);
      return null;
    }

    return { html, source: "desktop-http" };
  } catch (err) {
    console.warn(`[profileScraper] Path A (desktop HTTP) failed:`, (err as Error).message);
    return null;
  }
}

// ─── Path B: Mobile Web ──────────────────────────────────────────────────────

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

// ─── Path C: Playwright Desktop with XHR Interception ────────────────────────

interface PlaywrightResult {
  html: string;
  source: string;
  /** Captured video items from XHR interception (ACCUMULATED from multiple XHR responses) */
  xhrVideoItems?: unknown[];
  /** Captured user detail from XHR interception */
  xhrUserDetail?: Record<string, unknown>;
}

async function fetchViaPlaywright(handle: string): Promise<PlaywrightResult | null> {
  let ctx: Awaited<ReturnType<typeof getContext>> | null = null;
  try {
    await requestGovernor("tiktok");
    ctx = await getContext("desktop-chrome");
    const { page, context } = ctx;

    // ── XHR Interception Setup ──
    // ACCUMULATE video items from ALL XHR responses (not just the first)
    const capturedVideoItems: unknown[] = [];
    let capturedUserDetail: Record<string, unknown> | null = null;
    let xhrResponseCount = 0;

    page.on("response", async (response) => {
      try {
        const url = response.url();
        // Intercept video list API — ACCUMULATE all responses
        if (
          url.includes("/api/post/item_list/") ||
          url.includes("/api/post/item_list?") ||
          url.includes("item_list")
        ) {
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
    const url = `https://www.tiktok.com/@${handle}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 25000 }).catch((err: Error) => {
      // FIX 1.2: Log navigation failure instead of silently swallowing
      console.warn(`[tiktokScraper] @${handle}: navigation failed (page may still be usable): ${err.message}`);
    });

    // Wait for rehydration data to appear
    await page.waitForSelector("#__UNIVERSAL_DATA_FOR_REHYDRATION__", { timeout: 8000 }).catch((err: Error) => {
      console.warn(`[tiktokScraper] @${handle}: rehydration data not found: ${err.message}`);
    });

    // ── AGGRESSIVE SCROLL: 6 scroll events over ~12s ──
    // TikTok lazy-loads the video grid; we need to scroll deep to trigger
    // multiple item_list XHR responses (each returns ~30 videos)
    const scrollPositions = [600, 1200, 2000, 2800, 3600, 4500];
    for (const yPos of scrollPositions) {
      await page.evaluate((y) => window.scrollTo(0, y), yPos);
      // Random delay between 1.2s and 2.2s to appear human
      await page.waitForTimeout(1200 + Math.floor(Math.random() * 1000));
    }

    // Extra wait for any final XHR responses to complete
    await page.waitForTimeout(3000);

    console.log(`[profileScraper] @${handle}: Playwright scroll complete — ${xhrResponseCount} XHR responses, ${capturedVideoItems.length} total videos captured`);

    const html = await page.content();

    const check = detectSilentFailure("tiktok", html, url, page.url());
    if (check.isFailed && capturedVideoItems.length === 0 && !capturedUserDetail) {
      console.warn(`[profileScraper] Path C (Playwright) silent failure: ${check.reason}`);
      await retireContext(context);
      return null;
    }

    await page.close();
    return {
      html,
      source: "playwright-desktop",
      xhrVideoItems: capturedVideoItems.length > 0 ? capturedVideoItems : undefined,
      xhrUserDetail: capturedUserDetail ?? undefined,
    };
  } catch (err) {
    console.warn(`[profileScraper] Path C (Playwright) failed:`, (err as Error).message);
    if (ctx) {
      try { await ctx.page.close(); } catch { /* ignore */ }
    }
    return null;
  }
}

// ─── Path D: oEmbed + Google Cache ───────────────────────────────────────────

async function fetchViaGoogleCache(handle: string): Promise<{ html: string; source: string } | null> {
  try {
    await requestGovernor("tiktok");
    const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:tiktok.com/@${handle}`;
    const html = await fetchHtml(cacheUrl, { timeout: 10000, maxRetries: 1 });

    if (!html.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__")) {
      console.warn(`[profileScraper] Path D (Google cache) no rehydration data`);
      return null;
    }

    return { html, source: "google-cache" };
  } catch (err) {
    console.warn(`[profileScraper] Path D (Google cache) failed:`, (err as Error).message);
    return null;
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

// ─── Multi-Path Orchestrator ─────────────────────────────────────────────────

interface FetchResult {
  html: string;
  source: string;
  xhrVideoItems?: unknown[];
  xhrUserDetail?: Record<string, unknown>;
}

/**
 * Two-phase profile fetch:
 *   Phase 1: HTTP for user info (fast — gets bio, stats, secUid)
 *   Phase 2: ALWAYS Playwright for video collection (scrolls, accumulates XHRs)
 *
 * The HTTP paths almost never have video lists (TikTok strips itemList from SSR HTML).
 * Playwright is the ONLY reliable way to get videos via XHR interception.
 */
async function fetchProfileHtml(handle: string): Promise<FetchResult> {
  // ── Phase 1: Fast HTTP for user info (bio, stats, secUid) ──
  let httpHtml: string | null = null;
  let httpSource = "";

  // FIX 3.4: Skip Path A (desktop HTTP) — TikTok consistently returns a JS shell
  // page that has no data. This wastes 8-15 seconds on retries before falling through.
  // Go directly to Path B (mobile web) which has better success rates.
  const pathB = await fetchViaMobileWeb(handle);
  if (pathB) {
    httpHtml = pathB.html;
    httpSource = pathB.source;
    console.log(`[profileScraper] @${handle}: Phase 1 — HTTP user info via mobile web`);
  }

  // ── Phase 2: ALWAYS run Playwright for video collection ──
  // This is NOT a fallback — it's the primary video source.
  console.log(`[profileScraper] @${handle}: Phase 2 — Playwright for video collection (always runs)`);
  const pathC = await fetchViaPlaywright(handle);

  if (pathC) {
    const videoCount = pathC.xhrVideoItems?.length ?? 0;
    console.log(`[profileScraper] @${handle}: Phase 2 — Playwright succeeded: ${videoCount} videos`);

    // Merge: use Playwright HTML + videos, but keep HTTP user info if Playwright didn't capture it
    // The result carries both XHR videos and the best HTML for rehydration
    return {
      html: pathC.html,
      source: httpSource ? `${httpSource}+${pathC.source}` : pathC.source,
      xhrVideoItems: pathC.xhrVideoItems,
      xhrUserDetail: pathC.xhrUserDetail,
    };
  }

  console.warn(`[profileScraper] @${handle}: Phase 2 — Playwright failed, falling back to HTTP-only`);

  // Playwright failed entirely — fall back to HTTP HTML only
  if (httpHtml) {
    return { html: httpHtml, source: httpSource };
  }

  // Last resort: Google cache
  const pathD = await fetchViaGoogleCache(handle);
  if (pathD) {
    console.log(`[profileScraper] @${handle}: Google cache fallback succeeded`);
    return pathD;
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
 * Combined scrape: single HTTP request, returns both user info and post list.
 */
export async function scrapeTikTokProfile(handle: string): Promise<{
  userInfo: TikTokUserInfoResponse;
  posts: TikTokPostListResponse;
}> {
  const fetchResult = await fetchProfileHtml(handle);
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

  const confidence = itemList.length >= 20 ? "high" : itemList.length >= 5 ? "medium" : "low";
  console.log(`[profileScraper] @${handle}: final result — ${itemList.length} videos, confidence: ${confidence}, via ${finalSource}`);

  return {
    userInfo,
    posts: { data: { itemList, hasMore: false } },
  };
}

/** Exported for use by oEmbed supplementation */
export { fetchOEmbed };

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
        uniqueId: String(authorObj.uniqueId ?? handle),
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
