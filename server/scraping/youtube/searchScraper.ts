/**
 * YouTube Search Scraper — Phase 1
 *
 * Replaces: callDataApi("Youtube/search")
 *
 * Scrapes YouTube search results page and extracts channel/video data
 * from the embedded ytInitialData JSON. Returns data in the same shape
 * as the Forge API response.
 */

import { fetchHtml } from "../httpClient";

// ─── Response Types (mirror Forge API shapes) ─────────────────────────────────

export interface YouTubeSearchResponse {
  contents: YouTubeSearchItem[];
}

export interface YouTubeSearchItem {
  channel?: {
    channelId: string;
    title: string;
    descriptionSnippet: string;
  };
  video?: {
    videoId: string;
    title: string;
    descriptionSnippet: string;
    stats: {
      views: number;
    };
  };
}

// ─── Scraper ──────────────────────────────────────────────────────────────────

/**
 * Search YouTube for channels or videos.
 * Replaces `callDataApi("Youtube/search", { query: { q, type, hl, gl } })`.
 */
export async function searchYouTube(
  query: string,
  options: { type?: "channel" | "video"; hl?: string; gl?: string } = {},
): Promise<YouTubeSearchResponse> {
  const { type, hl = "en", gl = "US" } = options;

  // Build the search URL with filters
  // sp=EgIQAg%3D%3D → filter: channels only
  // sp=EgIQAQ%3D%3D → filter: videos only
  let spParam = "";
  if (type === "channel") spParam = "&sp=EgIQAg%3D%3D";
  else if (type === "video") spParam = "&sp=EgIQAQ%3D%3D";

  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}${spParam}`;

  const html = await fetchHtml(url, {
    extraHeaders: {
      Referer: "https://www.youtube.com/",
    },
  });

  const ytData = extractYtInitialData(html);
  if (!ytData) {
    console.warn("[youtubeSearch] No ytInitialData found in search results page");
    return { contents: [] };
  }

  const contents: YouTubeSearchItem[] = [];

  // Navigate the nested structure to find search results
  const primaryContents = navigatePath(ytData, [
    "contents",
    "twoColumnSearchResultsRenderer",
    "primaryContents",
    "sectionListRenderer",
    "contents",
  ]) as unknown[];

  if (!Array.isArray(primaryContents)) {
    console.warn("[youtubeSearch] Could not find search results in ytInitialData");
    return { contents };
  }

  for (const section of primaryContents) {
    const sectionObj = section as Record<string, unknown>;
    const items = navigatePath(sectionObj, [
      "itemSectionRenderer",
      "contents",
    ]) as unknown[];
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      const itemObj = item as Record<string, unknown>;

      // Channel result
      const channelRenderer = itemObj.channelRenderer as Record<string, unknown>;
      if (channelRenderer) {
        contents.push({
          channel: {
            channelId: String(channelRenderer.channelId ?? ""),
            title: extractTextRuns(channelRenderer.title),
            descriptionSnippet: extractTextRuns(channelRenderer.descriptionSnippet),
          },
        });
        continue;
      }

      // Video result
      const videoRenderer = itemObj.videoRenderer as Record<string, unknown>;
      if (videoRenderer) {
        const viewCountText = extractSimpleText(videoRenderer.viewCountText) ||
          extractTextRuns(videoRenderer.viewCountText);
        contents.push({
          video: {
            videoId: String(videoRenderer.videoId ?? ""),
            title: extractTextRuns(videoRenderer.title),
            descriptionSnippet: extractTextRuns(videoRenderer.descriptionSnippet),
            stats: {
              views: parseViewCount(viewCountText),
            },
          },
        });
      }
    }
  }

  console.log(`[youtubeSearch] Found ${contents.length} results for "${query}"`);
  return { contents };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractYtInitialData(html: string): Record<string, unknown> | null {
  // Primary pattern
  const match = html.match(/var\s+ytInitialData\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
  if (match) {
    try { return JSON.parse(match[1]) as Record<string, unknown>; } catch { /* fall through */ }
  }

  // Alternative pattern
  const altMatch = html.match(/ytInitialData\s*=\s*(\{[\s\S]+?\});/);
  if (altMatch) {
    try { return JSON.parse(altMatch[1]) as Record<string, unknown>; } catch { /* fall through */ }
  }

  // Window property pattern
  const winMatch = html.match(/window\["ytInitialData"\]\s*=\s*(\{[\s\S]+?\});/);
  if (winMatch) {
    try { return JSON.parse(winMatch[1]) as Record<string, unknown>; } catch { /* fall through */ }
  }

  return null;
}

/** Navigate a nested object path, returning undefined if any step fails */
function navigatePath(obj: unknown, path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Extract text from YouTube's { runs: [{ text }] } or { simpleText } format */
function extractTextRuns(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";
  const o = obj as Record<string, unknown>;

  if (typeof o.simpleText === "string") return o.simpleText;

  const runs = o.runs as Array<{ text?: string }>;
  if (Array.isArray(runs)) {
    return runs.map(r => r.text ?? "").join("");
  }

  return "";
}

function extractSimpleText(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";
  return String((obj as Record<string, unknown>).simpleText ?? "");
}

/** Parse "1,234,567 views" or "1.2M views" to a number */
function parseViewCount(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/,/g, "").replace(/\s*views?\s*/gi, "").trim();

  // Handle suffix format: 1.2M, 500K, etc.
  const suffixMatch = cleaned.match(/^([\d.]+)\s*([KMBkmb])/);
  if (suffixMatch) {
    const num = parseFloat(suffixMatch[1]);
    const suffix = suffixMatch[2].toUpperCase();
    if (suffix === "K") return Math.round(num * 1_000);
    if (suffix === "M") return Math.round(num * 1_000_000);
    if (suffix === "B") return Math.round(num * 1_000_000_000);
  }

  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? 0 : parsed;
}

/** Exported for reuse by channelScraper */
export { extractYtInitialData, navigatePath, extractTextRuns, extractSimpleText, parseViewCount };
