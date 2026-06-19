/**
 * Scraping Layer — Unified Exports
 *
 * Phase 1: HTTP client, TikTok profile, YouTube, web search
 * Phase 2: Browser client, TikTok search, Instagram, reliability layer
 */

// ─── HTTP Client ──────────────────────────────────────────────────────────────

export {
  fetchHtml,
  fetchJson,
  detectSilentFailure,
  requestGovernor,
  randomMobileUserAgent,
  type FetchHtmlOptions,
  type HttpClientError,
  type ProxyProvider,
  type ProxyConfig,
  type SilentFailureResult,
} from "./httpClient";

// ─── Browser Client ───────────────────────────────────────────────────────────

export {
  ensureBrowser,
  getContext,
  retireContext,
  shutdown,
  warmSession,
  interceptRoute,
  randomDelay,
  type ContextPreset,
} from "./browserClient";

// ─── TikTok ───────────────────────────────────────────────────────────────────

export {
  scrapeTikTokUserInfo,
  scrapeTikTokUserPosts,
  scrapeTikTokPopularPosts,
  scrapeTikTokProfile,
  fetchOEmbed,
  type TikTokUserInfoResponse,
  type TikTokPostListResponse,
  type TikTokVideoItem,
} from "./tiktok/profileScraper";

export {
  searchTikTokVideos,
  type TikTokSearchResponse,
  type TikTokSearchItem,
} from "./tiktok/searchScraper";

// ─── YouTube ──────────────────────────────────────────────────────────────────

export {
  searchYouTube,
  type YouTubeSearchResponse,
} from "./youtube/searchScraper";

export {
  scrapeYouTubeChannelDetails,
  scrapeYouTubeChannelVideos,
  type YouTubeChannelDetailsResponse,
  type YouTubeChannelVideosResponse,
} from "./youtube/channelScraper";

// ─── Instagram ────────────────────────────────────────────────────────────────

export {
  scrapeInstagramProfile,
} from "./instagram/profileScraper";

export {
  fetchPostViaOEmbed,
  fetchReelVideoUrl,
  supplementPostsViaOEmbed,
} from "./instagram/postScraper";

export {
  type InstagramProfileData,
  type InstagramPostData,
  type InstagramScrapedProfile,
} from "./instagram/types";

// ─── Brand / Web Search ───────────────────────────────────────────────────────

export {
  searchWeb,
  type WebSearchResponse,
} from "./brand/searchFallback";
