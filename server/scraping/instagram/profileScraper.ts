/**
 * Instagram Profile Scraper — Phase 2
 *
 * Multi-path scraper with fallback chain:
 *   Path A: Playwright mobile web (primary — highest data quality)
 *   Path B: Playwright desktop (fallback when mobile yields nothing)
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
import type { InstagramProfileData, InstagramPostData, InstagramScrapedProfile, RenderedBaseFields } from "./types";
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

        // Try to extract user data from GraphQL responses.
        //
        // MERGED, not first-match-wins. Instagram's GraphQL responses carry
        // user nodes with DIFFERENT subsets of fields — the first to arrive is
        // typically a light node with followers and bio but NO posts count, so
        // first-wins banked media_count 0 for every creator (natgeo, ~30k
        // posts, banked "videoCount": 0 into its evidence — corpus-rebuild
        // item 4). Later nodes that do carry the count now fill the gaps;
        // fields already seen keep their first value.
        const userData = findUserData(body, handle);
        if (userData) {
          const before = capturedUserData;
          capturedUserData = mergeUserNodes(capturedUserData, userData);
          if (!before) console.log(`[instagramScraper] @${handle}: XHR captured user profile data`);
          else if (capturedUserData !== before) console.log(`[instagramScraper] @${handle}: XHR merged additional profile fields from a later response`);
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
          {
            // Same merge as the XHR listener: web_profile_info's user node is
            // the one that reliably carries edge_owner_to_timeline_media.count,
            // so it back-fills the posts count even when a light node arrived
            // first.
            const userData = findUserData(wpiBody, handle);
            if (userData) {
              const before = capturedUserData;
              capturedUserData = mergeUserNodes(capturedUserData, userData);
              if (!before) console.log(`[instagramScraper] @${handle}: web_profile_info API also yielded user profile data`);
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

// ─── Multi-Path Orchestrator ─────────────────────────────────────────────────

/**
 * Instagram profile scrape: Playwright mobile, then desktop, then oEmbed.
 *
 * ─── Picuki was removed (S5) ────────────────────────────────────────────────
 * It used to run first, as a fast HTTP probe for profile stats before the
 * Playwright pass. It never once worked: 16 attempts in `scrape_events`, 16
 * HTTP 403s, zero successes — the host blocks us outright. It cost ~1.5s of
 * guaranteed failure at the head of every Instagram scrape, creator and brand
 * alike, and its only other role was donating follower counts to a merge that
 * therefore never fired.
 *
 * Playwright was already the PRIMARY post source and never conditional on it,
 * so removing the probe changes what is GATHERED not at all — only how long it
 * takes to start gathering.
 */
// ─── Leg C: profile_rendered_text ────────────────────────────────────────────
//
// THE BASE FIELDS ARE ON THE PAGE, AND NOTHING WAS READING THEM.
//
// Instagram renders followers, following, display name and bio as ordinary
// text to a clean anonymous context. The two Playwright legs above load that
// exact page and then look only at GraphQL/XHR payloads and og: meta — so a
// creator whose GraphQL nodes carry no counts banks follower_count 0, and 0
// becomes NULL at persist. Three creators in the corpus read "no followers"
// for a page that says "2M followers" in plain text.
//
// WHY NOT A SCREENSHOT AND A VISION MODEL. That was the proposal this leg
// replaced, and it was measured: ~$0.00035 and ~7s per profile to return the
// SAME displayed strings this reads for free — "268M", "2M", "194", "626" —
// because a vision model reading a rendered page and innerText of the same
// rendered page are reading the identical characters. It also would not have
// helped with the posts count, which is not drawn on the anonymous mobile
// header at all: a screenshot cannot recover what the page never renders.
//
// WHEN VISION WOULD EARN ITS COST: if Instagram ever paints these counts into
// a canvas, an <img>, or otherwise removes them from the text layer, this leg
// starts returning `no_counts` on a page that visibly HAS them — and at that
// point the screenshot leg becomes the only way to read them and is worth
// every cent. `no_counts` exists partly to make that day obvious.
//
// PRECISION IS DISPLAY PRECISION. "268M" is 268,937,250. Roughly +/-0.5%,
// which is adequate for archetype and audience reasoning and wrong for
// anything implying exactness. The raw string travels with the number so a
// reader can always see what was actually on the page.

export type BaseFieldOutcome = "success" | "no_render" | "no_counts" | "blocked";

export interface BaseFieldAttempt {
  strategy: string;
  outcome: BaseFieldOutcome;
  durationMs: number;
  fields: RenderedBaseFields | null;
  detail?: string;
}

/** Budget for the rendered read. One navigation plus a settle wait. */
const RENDERED_TEXT_BUDGET_MS = 35_000;
/** How long the header needs to paint after domcontentloaded. */
const RENDER_SETTLE_MS = 4_000;

/**
 * Parse the profile header out of rendered text.
 *
 * The header is a flat run of lines — handle, count, label, count, label — so
 * the count is the line BEFORE its label. Matching that way rather than with a
 * single greedy regex keeps a bio containing the word "followers" from being
 * read as a count.
 *
 * Exported for the harness: this is the whole extraction and it is worth
 * pinning directly rather than inferring it from a live page.
 */
export function parseRenderedHeader(innerText: string): {
  followersRaw: string | null; followingRaw: string | null;
} {
  const lines = innerText.split("\n").map(l => l.trim());
  const COUNT = /^[\d.,]+\s*[KMB]?$/i;
  let followersRaw: string | null = null;
  let followingRaw: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const label = lines[i]!.toLowerCase();
    const prev = lines[i - 1]!;
    if (!COUNT.test(prev)) continue;
    if (label === "followers" && followersRaw === null) followersRaw = prev;
    if (label === "following" && followingRaw === null) followingRaw = prev;
  }
  return { followersRaw, followingRaw };
}

/** The posts count from og:description — the render omits it, the tag has it. */
export function parsePostsFromMetaDescription(description: string): string | null {
  return (description.match(/([\d,.]+\s*[KkMmBb]?)\s*Posts/i) || [])[1]?.trim() ?? null;
}

/**
 * Read base fields off the rendered profile page. Individually instrumented
 * and individually budgeted, per the transcriptStrategies pattern.
 *
 * NOTHING IS PERSISTED beyond the parsed values: no screenshot is taken, no
 * image exists at any point, and the page is discarded with its context.
 */
export async function attemptRenderedTextBaseFields(handle: string): Promise<BaseFieldAttempt> {
  const started = Date.now();
  const strategy = "profile_rendered_text";
  const url = `https://www.instagram.com/${handle}/`;
  let ctx: Awaited<ReturnType<typeof getContext>> | null = null;
  let navStatus: number | undefined;

  const record = (outcome: BaseFieldOutcome, fields: RenderedBaseFields | null, detail?: string): BaseFieldAttempt => {
    const durationMs = Date.now() - started;
    recordScrapeEvent({
      platform: "instagram",
      scrapeMethod: "instagram_playwright",
      urlRequested: `${url}#base=${strategy}:${outcome}`,
      httpStatus: navStatus,
      silentFailureDetected: outcome === "no_counts",
      failureReason: outcome === "success" ? undefined : `base ${strategy}: ${outcome}${detail ? ` — ${detail}` : ""}`,
      durationMs,
    });
    return { strategy, outcome, durationMs, fields, detail };
  };

  try {
    await requestGovernor("instagram");
    ctx = await getContext("mobile-ios", 1);
    const { page } = ctx;
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: RENDERED_TEXT_BUDGET_MS });
    navStatus = resp?.status();
    if (navStatus && navStatus >= 400) {
      return record("blocked", null, `HTTP ${navStatus}`);
    }
    await page.waitForTimeout(RENDER_SETTLE_MS);

    // String-form evaluate deliberately: a function argument is instrumented by
    // the bundler and arrives in the page as `__name is not defined`.
    const innerText = (await page.evaluate("document.body.innerText")) as string | null;
    if (!innerText || innerText.length < 20) {
      return record("no_render", null, `body text ${innerText?.length ?? 0} chars`);
    }

    const { followersRaw, followingRaw } = parseRenderedHeader(innerText);
    const description = (await page.evaluate(
      "(document.querySelector('meta[property=\"og:description\"]')||{}).content || ''",
    )) as string;
    const postsRaw = parsePostsFromMetaDescription(description || "");

    if (followersRaw === null && followingRaw === null) {
      // The page rendered and the header did not. This is a SHAPE change, not
      // a block, and it is the outcome that matters for future drift.
      return record("no_counts", null, `rendered ${innerText.length} chars, no follower/following pair`);
    }

    const fields: RenderedBaseFields = {
      strategy,
      precision: "display",
      followersRaw, followingRaw, postsRaw,
      followers: followersRaw === null ? null : parseHumanCount(followersRaw),
      following: followingRaw === null ? null : parseHumanCount(followingRaw),
      posts: postsRaw === null ? null : parseHumanCount(postsRaw),
    };
    console.log(
      `[instagramScraper] @${handle}: ${strategy} read followers="${followersRaw}"->${fields.followers}, ` +
      `following="${followingRaw}"->${fields.following}, posts="${postsRaw}"->${fields.posts} (display precision)`,
    );
    return record("success", fields);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    return record(/timeout|timed out/i.test(msg) ? "no_render" : "blocked", null, msg.slice(0, 140));
  } finally {
    if (ctx) await retireContext(ctx.context).catch(() => {});
  }
}

/**
 * Fill base fields from the rendered page when the structured legs did not.
 *
 * PLACED LAST DELIBERATELY. The GraphQL/XHR legs are cheaper when they work
 * and they carry EXACT counts; this one costs a second navigation and returns
 * display precision. It runs only when the cheap legs left the counts at zero,
 * so a healthy capture never pays for it and never loses precision to it.
 */
async function supplementBaseFields(
  handle: string,
  result: InstagramScrapedProfile,
): Promise<InstagramScrapedProfile> {
  if (result.profile.follower_count > 0) return result;

  console.log(`[instagramScraper] @${handle}: base fields absent after structured legs — trying profile_rendered_text`);
  const attempt = await attemptRenderedTextBaseFields(handle);
  if (attempt.outcome !== "success" || !attempt.fields) {
    console.warn(`[instagramScraper] @${handle}: profile_rendered_text ${attempt.outcome}${attempt.detail ? ` — ${attempt.detail}` : ""}`);
    return result;
  }

  const f = attempt.fields;
  // Only FILL, never overwrite: a structured read that produced a real number
  // is exact and outranks a displayed one.
  if (result.profile.follower_count <= 0 && f.followers != null) result.profile.follower_count = f.followers;
  if (result.profile.following_count <= 0 && f.following != null) result.profile.following_count = f.following;
  if (result.profile.media_count <= 0 && f.posts != null) result.profile.media_count = f.posts;
  result.baseFieldRead = f;
  result.source = `${result.source}+${f.strategy}`;
  return result;
}

export async function scrapeInstagramProfile(handle: string): Promise<InstagramScrapedProfile> {
  // ── Phase 1: Playwright mobile — the primary path ──
  console.log(`[instagramScraper] @${handle}: Phase 1 — Playwright for profile and posts`);
  const playwrightResult = await scrapeViaPlaywright(handle);

  if (playwrightResult) {
    const postCount = playwrightResult.posts.length;
    console.log(`[instagramScraper] @${handle}: Phase 2 — Playwright mobile got ${postCount} posts`);

    // If Playwright got both profile + posts, return it
    if (postCount > 0 || playwrightResult.profile.follower_count > 0 || playwrightResult.profile.biography.length > 0) {
      // Supplement with shortcode extraction if posts still low
      if (postCount === 0) {
        const supplementedPosts = await extractAndSupplementPosts(handle);
        if (supplementedPosts.length > 0) {
          playwrightResult.posts = supplementedPosts;
          playwrightResult.source = `${playwrightResult.source}+oembed-posts`;
          return supplementBaseFields(handle, playwrightResult);
        }

        // If still 0 posts, try desktop Playwright before giving up
        console.log(`[instagramScraper] @${handle}: mobile got profile but 0 posts — trying desktop for posts`);
        const desktopForPosts = await scrapeViaPlaywrightDesktop(handle);
        if (desktopForPosts && desktopForPosts.posts.length > 0) {
          console.log(`[instagramScraper] @${handle}: desktop got ${desktopForPosts.posts.length} posts — merging`);
          playwrightResult.posts = desktopForPosts.posts;
          playwrightResult.source = `${playwrightResult.source}+desktop-posts`;
          playwrightResult.confidence = desktopForPosts.posts.length >= 6 ? "high" : "medium";
          return supplementBaseFields(handle, playwrightResult);
        }
      }
      return supplementBaseFields(handle, playwrightResult);
    }
  }

  // ── Phase 2: Desktop fallback if mobile failed ──
  console.log(`[instagramScraper] @${handle}: Phase 2 — trying desktop Playwright`);
  const desktopResult = await scrapeViaPlaywrightDesktop(handle);
  if (desktopResult && (desktopResult.posts.length > 0 || desktopResult.profile.follower_count > 0)) {
    return supplementBaseFields(handle, desktopResult);
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

/**
 * Merge two GraphQL user nodes: first-seen wins per field, later nodes fill
 * only what is MISSING. Exported for tests.
 *
 * Deliberately shallow and additive — a later node can never overwrite a value
 * already captured (the first response is closest to the profile navigation),
 * it can only supply fields the first one lacked, which is exactly the
 * media_count/edge_owner_to_timeline_media case that left every Instagram
 * creator's posts count unknown.
 */
export function mergeUserNodes(
  base: Record<string, unknown> | null,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  if (!base) return incoming;
  let changed = false;
  const merged: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(incoming)) {
    if (merged[k] === undefined || merged[k] === null) {
      merged[k] = v;
      changed = true;
    }
  }
  // Referential stability when nothing was added, so callers can log honestly.
  return changed ? merged : base;
}

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
