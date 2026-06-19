/**
 * Instagram Post Scraper — Phase 2
 *
 * Individual post data fetcher for supplementing profile-level data.
 *
 * Primary: Instagram oEmbed endpoint (completely open, no auth)
 * Secondary: Playwright for reel video URLs (Whisper fallback)
 *
 * oEmbed endpoint:
 *   https://api.instagram.com/oembed/?url={postUrl}&omitscript=true
 *   Returns: author_name, title (first caption line), thumbnail_url, media_id
 */

import { fetchHtml, requestGovernor } from "../httpClient";
import { getContext, warmSession } from "../browserClient";
import type { InstagramPostData } from "./types";

// ─── oEmbed Response ──────────────────────────────────────────────────────────

interface OEmbedResponse {
  author_name?: string;
  author_url?: string;
  title?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  media_id?: string;
  provider_name?: string;
  html?: string;
}

// ─── oEmbed Fetcher ───────────────────────────────────────────────────────────

/**
 * Fetch post data via Instagram's oEmbed endpoint.
 * No auth required, no rate limiting at low volumes.
 */
export async function fetchPostViaOEmbed(shortcode: string): Promise<Partial<InstagramPostData> | null> {
  try {
    await requestGovernor("instagram");
    const postUrl = `https://www.instagram.com/p/${shortcode}/`;
    const oembedUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(postUrl)}&omitscript=true`;

    const text = await fetchHtml(oembedUrl, { timeout: 8000, maxRetries: 2 });
    const data = JSON.parse(text) as OEmbedResponse;

    return {
      shortcode,
      caption: data.title ?? "",
      thumbnail_url: data.thumbnail_url ?? "",
      id: data.media_id ?? shortcode,
    };
  } catch (err) {
    console.warn(`[postScraper] oEmbed failed for ${shortcode}:`, (err as Error).message);
    return null;
  }
}

// ─── Reel Video URL Fetcher ───────────────────────────────────────────────────

/**
 * Fetch the video URL for a reel (for Whisper transcription).
 * Uses Playwright to load the reel page and extract the video source URL.
 * Only call this for posts with media_type === "video" or "reel".
 */
export async function fetchReelVideoUrl(shortcode: string): Promise<string | null> {
  let ctx: Awaited<ReturnType<typeof getContext>> | null = null;

  try {
    await requestGovernor("instagram");
    ctx = await getContext("mobile-ios", 5);
    const { page } = ctx;

    await warmSession(page, "https://www.instagram.com/", 3000, 5000);

    const url = `https://www.instagram.com/reel/${shortcode}/`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(2000);

    // Try to find video source URL
    const videoUrl = await page.evaluate(() => {
      // Method 1: video element src
      const video = document.querySelector("video");
      if (video?.src) return video.src;

      // Method 2: source element within video
      const source = document.querySelector("video source");
      if ((source as HTMLSourceElement)?.src) return (source as HTMLSourceElement).src;

      // Method 3: og:video meta tag
      const ogVideo = document.querySelector('meta[property="og:video"]');
      if (ogVideo?.getAttribute("content")) return ogVideo.getAttribute("content");

      return null;
    });

    await page.close();
    return videoUrl ?? null;
  } catch (err) {
    console.warn(`[postScraper] Reel video URL fetch failed for ${shortcode}:`, (err as Error).message);
    if (ctx) {
      try { await ctx.page.close(); } catch { /* ignore */ }
    }
    return null;
  }
}

// ─── Batch Post Supplementation ───────────────────────────────────────────────

/**
 * Supplement existing post data with oEmbed data.
 * Fills in missing captions from the oEmbed response.
 * FIX 8.1: Uses p-limit(3) for concurrent fetching instead of sequential loop.
 */
export async function supplementPostsViaOEmbed(
  posts: InstagramPostData[],
): Promise<InstagramPostData[]> {
  const pLimit = (await import("p-limit")).default;
  const limit = pLimit(3);

  const results = await Promise.allSettled(
    posts.map(post =>
      limit(async (): Promise<InstagramPostData> => {
        // Only supplement if caption is missing or very short
        if (post.caption && post.caption.length > 10) {
          return post;
        }

        const oembedData = await fetchPostViaOEmbed(post.shortcode);
        if (oembedData) {
          return {
            ...post,
            caption: oembedData.caption ?? post.caption,
            thumbnail_url: oembedData.thumbnail_url ?? post.thumbnail_url,
          };
        }
        return post;
      })
    )
  );

  return results.map((r, i) =>
    r.status === "fulfilled" ? r.value : posts[i]
  );
}
