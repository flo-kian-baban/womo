/**
 * TikTok Search Scraper — Phase 2
 *
 * Replaces the Phase 1 searchStub.ts with a real Playwright-based
 * TikTok video search scraper.
 *
 * Strategy:
 *   1. Navigate to https://www.tiktok.com/search/video?q={query}
 *   2. Intercept XHR responses via page.route() to capture the search
 *      API response JSON directly
 *   3. Fallback: if no XHR captured, parse rendered page HTML
 *
 * Powers:
 *   - Supplemental video discovery in webResearch.ts
 *   - Brand mention collection (Track B) in brandTikTokAnalysis.ts
 */

import { requestGovernor } from "../httpClient";
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

// ─── Primary: Playwright XHR Interception ─────────────────────────────────────

async function searchViaPlaywright(keyword: string): Promise<TikTokSearchResponse | null> {
  let ctx: Awaited<ReturnType<typeof getContext>> | null = null;

  try {
    await requestGovernor("tiktok");
    ctx = await getContext("desktop-chrome");
    const { page, context } = ctx;

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
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });

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
        item_list: normalizeSearchItems(capturedItems),
        has_more: lastHasMore,
        cursor: lastCursor,
        search_id: lastSearchId,
      };
    }

    // Fallback: parse from rendered HTML
    const htmlResult = await parseSearchFromHtml(page);
    await page.close();

    if (htmlResult && htmlResult.item_list.length > 0) {
      console.log(`[searchScraper] HTML parse found ${htmlResult.item_list.length} results for "${keyword}"`);
      return htmlResult;
    }

    console.warn(`[searchScraper] No results found for "${keyword}" via either method`);
    await retireContext(context);
    return { item_list: [], has_more: false };
  } catch (err) {
    console.warn(`[searchScraper] Playwright search failed for "${keyword}":`, (err as Error).message);
    if (ctx) {
      try { await ctx.page.close(); } catch { /* ignore */ }
    }
    return null;
  }
}

// ─── HTML Fallback Parser ─────────────────────────────────────────────────────

async function parseSearchFromHtml(page: import("playwright").Page): Promise<TikTokSearchResponse | null> {
  try {
    // Try to extract search results from the page's script data
    const pageContent = await page.content();

    // Look for SIGI_STATE or search result data in page source
    const sigiMatch = pageContent.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
    if (sigiMatch) {
      try {
        const sigiData = JSON.parse(sigiMatch[1]) as Record<string, unknown>;
        const itemModule = sigiData.ItemModule as Record<string, Record<string, unknown>> | undefined;
        if (itemModule) {
          const items = Object.values(itemModule).map((item) => ({
            id: String(item.id ?? ""),
            desc: String(item.desc ?? ""),
            createTime: Number(item.createTime ?? 0),
            stats: {
              playCount: Number((item.stats as Record<string, unknown>)?.playCount ?? 0),
              diggCount: Number((item.stats as Record<string, unknown>)?.diggCount ?? 0),
              commentCount: Number((item.stats as Record<string, unknown>)?.commentCount ?? 0),
              collectCount: Number((item.stats as Record<string, unknown>)?.collectCount ?? 0),
              shareCount: Number((item.stats as Record<string, unknown>)?.shareCount ?? 0),
            },
            author: {
              uniqueId: String((item.author as string) ?? ""),
            },
          }));
          return { item_list: items, has_more: false };
        }
      } catch { /* parse failure */ }
    }

    // Try rehydration data
    const rehydrationMatch = pageContent.match(
      /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (rehydrationMatch) {
      try {
        const data = JSON.parse(rehydrationMatch[1]) as Record<string, unknown>;
        const defaultScope = data.__DEFAULT_SCOPE__ as Record<string, unknown> | undefined;
        const searchResult = defaultScope?.["webapp.search-detail"] as Record<string, unknown> | undefined;
        const itemList = searchResult?.itemList as unknown[] | undefined;
        if (Array.isArray(itemList) && itemList.length > 0) {
          return { item_list: normalizeSearchItems(itemList), has_more: false };
        }
      } catch { /* parse failure */ }
    }

    return null;
  } catch {
    return null;
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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search TikTok for videos matching a keyword.
 * Uses Playwright with XHR interception, falling back to HTML parsing.
 */
export async function searchTikTokVideos(
  keyword: string,
  _options?: { cursor?: number; searchId?: string },
): Promise<TikTokSearchResponse> {
  const result = await searchViaPlaywright(keyword);

  if (result) {
    return result;
  }

  // All paths exhausted — return empty gracefully
  console.warn(`[searchScraper] All search paths exhausted for "${keyword}"`);
  return { item_list: [], has_more: false };
}
