/**
 * YouTube Channel Scraper — Phase 1
 *
 * Replaces:
 *   - callDataApi("Youtube/get_channel_details")
 *   - callDataApi("Youtube/get_channel_videos")
 *
 * Scrapes YouTube channel pages and extracts metadata + video list
 * from the embedded ytInitialData JSON.
 */

import { fetchHtml } from "../httpClient";
import { extractYtInitialData, navigatePath, extractTextRuns, extractSimpleText, parseViewCount } from "./searchScraper";

// ─── Response Types (mirror Forge API shapes) ─────────────────────────────────

/** Matches the shape consumed at webResearch.ts:1196–1217 */
export interface YouTubeChannelDetailsResponse {
  title: string;
  description: string;
  country: string;
  stats: {
    subscribers: number;
    videos: number;
    views: number;
  };
  keywords: string[];
  /** null only if the channel couldn't be loaded */
  status?: string;
}

/** Matches the shape consumed at webResearch.ts:1222–1242 */
export interface YouTubeChannelVideosResponse {
  contents: YouTubeChannelVideoItem[];
}

export interface YouTubeChannelVideoItem {
  video: {
    videoId: string;
    title: string;
    stats: {
      views: number;
    };
  };
}

// ─── Channel Details Scraper ──────────────────────────────────────────────────

/**
 * Fetch channel details by channel ID or handle.
 * Replaces `callDataApi("Youtube/get_channel_details", { query: { id } })`.
 */
export async function scrapeYouTubeChannelDetails(
  channelIdOrHandle: string,
): Promise<YouTubeChannelDetailsResponse> {
  // Determine the URL: channel ID starts with "UC", otherwise it's a handle
  const isChannelId = channelIdOrHandle.startsWith("UC");
  const url = isChannelId
    ? `https://www.youtube.com/channel/${channelIdOrHandle}`
    : `https://www.youtube.com/@${channelIdOrHandle}`;

  const html = await fetchHtml(url, {
    extraHeaders: { Referer: "https://www.youtube.com/" },
  });

  const ytData = extractYtInitialData(html);
  if (!ytData) {
    console.warn("[channelScraper] No ytInitialData found for channel", channelIdOrHandle);
    return {
      title: channelIdOrHandle,
      description: "",
      country: "",
      stats: { subscribers: 0, videos: 0, views: 0 },
      keywords: [],
      status: "ERROR",
    };
  }

  // Extract metadata from header
  const header = navigatePath(ytData, [
    "header",
    "c4TabbedHeaderRenderer",
  ]) as Record<string, unknown> | undefined;

  // Try pageHeaderRenderer for newer layout
  const pageHeader = navigatePath(ytData, [
    "header",
    "pageHeaderRenderer",
  ]) as Record<string, unknown> | undefined;

  const title =
    (header?.title as string) ??
    extractSimpleText(navigatePath(pageHeader, ["pageTitle"])) ??
    channelIdOrHandle;

  const subscriberText =
    extractSimpleText(header?.subscriberCountText) ?? "";

  // Extract metadata from the metadata object
  const metadata = navigatePath(ytData, [
    "metadata",
    "channelMetadataRenderer",
  ]) as Record<string, unknown> | undefined;

  const description = (metadata?.description as string) ?? "";
  const keywords = (metadata?.keywords as string) ?? "";
  const country = (metadata?.country as string) ??
    (metadata?.availableCountryCodes as string[])?.join(", ") ?? "";

  // Parse keywords string → array
  const keywordList = keywords
    ? keywords.match(/"[^"]+"|[^\s]+/g)?.map(k => k.replace(/^"|"$/g, "")) ?? []
    : [];

  // Try to get total views from the about tab or microformat
  const microformat = navigatePath(ytData, [
    "microformat",
    "microformatDataRenderer",
  ]) as Record<string, unknown> | undefined;

  // Try to extract stats from the about page info
  let totalViews = 0;
  let videoCount = 0;

  // Look for the about tab content
  const tabs = navigatePath(ytData, [
    "contents",
    "twoColumnBrowseResultsRenderer",
    "tabs",
  ]) as unknown[];

  if (Array.isArray(tabs)) {
    for (const tab of tabs) {
      const tabObj = tab as Record<string, unknown>;
      const tabRenderer = tabObj.tabRenderer as Record<string, unknown>;
      if (!tabRenderer) continue;

      // Look in the "about" tab for view count
      const aboutContent = navigatePath(tabRenderer, [
        "content",
        "sectionListRenderer",
        "contents",
      ]) as unknown[];
      if (Array.isArray(aboutContent)) {
        for (const section of aboutContent) {
          const sectionObj = section as Record<string, unknown>;
          const channelAbout = navigatePath(sectionObj, [
            "itemSectionRenderer",
            "contents",
            "0",
            "channelAboutFullMetadataRenderer",
          ]) as Record<string, unknown> | undefined;
          if (channelAbout) {
            const viewsText = extractSimpleText(channelAbout.viewCountText);
            totalViews = parseViewCount(viewsText);
            // Country from about tab
            if (!country && channelAbout.country) {
              // Already have country from metadata
            }
          }
        }
      }
    }
  }

  return {
    title,
    description,
    country,
    stats: {
      subscribers: parseSubscriberCount(subscriberText),
      videos: videoCount,
      views: totalViews,
    },
    keywords: keywordList.slice(0, 20),
  };
}

// ─── Channel Videos Scraper ───────────────────────────────────────────────────

/**
 * Fetch the video list from a channel's videos tab.
 * Replaces `callDataApi("Youtube/get_channel_videos", { query: { channelId } })`.
 */
export async function scrapeYouTubeChannelVideos(
  channelIdOrHandle: string,
): Promise<YouTubeChannelVideosResponse> {
  const isChannelId = channelIdOrHandle.startsWith("UC");
  const url = isChannelId
    ? `https://www.youtube.com/channel/${channelIdOrHandle}/videos`
    : `https://www.youtube.com/@${channelIdOrHandle}/videos`;

  const html = await fetchHtml(url, {
    extraHeaders: { Referer: "https://www.youtube.com/" },
  });

  const ytData = extractYtInitialData(html);
  if (!ytData) {
    console.warn("[channelScraper] No ytInitialData found for channel videos", channelIdOrHandle);
    return { contents: [] };
  }

  const contents: YouTubeChannelVideoItem[] = [];

  // Navigate to the videos tab content
  const tabs = navigatePath(ytData, [
    "contents",
    "twoColumnBrowseResultsRenderer",
    "tabs",
  ]) as unknown[];

  if (!Array.isArray(tabs)) {
    console.warn("[channelScraper] No tabs found in ytInitialData");
    return { contents };
  }

  for (const tab of tabs) {
    const tabObj = tab as Record<string, unknown>;
    const tabRenderer = tabObj.tabRenderer as Record<string, unknown>;
    if (!tabRenderer) continue;

    // Find the videos tab (it's the selected one when we navigate to /videos)
    const tabContent = navigatePath(tabRenderer, [
      "content",
      "richGridRenderer",
      "contents",
    ]) as unknown[];

    if (!Array.isArray(tabContent)) continue;

    for (const gridItem of tabContent) {
      const gridObj = gridItem as Record<string, unknown>;

      // richItemRenderer → content → videoRenderer
      const videoRenderer = navigatePath(gridObj, [
        "richItemRenderer",
        "content",
        "videoRenderer",
      ]) as Record<string, unknown> | undefined;

      if (videoRenderer) {
        const videoId = String(videoRenderer.videoId ?? "");
        const title = extractTextRuns(videoRenderer.title);
        const viewCountText = extractSimpleText(videoRenderer.viewCountText) ||
          extractTextRuns(videoRenderer.viewCountText);

        if (videoId) {
          contents.push({
            video: {
              videoId,
              title,
              stats: {
                views: parseViewCount(viewCountText),
              },
            },
          });
        }
      }
    }

    // If we found videos, no need to check other tabs
    if (contents.length > 0) break;
  }

  console.log(`[channelScraper] Found ${contents.length} videos for channel ${channelIdOrHandle}`);
  return { contents };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse "1.2M subscribers" or "1,234 subscribers" to a number */
function parseSubscriberCount(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/subscribers?/gi, "").replace(/,/g, "").trim();

  // Handle suffix format
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
