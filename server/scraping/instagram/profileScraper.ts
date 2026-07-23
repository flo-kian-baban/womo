/**
 * Instagram Profile Scraper — Phase 2
 *
 * Multi-path scraper with fallback chain:
 *   Path A: Playwright mobile web (primary — highest data quality)
 *   Path B: Picuki fallback (no JS, no bot protection, reliable)
 *
 * oEmbed is used for post-level supplementation (see postScraper.ts),
 * not profile-level data.
 *
 * Session management:
 *   - 8–15s pauses between profile requests
 *   - Fresh context every 5 profiles
 *   - Mobile viewport consistently
 */

import { fetchHtml, detectSilentFailure, requestGovernor, recordScrapeEvent } from "../httpClient";
import { getContext, warmSession, retireContext } from "../browserClient";
import type { InstagramProfileData, InstagramPostData, InstagramScrapedProfile } from "./types";
import { emptyProfile } from "./types";

// ─── Path A: Playwright Mobile Web ───────────────────────────────────────────

async function scrapeViaPlaywright(handle: string): Promise<InstagramScrapedProfile | null> {
  let ctx: Awaited<ReturnType<typeof getContext>> | null = null;
  const scrapeStart = Date.now();
  const profileUrl = `https://www.instagram.com/${handle}/`;
  let navStatus: number | undefined;

  try {
    await requestGovernor("instagram");
    ctx = await getContext("mobile-ios", 5); // Retire after 5 uses
    const { page, context } = ctx;

    // ── GraphQL XHR Interception Setup ──
    // Instagram loads profile + post data via graphql/query API calls.
    // Accumulate user data and media edges from ALL responses.
    let capturedUserData: Record<string, unknown> | null = null;
    const capturedMediaEdges: unknown[] = [];
    let graphqlResponseCount = 0;

    page.on("response", async (response) => {
      try {
        const url = response.url();
        if (!url.includes("graphql") && !url.includes("api/v1/users")) return;
        if (response.status() !== 200) return;

        const body = await response.json().catch(() => null);
        if (!body) return;

        // Try to extract user data from GraphQL responses
        const userData = findUserData(body, handle);
        if (userData && !capturedUserData) {
          capturedUserData = userData;
          console.log(`[instagramScraper] @${handle}: XHR captured user profile data`);
        }

        // Try to extract media edges (posts)
        const edges = findMediaEdges(body);
        if (edges.length > 0) {
          capturedMediaEdges.push(...edges);
          graphqlResponseCount++;
          console.log(`[instagramScraper] @${handle}: XHR response #${graphqlResponseCount} captured ${edges.length} media edges (running total: ${capturedMediaEdges.length})`);
        }
      } catch { /* response body read failure — ignore */ }
    });

    // Session warming: visit instagram.com homepage first
    await warmSession(page, "https://www.instagram.com/", 3000, 5000);

    // Navigate to profile
    const url = profileUrl;
    const navResponse = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    navStatus = navResponse?.status();

    // Wait for content to load — Instagram's client-side JS
    await page.waitForTimeout(4000 + Math.floor(Math.random() * 2000));

    let html = await page.content();

    // Check for "Page couldn't load" — try reloading once
    const pageTitle = await page.title();
    if (pageTitle.includes("couldn't load") || pageTitle.includes("Page not found")) {
      console.log(`[instagramScraper] @${handle}: got "${pageTitle}" — reloading once`);
      await page.reload({ waitUntil: "networkidle", timeout: 15000 }).catch((err: Error) => {
        console.warn(`[instagramScraper] @${handle}: reload failed: ${err.message}`);
      });
      await page.waitForTimeout(3000 + Math.floor(Math.random() * 2000));
      html = await page.content();
    }

    // ── AGGRESSIVE SCROLL: trigger lazy-loaded post grid ──
    // Dismiss any "Log in" or "Not now" prompts first
    try {
      const loginDismiss = page.locator('text="Not now"').or(page.locator('text="Not Now"')).first();
      await loginDismiss.click({ timeout: 2000 }).catch(() => {});
    } catch { /* no dialog */ }

    const scrollPositions = [500, 1000, 1800, 2600];
    for (const yPos of scrollPositions) {
      await page.evaluate((y) => window.scrollTo(0, y), yPos);
      await page.waitForTimeout(1200 + Math.floor(Math.random() * 800));
    }

    // Extra wait for any final XHR responses
    await page.waitForTimeout(2000);

    // Retry: if 0 edges captured, reload and scroll again
    if (capturedMediaEdges.length === 0) {
      console.log(`[instagramScraper] @${handle}: 0 media edges after first scroll — retrying with reload`);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch((err: Error) => {
        console.warn(`[instagramScraper] @${handle}: retry reload failed: ${err.message}`);
      });
      await page.waitForTimeout(4000 + Math.floor(Math.random() * 2000));

      // Dismiss login prompts again
      try {
        const loginDismiss2 = page.locator('text="Not now"').or(page.locator('text="Not Now"')).first();
        await loginDismiss2.click({ timeout: 2000 }).catch(() => {});
      } catch { /* */ }

      // Scroll again
      for (const yPos of scrollPositions) {
        await page.evaluate((y) => window.scrollTo(0, y), yPos);
        await page.waitForTimeout(1500 + Math.floor(Math.random() * 1000));
      }
      await page.waitForTimeout(3000);
    }

    console.log(`[instagramScraper] @${handle}: Playwright scroll complete — ${graphqlResponseCount} GraphQL responses, ${capturedMediaEdges.length} media edges captured`);

    // ── FALLBACK: Direct API queries via Playwright context.request (inherits browser cookies) ──
    // This avoids page.evaluate serialization issues and works even when the page JS is blocked.
    if (capturedMediaEdges.length === 0) {
      console.log(`[instagramScraper] @${handle}: 0 posts from XHR — trying direct API queries`);

      const apiHeaders = {
        "X-IG-App-ID": "936619743392459",
        "X-Requested-With": "XMLHttpRequest",
        "X-ASBD-ID": "129477",
        "Accept": "*/*",
      };

      // Strategy A: web_profile_info (most reliable — returns full user + media)
      try {
        const wpiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${handle}`;
        const wpiStart = Date.now();
        const wpiRes = await context.request.get(wpiUrl, { headers: apiHeaders, timeout: 10000 });
        recordScrapeEvent({
          platform: "instagram", scrapeMethod: "instagram_playwright", urlRequested: wpiUrl,
          httpStatus: wpiRes.status(), durationMs: Date.now() - wpiStart,
          failureReason: wpiRes.ok() ? undefined : `web_profile_info HTTP ${wpiRes.status()}`,
        });
        if (wpiRes.ok()) {
          const wpiBody = await wpiRes.json();
          const edges = findMediaEdges(wpiBody);
          if (edges.length > 0) {
            capturedMediaEdges.push(...edges);
            console.log(`[instagramScraper] @${handle}: web_profile_info API got ${edges.length} media edges`);
          }
          if (!capturedUserData) {
            const userData = findUserData(wpiBody, handle);
            if (userData) {
              capturedUserData = userData;
              console.log(`[instagramScraper] @${handle}: web_profile_info API also yielded user profile data`);
            }
          }
        } else {
          console.log(`[instagramScraper] @${handle}: web_profile_info API returned ${wpiRes.status()}`);
        }
      } catch (err) {
        console.log(`[instagramScraper] @${handle}: web_profile_info API failed: ${(err as Error).message}`);
      }

      // Strategy B: feed/user endpoint (if we have userId from any source)
      if (capturedMediaEdges.length === 0 && capturedUserData) {
        const ud = capturedUserData as Record<string, unknown>;
        const userId = String(ud.pk ?? ud.id ?? "");
        if (userId) {
          try {
            const feedUrl = `https://www.instagram.com/api/v1/feed/user/${userId}/?count=12`;
            const feedStart = Date.now();
            const feedRes = await context.request.get(feedUrl, { headers: apiHeaders, timeout: 10000 });
            recordScrapeEvent({
              platform: "instagram", scrapeMethod: "instagram_playwright", urlRequested: feedUrl,
              httpStatus: feedRes.status(), durationMs: Date.now() - feedStart,
              failureReason: feedRes.ok() ? undefined : `feed/user HTTP ${feedRes.status()}`,
            });
            if (feedRes.ok()) {
              const feedBody = await feedRes.json();
              const edges = findMediaEdges(feedBody);
              if (edges.length > 0) {
                capturedMediaEdges.push(...edges);
                console.log(`[instagramScraper] @${handle}: feed API got ${edges.length} media edges`);
              }

              // feed/user response also has items[] with full post data
              const feedObj = feedBody as Record<string, unknown>;
              if (Array.isArray(feedObj.items) && feedObj.items.length > 0 && capturedMediaEdges.length === 0) {
                capturedMediaEdges.push(...(feedObj.items as unknown[]));
                console.log(`[instagramScraper] @${handle}: feed API items[] → ${feedObj.items.length} media items`);
              }
            } else {
              console.log(`[instagramScraper] @${handle}: feed API returned ${feedRes.status()}`);
            }
          } catch (err) {
            console.log(`[instagramScraper] @${handle}: feed API failed: ${(err as Error).message}`);
          }
        }
      }
    }

    // Check for silent failures
    const check = detectSilentFailure("instagram", html, url, page.url());
    if (check.isFailed && capturedMediaEdges.length === 0 && !capturedUserData) {
      console.warn(`[instagramScraper] Path A (Playwright) silent failure: ${check.reason}`);
      recordScrapeEvent({
        platform: "instagram", scrapeMethod: "instagram_playwright", urlRequested: url,
        httpStatus: navStatus, responseSizeBytes: html.length,
        silentFailureDetected: true, failureReason: check.reason,
        durationMs: Date.now() - scrapeStart,
      });
      await retireContext(context);
      return null;
    }

    // ── Build profile from XHR data + fallback extraction methods ──
    let profileData: InstagramScrapedProfile | null = null;

    // Best path: XHR-captured GraphQL data
    if (capturedUserData || capturedMediaEdges.length > 0) {
      const profile = capturedUserData
        ? extractProfileFromGraphqlUser(capturedUserData, handle)
        : emptyProfile();
      if (!capturedUserData) profile.username = handle;

      const posts = parseMediaEdgesToPosts(capturedMediaEdges, handle);
      profileData = {
        profile,
        posts,
        source: "playwright-mobile-xhr",
        confidence: posts.length >= 6 ? "high" : posts.length > 0 ? "medium" : "low",
      };
      console.log(`[instagramScraper] @${handle}: XHR path built profile (${posts.length} posts, followers=${profile.follower_count})`);
    }

    // Fallback: traditional extraction methods (if XHR didn't work)
    if (!profileData) {
      // Method 1: _sharedData
      try {
        const sharedData = await page.evaluate(() => {
          return (window as unknown as Record<string, unknown>)._sharedData;
        });
        if (sharedData) {
          const sd = sharedData as Record<string, unknown>;
          if (sd.entry_data) {
            profileData = parseSharedData(sharedData, handle);
            if (profileData) {
              console.log(`[instagramScraper] @${handle}: Method 1 (_sharedData) extracted profile`);
            }
          }
        }
      } catch { /* _sharedData not available */ }

      // Method 2: __additionalDataLoaded
      if (!profileData) {
        try {
          const additionalData = await page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll("script"));
            for (const script of scripts) {
              const text = script.textContent ?? "";
              if (text.includes("__additionalDataLoaded")) {
                const match = text.match(/__additionalDataLoaded\s*\(\s*['"][^'"]*['"]\s*,\s*(\{[\s\S]+?\})\s*\)/);
                if (match) return JSON.parse(match[1]);
              }
            }
            return null;
          });
          if (additionalData) {
            profileData = parseAdditionalData(additionalData as Record<string, unknown>, handle);
            if (profileData) {
              console.log(`[instagramScraper] @${handle}: Method 2 (additionalData) extracted profile`);
            }
          }
        } catch { /* */ }
      }

      // Method 3: Meta tags
      if (!profileData) {
        try {
          profileData = await parseFromMetaTags(page, handle);
          if (profileData) {
            console.log(`[instagramScraper] @${handle}: Method 3 (meta tags) extracted profile`);
          }
        } catch { /* */ }
      }
    }

    // If we got XHR posts but the profile extraction above has a different set,
    // merge the XHR posts into whichever profile we found
    if (profileData && capturedMediaEdges.length > 0 && profileData.source !== "playwright-mobile-xhr") {
      const xhrPosts = parseMediaEdgesToPosts(capturedMediaEdges, handle);
      if (xhrPosts.length > profileData.posts.length) {
        const existingIds = new Set(profileData.posts.map(p => p.id));
        const newPosts = xhrPosts.filter(p => !existingIds.has(p.id));
        profileData.posts.push(...newPosts);
        profileData.source = `${profileData.source}+xhr-posts`;
        console.log(`[instagramScraper] @${handle}: merged ${newPosts.length} XHR posts into profile`);
      }
    }

    await page.close();

    if (profileData) {
      console.log(`[instagramScraper] @${handle}: Playwright extracted profile (${profileData.posts.length} posts)`);
      recordScrapeEvent({
        platform: "instagram", scrapeMethod: "instagram_playwright", urlRequested: url,
        httpStatus: navStatus, responseSizeBytes: html.length,
        silentFailureDetected: check.isFailed,
        failureReason: check.isFailed ? check.reason : undefined,
        durationMs: Date.now() - scrapeStart,
      });
      return profileData;
    }

    console.log(`[instagramScraper] @${handle}: Playwright loaded page but all extraction methods failed`);
    recordScrapeEvent({
      platform: "instagram", scrapeMethod: "instagram_playwright", urlRequested: url,
      httpStatus: navStatus, responseSizeBytes: html.length,
      failureReason: "page loaded but all extraction methods failed",
      durationMs: Date.now() - scrapeStart,
    });
    return null;
  } catch (err) {
    console.warn(`[instagramScraper] Path A (Playwright) failed:`, (err as Error).message);
    recordScrapeEvent({
      platform: "instagram", scrapeMethod: "instagram_playwright", urlRequested: profileUrl,
      httpStatus: navStatus, failureReason: (err as Error).message.slice(0, 500),
      durationMs: Date.now() - scrapeStart,
    });
    if (ctx) {
      try { await ctx.page.close(); } catch { /* ignore */ }
    }
    return null;
  }
}

// ─── Path A2: Playwright Desktop Chrome ──────────────────────────────────────

async function scrapeViaPlaywrightDesktop(handle: string): Promise<InstagramScrapedProfile | null> {
  let ctx: Awaited<ReturnType<typeof getContext>> | null = null;
  const scrapeStart = Date.now();
  const profileUrl = `https://www.instagram.com/${handle}/`;
  let navStatus: number | undefined;

  try {
    await requestGovernor("instagram");
    ctx = await getContext("desktop-chrome", 5);
    const { page, context } = ctx;

    // ── GraphQL XHR Interception (same as mobile) ──
    let capturedUserData: Record<string, unknown> | null = null;
    const capturedMediaEdges: unknown[] = [];
    let graphqlResponseCount = 0;

    page.on("response", async (response) => {
      try {
        const url = response.url();
        if (!url.includes("graphql") && !url.includes("api/v1/users")) return;
        if (response.status() !== 200) return;

        const body = await response.json().catch(() => null);
        if (!body) return;

        const userData = findUserData(body, handle);
        if (userData && !capturedUserData) {
          capturedUserData = userData;
          console.log(`[instagramScraper] @${handle}: Desktop XHR captured user profile data`);
        }

        const edges = findMediaEdges(body);
        if (edges.length > 0) {
          capturedMediaEdges.push(...edges);
          graphqlResponseCount++;
          console.log(`[instagramScraper] @${handle}: Desktop XHR response #${graphqlResponseCount} — ${edges.length} edges (total: ${capturedMediaEdges.length})`);
        }
      } catch { /* ignore */ }
    });

    // Session warming
    await warmSession(page, "https://www.instagram.com/", 3000, 5000);

    const url = profileUrl;
    const navResponse = await page.goto(url, { waitUntil: "networkidle", timeout: 25000 }).catch((err: Error) => {
      console.warn(`[instagramScraper] @${handle}: desktop navigation failed: ${err.message}`);
      return null;
    });
    navStatus = navResponse?.status();
    await page.waitForTimeout(3000 + Math.floor(Math.random() * 2000));

    // Scroll to trigger post grid loading
    const scrollPositions = [600, 1200, 2000, 2800];
    for (const yPos of scrollPositions) {
      await page.evaluate((y) => window.scrollTo(0, y), yPos);
      await page.waitForTimeout(1000 + Math.floor(Math.random() * 800));
    }
    await page.waitForTimeout(2000);

    console.log(`[instagramScraper] @${handle}: Desktop scroll complete — ${graphqlResponseCount} GraphQL responses, ${capturedMediaEdges.length} edges`);

    // Best path: XHR-captured data
    let profileData: InstagramScrapedProfile | null = null;

    if (capturedUserData || capturedMediaEdges.length > 0) {
      const profile = capturedUserData
        ? extractProfileFromGraphqlUser(capturedUserData, handle)
        : emptyProfile();
      if (!capturedUserData) profile.username = handle;

      const posts = parseMediaEdgesToPosts(capturedMediaEdges, handle);
      profileData = {
        profile,
        posts,
        source: "playwright-desktop-xhr",
        confidence: posts.length >= 6 ? "high" : posts.length > 0 ? "medium" : "low",
      };
    }

    // Fallback: meta tags
    if (!profileData) {
      try {
        profileData = await parseFromMetaTags(page, handle);
        if (profileData) {
          profileData.source = "playwright-desktop-meta";
          console.log(`[instagramScraper] @${handle}: Desktop meta tags extracted profile`);
        }
      } catch { /* meta parse failed */ }
    }

    // Fallback: _sharedData
    if (!profileData) {
      try {
        const sharedData = await page.evaluate(() => {
          return (window as unknown as Record<string, unknown>)._sharedData;
        });
        if (sharedData) {
          const sd = sharedData as Record<string, unknown>;
          if (sd.entry_data) {
            profileData = parseSharedData(sharedData, handle);
            if (profileData) {
              profileData.source = "playwright-desktop-sharedData";
            }
          }
        }
      } catch { /* _sharedData not available */ }
    }

    // Merge XHR posts if desktop fallback methods found profile but no posts
    if (profileData && capturedMediaEdges.length > 0 && profileData.posts.length === 0) {
      profileData.posts = parseMediaEdgesToPosts(capturedMediaEdges, handle);
      profileData.source = `${profileData.source}+xhr-posts`;
    }

    await page.close();

    if (profileData) {
      console.log(`[instagramScraper] @${handle}: Desktop Playwright got profile (${profileData.posts.length} posts)`);
      recordScrapeEvent({
        platform: "instagram", scrapeMethod: "instagram_playwright", urlRequested: url,
        httpStatus: navStatus, durationMs: Date.now() - scrapeStart,
      });
      return profileData;
    }

    console.log(`[instagramScraper] @${handle}: Desktop Playwright also failed`);
    recordScrapeEvent({
      platform: "instagram", scrapeMethod: "instagram_playwright", urlRequested: url,
      httpStatus: navStatus, failureReason: "desktop page loaded but all extraction methods failed",
      durationMs: Date.now() - scrapeStart,
    });
    return null;
  } catch (err) {
    console.warn(`[instagramScraper] Path A2 (Desktop Playwright) failed:`, (err as Error).message);
    recordScrapeEvent({
      platform: "instagram", scrapeMethod: "instagram_playwright", urlRequested: profileUrl,
      httpStatus: navStatus, failureReason: (err as Error).message.slice(0, 500),
      durationMs: Date.now() - scrapeStart,
    });
    if (ctx) {
      try { await ctx.page.close(); } catch { /* ignore */ }
    }
    return null;
  }
}

// ─── Path B: Picuki Fallback ─────────────────────────────────────────────────

async function scrapeViaPicuki(handle: string): Promise<InstagramScrapedProfile | null> {
  try {
    await requestGovernor("instagram");
    const url = `https://picuki.com/profile/${handle}`;
    const html = await fetchHtml(url, { timeout: 12000, maxRetries: 2 });

    if (html.length < 1000 || html.includes("Page not found") || html.includes("404")) {
      console.warn(`[instagramScraper] Picuki returned empty/404 for @${handle}`);
      return null;
    }

    const profile = emptyProfile();
    profile.username = handle;

    // Extract profile metadata from Picuki HTML
    // Full name
    const nameMatch = html.match(/<h1[^>]*class="[^"]*profile-name[^"]*"[^>]*>([^<]+)<\/h1>/i)
      ?? html.match(/<div[^>]*class="[^"]*profile-name[^"]*"[^>]*>([^<]+)<\/div>/i);
    if (nameMatch) profile.full_name = nameMatch[1].trim();

    // Bio
    const bioMatch = html.match(/<div[^>]*class="[^"]*profile-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (bioMatch) {
      profile.biography = bioMatch[1]
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
    }

    // Stats: follower count, following count, media count
    const statMatches = html.match(/<span[^>]*class="[^"]*total[^"]*"[^>]*>([\d,.KkMm]+)<\/span>/gi) ?? [];
    const statValues = statMatches.map(m => {
      const inner = m.match(/>([^<]+)</)?.[1] ?? "0";
      return parseHumanCount(inner);
    });
    if (statValues.length >= 3) {
      profile.media_count = statValues[0];
      profile.follower_count = statValues[1];
      profile.following_count = statValues[2];
    } else if (statValues.length >= 1) {
      // Try alternate patterns
      const followerMatch = html.match(/(\d[\d,.]*[KkMm]?)\s*(?:followers|Followers)/);
      if (followerMatch) profile.follower_count = parseHumanCount(followerMatch[1]);
      const postMatch = html.match(/(\d[\d,.]*[KkMm]?)\s*(?:posts|Posts)/);
      if (postMatch) profile.media_count = parseHumanCount(postMatch[1]);
    }

    // External URL
    const urlMatch = html.match(/<a[^>]*class="[^"]*profile-url[^"]*"[^>]*href="([^"]+)"/i);
    if (urlMatch) profile.external_url = urlMatch[1];

    // Verified badge
    if (html.includes("verified") || html.includes("is_verified")) {
      profile.is_verified = true;
    }

    // Extract recent posts
    const posts: InstagramPostData[] = [];
    const postBlocks = html.match(/<div[^>]*class="[^"]*post-image[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi) ?? [];

    for (const block of postBlocks.slice(0, 12)) {
      // Extract shortcode from link
      const linkMatch = block.match(/href="[^"]*\/p\/([^/"]+)/i)
        ?? block.match(/data-s="([^"]+)"/i);
      const shortcode = linkMatch?.[1] ?? "";
      if (!shortcode) continue;

      // Caption from alt text or data attribute
      const captionMatch = block.match(/alt="([^"]*)"/)
        ?? block.match(/data-caption="([^"]*)"/);
      const caption = (captionMatch?.[1] ?? "")
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');

      // Like count
      const likeMatch = block.match(/([\d,.]+[KkMm]?)\s*(?:likes?)/i);
      const like_count = likeMatch ? parseHumanCount(likeMatch[1]) : 0;

      // Comment count
      const commentMatch = block.match(/([\d,.]+[KkMm]?)\s*(?:comments?)/i);
      const comment_count = commentMatch ? parseHumanCount(commentMatch[1]) : 0;

      // Media type
      const isVideo = block.includes("video") || block.includes("reel");

      posts.push({
        id: shortcode,
        shortcode,
        timestamp: 0,
        caption,
        like_count,
        comment_count,
        view_count: 0,
        media_type: isVideo ? "video" : "photo",
      });
    }

    console.log(`[instagramScraper] @${handle}: Picuki extracted profile (${posts.length} posts)`);

    return {
      profile,
      posts,
      source: "picuki",
      confidence: "medium",
    };
  } catch (err) {
    console.warn(`[instagramScraper] Path B (Picuki) failed:`, (err as Error).message);
    return null;
  }
}

// ─── Multi-Path Orchestrator ─────────────────────────────────────────────────

/**
 * Two-phase Instagram profile scrape (mirrors TikTok architecture):
 *   Phase 1: Picuki for fast profile data (bio, stats — HTTP only)
 *   Phase 2: ALWAYS Playwright for posts (GraphQL XHR interception)
 *
 * Playwright is the PRIMARY post source, not a fallback.
 */
export async function scrapeInstagramProfile(handle: string): Promise<InstagramScrapedProfile> {
  // ── Phase 1: Fast HTTP for profile data ──
  let picukiResult: InstagramScrapedProfile | null = null;
  try {
    picukiResult = await scrapeViaPicuki(handle);
    if (picukiResult) {
      console.log(`[instagramScraper] @${handle}: Phase 1 — Picuki got profile (followers=${picukiResult.profile.follower_count}, posts=${picukiResult.posts.length})`);
    }
  } catch (err) {
    console.log(`[instagramScraper] @${handle}: Phase 1 — Picuki failed: ${(err as Error).message}`);
  }

  // ── Phase 2: ALWAYS Playwright for posts (not a fallback) ──
  console.log(`[instagramScraper] @${handle}: Phase 2 — Playwright for posts (always runs)`);
  const playwrightResult = await scrapeViaPlaywright(handle);

  if (playwrightResult) {
    const postCount = playwrightResult.posts.length;
    console.log(`[instagramScraper] @${handle}: Phase 2 — Playwright mobile got ${postCount} posts`);

    // If Playwright got posts but profile data is weak, merge with Picuki
    if (picukiResult && playwrightResult.profile.follower_count === 0 && picukiResult.profile.follower_count > 0) {
      // Use Picuki's profile data (better stats) with Playwright's posts
      const merged = mergeProfiles(playwrightResult, picukiResult);
      merged.posts = playwrightResult.posts.length > picukiResult.posts.length
        ? playwrightResult.posts
        : [...playwrightResult.posts, ...picukiResult.posts.filter(p => !playwrightResult.posts.some(pp => pp.shortcode === p.shortcode))];
      merged.source = `picuki+${playwrightResult.source}`;
      const confidence = merged.posts.length >= 6 ? "high" : merged.posts.length > 0 ? "medium" : "low";
      merged.confidence = confidence;
      console.log(`[instagramScraper] @${handle}: merged Picuki profile + Playwright posts (${merged.posts.length} posts, confidence=${confidence})`);
      return merged;
    }

    // If Playwright got both profile + posts, return it
    if (postCount > 0 || playwrightResult.profile.follower_count > 0 || playwrightResult.profile.biography.length > 0) {
      // Supplement with shortcode extraction if posts still low
      if (postCount === 0) {
        const supplementedPosts = await extractAndSupplementPosts(handle);
        if (supplementedPosts.length > 0) {
          playwrightResult.posts = supplementedPosts;
          playwrightResult.source = `${playwrightResult.source}+oembed-posts`;
          return playwrightResult;
        }

        // If still 0 posts, try desktop Playwright before giving up
        console.log(`[instagramScraper] @${handle}: mobile got profile but 0 posts — trying desktop for posts`);
        const desktopForPosts = await scrapeViaPlaywrightDesktop(handle);
        if (desktopForPosts && desktopForPosts.posts.length > 0) {
          console.log(`[instagramScraper] @${handle}: desktop got ${desktopForPosts.posts.length} posts — merging`);
          playwrightResult.posts = desktopForPosts.posts;
          playwrightResult.source = `${playwrightResult.source}+desktop-posts`;
          playwrightResult.confidence = desktopForPosts.posts.length >= 6 ? "high" : "medium";
          return playwrightResult;
        }
      }
      return playwrightResult;
    }
  }

  // ── Phase 2b: Desktop fallback if mobile failed ──
  console.log(`[instagramScraper] @${handle}: Phase 2b — trying desktop Playwright`);
  const desktopResult = await scrapeViaPlaywrightDesktop(handle);
  if (desktopResult && (desktopResult.posts.length > 0 || desktopResult.profile.follower_count > 0)) {
    if (picukiResult && desktopResult.profile.follower_count === 0) {
      const merged = mergeProfiles(desktopResult, picukiResult);
      merged.posts = desktopResult.posts.length > 0 ? desktopResult.posts : picukiResult.posts;
      merged.source = `picuki+${desktopResult.source}`;
      return merged;
    }
    return desktopResult;
  }

  // ── Fallback: Return Picuki data if available ──
  if (picukiResult && (picukiResult.profile.follower_count > 0 || picukiResult.posts.length > 0)) {
    console.log(`[instagramScraper] @${handle}: all Playwright paths failed — returning Picuki data`);
    return picukiResult;
  }

  // ── Last resort: oEmbed metadata ──
  try {
    await requestGovernor("instagram");
    const oembedUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(`https://www.instagram.com/${handle}/`)}&omitscript=true`;
    const text = await fetchHtml(oembedUrl, { timeout: 8000, maxRetries: 2 });
    const oembed = JSON.parse(text) as Record<string, unknown>;
    if (oembed.author_name) {
      const profile = emptyProfile();
      profile.username = handle;
      profile.full_name = String(oembed.author_name ?? "");
      console.log(`[instagramScraper] @${handle}: oEmbed fallback got name="${profile.full_name}"`);
      return {
        profile,
        posts: [],
        source: "oembed-fallback",
        confidence: "low",
      };
    }
  } catch {
    console.log(`[instagramScraper] @${handle}: oEmbed fallback failed`);
  }

  // Return whatever Playwright got (even partial)
  if (playwrightResult) {
    return playwrightResult;
  }

  // All paths failed
  console.warn(`[instagramScraper] All paths failed for @${handle}`);
  return {
    profile: { ...emptyProfile(), username: handle },
    posts: [],
    source: "none",
    confidence: "low",
  };
}

// ─── Post Extraction from Profile Page HTML ──────────────────────────────────

/**
 * Extract post shortcodes and available metadata from the Instagram profile page.
 * Uses Playwright to load the profile and extract post links + image alt text.
 * Falls back to raw HTML regex if page.evaluate() fails.
 */
async function extractAndSupplementPosts(handle: string): Promise<InstagramPostData[]> {
  const posts: InstagramPostData[] = [];

  try {
    console.log(`[instagramScraper] @${handle}: extracting post shortcodes from page HTML`);

    await requestGovernor("instagram");
    const ctx = await getContext("desktop-chrome", 5);
    const { page } = ctx;

    await warmSession(page, "https://www.instagram.com/", 2000, 4000);
    await page.goto(`https://www.instagram.com/${handle}/`, {
      waitUntil: "networkidle",
      timeout: 25000,
    }).catch((err: Error) => {
      console.warn(`[instagramScraper] @${handle}: post extraction navigation failed: ${err.message}`);
    });
    await page.waitForTimeout(3000 + Math.floor(Math.random() * 2000));

    // Scroll to load more post thumbnails
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 1600));
    await page.waitForTimeout(1000);

    // Try DOM extraction first, then raw HTML fallback
    let extractedPosts: Array<{ shortcode: string; caption: string; isVideo: boolean }> = [];

    try {
      extractedPosts = await page.evaluate(() => {
        const results: Array<{ shortcode: string; caption: string; isVideo: boolean }> = [];
        const seen = new Set<string>();

        // Method 1: Find all post links with images
        const links = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
        for (let i = 0; i < links.length && results.length < 12; i++) {
          const link = links[i] as HTMLAnchorElement;
          const href = link.getAttribute("href") ?? "";
          const scMatch = href.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
          if (!scMatch || seen.has(scMatch[1])) continue;
          seen.add(scMatch[1]);

          // Try to get caption from img alt text within the link
          const img = link.querySelector("img");
          const alt = img?.getAttribute("alt") ?? "";

          // Check if it's a video (reel link or video icon present)
          const isVideo = href.includes("/reel/") || !!link.querySelector('[aria-label*="Video"]') || !!link.querySelector('[aria-label*="Reel"]');

          results.push({
            shortcode: scMatch[1],
            caption: alt,
            isVideo,
          });
        }

        return results;
      });
      console.log(`[instagramScraper] @${handle}: DOM extraction found ${extractedPosts.length} posts`);
    } catch (evalErr) {
      console.log(`[instagramScraper] @${handle}: DOM extraction failed: ${(evalErr as Error).message?.slice(0, 60)} — trying raw HTML`);

      // Fallback: extract from raw HTML
      const html = await page.content();
      const shortcodes = extractShortcodesFromHtml(html);

      // Try to find captions from img alt attributes near shortcode links
      for (const sc of shortcodes.slice(0, 12)) {
        // Look for alt text in img tags near the shortcode
        const altRegex = new RegExp(`/(?:p|reel)/${sc}/[^>]*>\\s*(?:<[^>]*>)*\\s*<img[^>]*alt="([^"]*)"`, "i");
        const altMatch = html.match(altRegex);
        // Also try reverse order (img before link)
        const altRegex2 = new RegExp(`<img[^>]*alt="([^"]*)"[^>]*>[^]*?/(?:p|reel)/${sc}/`, "i");
        const altMatch2 = !altMatch ? html.match(altRegex2) : null;

        const caption = (altMatch?.[1] ?? altMatch2?.[1] ?? "")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");

        extractedPosts.push({
          shortcode: sc,
          caption,
          isVideo: html.includes(`/reel/${sc}/`),
        });
      }
      console.log(`[instagramScraper] @${handle}: raw HTML fallback found ${extractedPosts.length} posts`);
    }

    await page.close();

    // Convert to InstagramPostData
    for (const ep of extractedPosts) {
      posts.push({
        id: ep.shortcode,
        shortcode: ep.shortcode,
        timestamp: 0,
        caption: ep.caption,
        like_count: 0,
        comment_count: 0,
        view_count: 0,
        media_type: ep.isVideo ? "video" : "photo",
      });
    }

    if (posts.length > 0) {
      console.log(`[instagramScraper] @${handle}: extracted ${posts.length} posts from profile page`);
    } else {
      console.log(`[instagramScraper] @${handle}: no posts extracted from profile page`);
    }
  } catch (err) {
    console.log(`[instagramScraper] @${handle}: post extraction failed: ${(err as Error).message}`);
  }

  return posts;
}

/**
 * Extract Instagram post shortcodes from raw HTML.
 * Looks for /p/{shortcode}/ and /reel/{shortcode}/ patterns.
 */
function extractShortcodesFromHtml(html: string): string[] {
  const shortcodeSet = new Set<string>();

  // Pattern 1: /p/{shortcode}/ links
  let match: RegExpExecArray | null;
  const pRegex = /\/p\/([A-Za-z0-9_-]{6,})\//g;
  while ((match = pRegex.exec(html)) !== null) {
    shortcodeSet.add(match[1]);
  }

  // Pattern 2: /reel/{shortcode}/ links
  const reelRegex = /\/reel\/([A-Za-z0-9_-]{6,})\//g;
  while ((match = reelRegex.exec(html)) !== null) {
    shortcodeSet.add(match[1]);
  }

  // Filter out obvious non-shortcodes (too long, looks like a path segment)
  const filtered = Array.from(shortcodeSet).filter(sc => {
    if (sc.length > 30) return false;
    if (sc.includes("__")) return false;
    return true;
  });

  return filtered.slice(0, 24);
}

// ─── GraphQL XHR Data Extraction Helpers ──────────────────────────────────────

/**
 * Recursively search a JSON response body for user data.
 * Instagram GraphQL responses have varying shapes — the user object
 * can be nested at different depths depending on the query type.
 */
function findUserData(body: unknown, handle: string): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;

  // Direct user object check
  if (obj.username && String(obj.username).toLowerCase() === handle.toLowerCase()) {
    if (obj.biography !== undefined || obj.edge_followed_by || obj.follower_count) {
      return obj;
    }
  }

  // Common GraphQL response shapes
  const paths = [
    obj.data,
    (obj.data as Record<string, unknown>)?.user,
    obj.user,
    obj.graphql,
    (obj.graphql as Record<string, unknown>)?.user,
    (obj as Record<string, unknown>)?.native_user,
  ];

  for (const p of paths) {
    if (!p || typeof p !== "object") continue;
    const candidate = p as Record<string, unknown>;
    const username = String(candidate.username ?? "").toLowerCase();
    if (username === handle.toLowerCase() && (candidate.biography !== undefined || candidate.edge_followed_by || candidate.follower_count)) {
      return candidate;
    }
  }

  // Recurse into response data
  for (const key of Object.keys(obj)) {
    if (key.startsWith("_")) continue; // Skip internal keys
    const val = obj[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const found = findUserData(val, handle);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Recursively search for media edge arrays in a GraphQL response.
 * Instagram returns post data in `edges` arrays nested under various keys
 * like `edge_owner_to_timeline_media`, `edge_web_feed_timeline`, etc.
 */
function findMediaEdges(body: unknown): unknown[] {
  if (!body || typeof body !== "object") return [];
  const obj = body as Record<string, unknown>;
  const results: unknown[] = [];

  // Check known edge-containing keys
  const edgeKeys = [
    "edge_owner_to_timeline_media",
    "edge_web_feed_timeline",
    "edge_media_collections",
    "items",
    "media",
  ];

  for (const key of edgeKeys) {
    const container = obj[key] as Record<string, unknown> | undefined;
    if (container) {
      // GraphQL style: { edges: [{ node: {...} }] }
      const edges = container.edges as unknown[] | undefined;
      if (edges && Array.isArray(edges) && edges.length > 0) {
        results.push(...edges);
        continue;
      }
      // API v1 style: direct array of items
      if (Array.isArray(container)) {
        results.push(...container.map(item => ({ node: item })));
      }
    }
  }

  // Recurse into data/user/graphql
  if (results.length === 0) {
    const recurseKeys = ["data", "user", "graphql"];
    for (const key of recurseKeys) {
      const val = obj[key];
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const found = findMediaEdges(val);
        if (found.length > 0) return found;
      }
    }
  }

  return results;
}

/**
 * Convert raw GraphQL media edges to InstagramPostData[].
 */
function parseMediaEdgesToPosts(edges: unknown[], handle: string): InstagramPostData[] {
  const posts: InstagramPostData[] = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    try {
      const e = edge as Record<string, unknown>;
      const node = (e.node ?? e) as Record<string, unknown>;
      if (!node) continue;

      const shortcode = String(node.shortcode ?? node.code ?? "");
      const id = String(node.id ?? shortcode);
      if (!shortcode || seen.has(shortcode)) continue;
      seen.add(shortcode);

      // Caption extraction — handle both GraphQL and API v1 shapes
      let caption = "";
      const captionEdges = (node.edge_media_to_caption as Record<string, unknown>)?.edges as unknown[] ?? [];
      if (captionEdges.length > 0) {
        caption = String(((captionEdges[0] as Record<string, unknown>).node as Record<string, unknown>)?.text ?? "");
      } else if (node.caption) {
        // API v1 shape: caption is { text: "..." } or direct string
        const cap = node.caption;
        caption = typeof cap === "string" ? cap : String((cap as Record<string, unknown>)?.text ?? "");
      }

      // Media type
      const typeName = String(node.__typename ?? "");
      let mediaType: InstagramPostData["media_type"] = "photo";
      if (typeName.includes("Video") || node.is_video || node.media_type === 2) mediaType = "video";
      if (typeName.includes("Sidecar") || node.media_type === 8) mediaType = "carousel";

      // Engagement
      const likeCount = Number((node.edge_media_preview_like as Record<string, unknown>)?.count ?? node.like_count ?? 0);
      const commentCount = Number((node.edge_media_to_comment as Record<string, unknown>)?.count ?? node.comment_count ?? 0);
      const viewCount = Number(node.video_view_count ?? node.view_count ?? node.play_count ?? 0);

      // Video URL — Instagram GraphQL includes this for reels and video posts
      let videoUrl: string | undefined;
      if (node.video_url) {
        videoUrl = String(node.video_url);
      } else if (node.video_versions && Array.isArray(node.video_versions)) {
        // API v1 shape: video_versions is an array with { url, width, height }
        const versions = node.video_versions as Array<Record<string, unknown>>;
        if (versions.length > 0) {
          videoUrl = String(versions[0].url ?? "");
        }
      }

      // Duration
      const duration = node.video_duration ? Number(node.video_duration) : undefined;

      posts.push({
        id,
        shortcode,
        timestamp: Number(node.taken_at_timestamp ?? node.taken_at ?? 0),
        caption,
        like_count: likeCount,
        comment_count: commentCount,
        view_count: viewCount,
        media_type: mediaType,
        video_duration: duration,
        thumbnail_url: String(node.thumbnail_src ?? node.display_url ?? ""),
        video_url: videoUrl,
      });
    } catch { /* skip malformed edge */ }
  }

  console.log(`[instagramScraper] @${handle}: parsed ${posts.length} posts from ${edges.length} media edges`);
  return posts;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseSharedData(sharedData: unknown, handle: string): InstagramScrapedProfile | null {
  try {
    const sd = sharedData as Record<string, unknown>;
    const entryData = sd.entry_data as Record<string, unknown> | undefined;
    const profilePage = (entryData?.ProfilePage as unknown[])?.[0] as Record<string, unknown> | undefined;
    const graphql = profilePage?.graphql as Record<string, unknown> | undefined;
    const user = graphql?.user as Record<string, unknown> | undefined;

    if (!user) return null;

    const profile = extractProfileFromGraphqlUser(user, handle);
    const posts = extractPostsFromEdges(user);

    return { profile, posts, source: "playwright-sharedData", confidence: "high" };
  } catch {
    return null;
  }
}

function parseAdditionalData(data: Record<string, unknown>, handle: string): InstagramScrapedProfile | null {
  try {
    const graphql = data.graphql as Record<string, unknown> | undefined;
    const user = (graphql?.user ?? data.user) as Record<string, unknown> | undefined;

    if (!user) return null;

    const profile = extractProfileFromGraphqlUser(user, handle);
    const posts = extractPostsFromEdges(user);

    return { profile, posts, source: "playwright-additionalData", confidence: "high" };
  } catch {
    return null;
  }
}

async function parseFromMetaTags(page: import("playwright").Page, handle: string): Promise<InstagramScrapedProfile | null> {
  // Strategy: try page.evaluate() first (more accurate), then fall back to raw HTML regex
  let description = "";
  let ogTitle = "";
  let title = "";

  // Attempt 1: page.evaluate()
  try {
    const metaData = await page.evaluate(() => {
      const getMeta = (name: string) =>
        document.querySelector(`meta[property="${name}"]`)?.getAttribute("content") ??
        document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? "";

      return {
        title: document.title,
        description: getMeta("og:description") || getMeta("description"),
        ogTitle: getMeta("og:title"),
      };
    });
    description = metaData.description;
    ogTitle = metaData.ogTitle;
    title = metaData.title;
    console.log(`[instagramScraper] @${handle}: meta (evaluate) → desc="${description?.slice(0, 80)}", ogTitle="${ogTitle?.slice(0, 50)}"`);
  } catch (evalErr) {
    console.log(`[instagramScraper] @${handle}: page.evaluate() failed: ${(evalErr as Error).message?.slice(0, 80)} — trying raw HTML`);

    // Attempt 2: Parse from raw HTML (works even when JS context is broken)
    try {
      const html = await page.content();
      const descMatch = html.match(/<meta[^>]*(?:property|name)="(?:og:description|description)"[^>]*content="([^"]*)"/) ??
                        html.match(/content="([^"]*)"[^>]*(?:property|name)="(?:og:description|description)"/);
      const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/) ??
                           html.match(/content="([^"]*)"[^>]*property="og:title"/);
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);

      description = descMatch?.[1]?.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'") ?? "";
      ogTitle = ogTitleMatch?.[1]?.replace(/&amp;/g, "&").replace(/&quot;/g, '"') ?? "";
      title = titleMatch?.[1] ?? "";
      console.log(`[instagramScraper] @${handle}: meta (raw HTML) → desc="${description?.slice(0, 80)}", ogTitle="${ogTitle?.slice(0, 50)}"`);
    } catch (htmlErr) {
      console.log(`[instagramScraper] @${handle}: raw HTML meta extraction also failed: ${(htmlErr as Error).message}`);
      return null;
    }
  }

  if (!description && !ogTitle) {
    console.log(`[instagramScraper] @${handle}: meta tags empty — no description or ogTitle`);
    return null;
  }

  const profile = emptyProfile();
  profile.username = handle;

  // Parse "123K Followers, 456 Following, 789 Posts" from description
  const followerMatch = description.match(/([\d,.]+[KkMm]?)\s*Followers/i);
  const followingMatch = description.match(/([\d,.]+[KkMm]?)\s*Following/i);
  const postsMatch = description.match(/([\d,.]+[KkMm]?)\s*Posts/i);

  if (followerMatch) profile.follower_count = parseHumanCount(followerMatch[1]);
  if (followingMatch) profile.following_count = parseHumanCount(followingMatch[1]);
  if (postsMatch) profile.media_count = parseHumanCount(postsMatch[1]);

  // Extract bio from the remaining description text
  const bioStart = description.indexOf(" - ");
  if (bioStart >= 0) {
    const afterDash = description.slice(bioStart + 3);
    // Remove "See Instagram photos and videos from ..." suffix
    const bioEnd = afterDash.indexOf("See Instagram");
    profile.biography = bioEnd >= 0 ? afterDash.slice(0, bioEnd).trim() : afterDash.trim();
  }

  // Full name from og:title
  if (ogTitle) {
    const nameMatch = ogTitle.match(/^([^(]+)/);
    if (nameMatch) profile.full_name = nameMatch[1].trim();
  }

  console.log(`[instagramScraper] @${handle}: meta parsed → followers=${profile.follower_count}, name="${profile.full_name}"`);

  return {
    profile,
    posts: [],
    source: "playwright-meta",
    confidence: "low",
  };
}

// ─── GraphQL User Extraction ─────────────────────────────────────────────────

function extractProfileFromGraphqlUser(user: Record<string, unknown>, handle: string): InstagramProfileData {
  const profile = emptyProfile();
  profile.username = String(user.username ?? handle);
  profile.full_name = String(user.full_name ?? "");
  profile.biography = String(user.biography ?? "");
  profile.follower_count = Number((user.edge_followed_by as Record<string, unknown>)?.count ?? user.follower_count ?? 0);
  profile.following_count = Number((user.edge_follow as Record<string, unknown>)?.count ?? user.following_count ?? 0);
  profile.media_count = Number((user.edge_owner_to_timeline_media as Record<string, unknown>)?.count ?? user.media_count ?? 0);
  profile.category = String(user.category_name ?? user.category ?? "");
  profile.external_url = String(user.external_url ?? "");
  profile.is_business_account = Boolean(user.is_business_account ?? false);
  profile.is_verified = Boolean(user.is_verified ?? false);
  profile.profile_pic_url = String(user.profile_pic_url_hd ?? user.profile_pic_url ?? "");
  return profile;
}

function extractPostsFromEdges(user: Record<string, unknown>): InstagramPostData[] {
  const posts: InstagramPostData[] = [];
  const timelineMedia = user.edge_owner_to_timeline_media as Record<string, unknown> | undefined;
  const edges = (timelineMedia?.edges as unknown[]) ?? [];

  for (const edge of edges.slice(0, 12)) {
    const node = (edge as Record<string, unknown>).node as Record<string, unknown>;
    if (!node) continue;

    const captionEdges = (node.edge_media_to_caption as Record<string, unknown>)?.edges as unknown[] ?? [];
    const caption = captionEdges.length > 0
      ? String(((captionEdges[0] as Record<string, unknown>).node as Record<string, unknown>)?.text ?? "")
      : "";

    const typeName = String(node.__typename ?? "");
    let mediaType: InstagramPostData["media_type"] = "photo";
    if (typeName.includes("Video") || node.is_video) mediaType = "video";
    if (typeName.includes("Sidecar")) mediaType = "carousel";

    posts.push({
      id: String(node.id ?? ""),
      shortcode: String(node.shortcode ?? ""),
      timestamp: Number(node.taken_at_timestamp ?? 0),
      caption,
      like_count: Number((node.edge_media_preview_like as Record<string, unknown>)?.count ?? node.like_count ?? 0),
      comment_count: Number((node.edge_media_to_comment as Record<string, unknown>)?.count ?? node.comment_count ?? 0),
      view_count: Number(node.video_view_count ?? 0),
      media_type: mediaType,
      video_duration: node.video_duration ? Number(node.video_duration) : undefined,
      thumbnail_url: String(node.thumbnail_src ?? node.display_url ?? ""),
      video_url: node.video_url ? String(node.video_url) : undefined,
    });
  }

  return posts;
}

// ─── Merge Helper ─────────────────────────────────────────────────────────────

function mergeProfiles(primary: InstagramScrapedProfile, secondary: InstagramScrapedProfile): InstagramScrapedProfile {
  const merged = { ...primary };

  // Fill in missing profile fields from secondary
  const p = merged.profile;
  const s = secondary.profile;
  if (!p.full_name && s.full_name) p.full_name = s.full_name;
  if (!p.biography && s.biography) p.biography = s.biography;
  if (p.follower_count === 0 && s.follower_count > 0) p.follower_count = s.follower_count;
  if (p.following_count === 0 && s.following_count > 0) p.following_count = s.following_count;
  if (p.media_count === 0 && s.media_count > 0) p.media_count = s.media_count;
  if (!p.external_url && s.external_url) p.external_url = s.external_url;
  if (!p.category && s.category) p.category = s.category;

  // Add posts from secondary if primary has none
  if (merged.posts.length === 0) {
    merged.posts = secondary.posts;
  }

  merged.source = `${primary.source}+${secondary.source}`;
  merged.confidence = primary.confidence === "low" ? secondary.confidence : primary.confidence;

  return merged;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseHumanCount(text: string): number {
  const cleaned = text.replace(/,/g, "").trim();
  const suffixMatch = cleaned.match(/^([\d.]+)\s*([KkMmBb])/);
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
