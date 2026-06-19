/**
 * Review Research Layer — Phase 2
 *
 * Fetches audience perception data from Google Maps and Yelp via Playwright scraping.
 * No API keys required — both sources are scraped from public web pages.
 *
 * Pipeline:
 *   1. Google Maps: Playwright scrapes public place page from user-provided URL
 *   2. Yelp: Playwright searches and scrapes business page (best-effort, DataDome may block)
 *   3. Fallback: Google Maps Places API if no URL provided and API key is configured
 *   4. Combine into a structured AudiencePerceptionResult
 *   5. Format into an evidence block for the brand AI extraction prompt
 */

import { makeRequest, PlacesSearchResult, PlaceDetailsResult } from "./_core/map";
import { insertScrapeEvent } from "./db";
import { fetchHtml } from "./scraping/httpClient";
import { getContext, retireContext } from "./scraping/browserClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReviewEntry {
  author: string;
  rating: number;
  text: string;
  date?: string;
}

export interface ReviewSource {
  platform: "Yelp" | "Google Maps";
  rating: number | null;
  reviewCount: number | null;
  listingUrl: string;
  reviews: ReviewEntry[];
}

export interface AudiencePerceptionResult {
  sources: ReviewSource[];
  combinedReviewText: string;   // All review text concatenated for AI analysis
  overallRating: number | null; // Weighted average across sources
  totalReviews: number;
  audiencePerceptionBlock: string; // Formatted evidence block for AI prompt
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract city/location hint from a website URL or brand name */
function extractCityHint(websiteUrl: string, brandName: string): string {
  // Major North American cities — covers most use cases
  const hints: Record<string, string> = {
    // Canada
    "toronto": "Toronto, ON", "mississauga": "Mississauga, ON", "brampton": "Brampton, ON",
    "richmond hill": "Richmond Hill, ON", "markham": "Markham, ON", "scarborough": "Scarborough, ON",
    "north york": "North York, ON", "etobicoke": "Etobicoke, ON", "oakville": "Oakville, ON",
    "hamilton": "Hamilton, ON", "ottawa": "Ottawa, ON", "london": "London, ON",
    "kitchener": "Kitchener, ON", "waterloo": "Waterloo, ON", "windsor": "Windsor, ON",
    "vancouver": "Vancouver, BC", "burnaby": "Burnaby, BC", "surrey": "Surrey, BC",
    "victoria": "Victoria, BC", "kelowna": "Kelowna, BC",
    "montreal": "Montreal, QC", "quebec city": "Quebec City, QC", "laval": "Laval, QC",
    "calgary": "Calgary, AB", "edmonton": "Edmonton, AB",
    "winnipeg": "Winnipeg, MB", "saskatoon": "Saskatoon, SK", "regina": "Regina, SK",
    "halifax": "Halifax, NS", "st. john's": "St. John's, NL",
    // United States
    "new york": "New York, NY", "nyc": "New York, NY", "manhattan": "New York, NY",
    "brooklyn": "Brooklyn, NY", "queens": "Queens, NY",
    "los angeles": "Los Angeles, CA", "san francisco": "San Francisco, CA",
    "san diego": "San Diego, CA", "san jose": "San Jose, CA",
    "chicago": "Chicago, IL", "houston": "Houston, TX", "dallas": "Dallas, TX",
    "austin": "Austin, TX", "phoenix": "Phoenix, AZ", "seattle": "Seattle, WA",
    "portland": "Portland, OR", "denver": "Denver, CO", "boston": "Boston, MA",
    "miami": "Miami, FL", "tampa": "Tampa, FL", "orlando": "Orlando, FL",
    "atlanta": "Atlanta, GA", "nashville": "Nashville, TN", "charlotte": "Charlotte, NC",
    "philadelphia": "Philadelphia, PA", "washington dc": "Washington, DC",
    "detroit": "Detroit, MI", "minneapolis": "Minneapolis, MN",
    "las vegas": "Las Vegas, NV", "salt lake city": "Salt Lake City, UT",
  };
  const combined = `${websiteUrl} ${brandName}`.toLowerCase();
  for (const [key, val] of Object.entries(hints)) {
    if (combined.includes(key)) return val;
  }
  return "";
}

/** Strip HTML tags from a string */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Parse Yelp review page HTML to extract reviews */
function parseYelpReviews(html: string): ReviewEntry[] {
  const reviews: ReviewEntry[] = [];

  // Yelp embeds review data in a JSON blob: window.__YELP_INITIAL_STATE__
  const jsonMatch = html.match(/window\.__YELP_INITIAL_STATE__\s*=\s*({[\s\S]+?});\s*<\/script>/) ??
                    html.match(/"reviewFeedQueryProps":\s*({[\s\S]+?"reviews":\s*\[[\s\S]+?\]})/);

  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      // Navigate the nested structure
      const reviewList =
        data?.reviewFeedQueryProps?.reviews ??
        data?.reviews ??
        [];
      for (const r of reviewList.slice(0, 10)) {
        const text = r?.comment?.text ?? r?.text ?? "";
        const rating = r?.rating ?? r?.bizUserPublicRecommendation?.rating ?? null;
        const author = r?.user?.markupDisplayName ?? r?.user?.displayName ?? "Reviewer";
        const date = r?.localizedDate ?? r?.date ?? "";
        if (text.length > 20) {
          reviews.push({ author, rating: Number(rating) || 0, text: stripHtml(text), date });
        }
      }
    } catch {
      // JSON parse failed — fall through to regex extraction
    }
  }

  // Fallback: regex extraction from rendered HTML
  if (reviews.length === 0) {
    // Match review paragraphs — Yelp renders them as <p> inside review containers
    const paragraphs = html.match(/<p class="[^"]*comment[^"]*"[^>]*>([\s\S]{30,800}?)<\/p>/gi) ?? [];
    for (const p of paragraphs.slice(0, 10)) {
      const text = stripHtml(p);
      if (text.length > 30) {
        reviews.push({ author: "Reviewer", rating: 0, text });
      }
    }
  }

  return reviews;
}

/** Parse Yelp page for overall rating and review count */
function parseYelpMeta(html: string): { rating: number | null; reviewCount: number | null } {
  const ratingMatch = html.match(/itemprop="ratingValue"\s+content="([\d.]+)"/i) ??
                      html.match(/"ratingValue"\s*:\s*"?([\d.]+)"?/i) ??
                      html.match(/([\d.]+)\s*\(\d+\s*reviews?\)/i);
  const countMatch = html.match(/itemprop="reviewCount"\s+content="(\d+)"/i) ??
                     html.match(/"reviewCount"\s*:\s*"?(\d+)"?/i) ??
                     html.match(/(\d+)\s+reviews?/i);

  return {
    rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
    reviewCount: countMatch ? parseInt(countMatch[1], 10) : null,
  };
}

// ─── Google Maps Playwright Scraper ──────────────────────────────────────────

/** Convert relative time strings ("3 weeks ago", "2 months ago") to approximate YYYY-MM */
function relativeTimeToDate(relative: string): string {
  const now = new Date();
  const match = relative.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!match) return "";
  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const ms: Record<string, number> = {
    second: 1000, minute: 60_000, hour: 3_600_000,
    day: 86_400_000, week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000,
  };
  const target = new Date(now.getTime() - amount * (ms[unit] ?? 0));
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
}

/** Parse review count text: "1,234 reviews" → 1234, "4.2K reviews" → 4200 */
function parseReviewCount(text: string): number | null {
  const match = text.match(/([\d,.]+)\s*K?\s*review/i);
  if (!match) return null;
  const raw = match[0];
  if (raw.toUpperCase().includes("K")) {
    const num = parseFloat(match[1].replace(/,/g, ""));
    return Math.round(num * 1000);
  }
  return parseInt(match[1].replace(/,/g, ""), 10) || null;
}

/**
 * Extract place metadata from a Google Maps URL via direct HTTP fetch.
 *
 * Google Maps blocks Playwright (headless and headed) from rendering place content —
 * the SPA shell loads but rating/reviews never hydrate. Instead, we:
 * 1. HTTP-fetch the Maps URL to get the APP_INITIALIZATION_STATE
 * 2. Parse the embedded protobuf data for place name and feature ID
 * 3. Fall back to parsing the URL path for the place name
 *
 * Rating and individual reviews CANNOT be extracted without the Google Maps API key.
 * When no API key is available, this function returns the place name and listing URL
 * so that the Yelp scraper can use the correct business name.
 */
export async function scrapeGoogleMapsFromUrl(googleMapsUrl: string): Promise<ReviewSource & { address?: string; placeName?: string } | null> {
  console.log(`[googleMaps] Fetching metadata from URL: ${googleMapsUrl}`);

  try {
    // Step 1: Fetch the Maps page HTML
    const response = await fetch(googleMapsUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`[googleMaps] HTTP ${response.status} for Maps URL`);
      return null;
    }

    const html = await response.text();
    let placeName = "";
    let featureId = "";

    // Step 2: Parse APP_INITIALIZATION_STATE for place name
    const appInitMatch = html.match(/window\.APP_INITIALIZATION_STATE\s*=\s*(\[[\s\S]*?\]);/);
    if (appInitMatch) {
      try {
        const initData = JSON.parse(appInitMatch[1]);
        // The place data is in a nested protobuf string inside element [3]
        const innerStr = findProtobufString(initData);
        if (innerStr) {
          const cleaned = innerStr.replace(/^\)\]\}'\n?/, "");
          try {
            const parsed = JSON.parse(cleaned);
            // parsed[0][1] = place name, parsed[0][0] = feature ID
            placeName = parsed?.[0]?.[1] ?? "";
            featureId = parsed?.[0]?.[0] ?? "";
            if (placeName) {
              console.log(`[googleMaps] Extracted place name from HTML: "${placeName}"`);
            }
          } catch { /* inner parse failed */ }
        }
      } catch { /* APP_INITIALIZATION_STATE parse failed */ }
    }

    // Step 3: Fallback — extract place name from URL path
    if (!placeName) {
      const urlNameMatch = googleMapsUrl.match(/\/place\/([^/@]+)/i);
      if (urlNameMatch) {
        placeName = decodeURIComponent(urlNameMatch[1].replace(/\+/g, " "));
        console.log(`[googleMaps] Extracted place name from URL path: "${placeName}"`);
      }
    }

    if (!placeName) {
      console.warn("[googleMaps] Could not extract place name from URL or HTML");
      return null;
    }

    console.log(
      `[googleMaps] Place: "${placeName}"` +
      (featureId ? `, feature_id: ${featureId}` : "") +
      " (rating/reviews require API key)"
    );

    return {
      platform: "Google Maps" as const,
      rating: null,
      reviewCount: null,
      listingUrl: googleMapsUrl,
      reviews: [],
      address: "",
      placeName,
    };
  } catch (err) {
    console.warn("[googleMaps] HTTP fetch failed:", (err as Error).message);
    return null;
  }
}

/** Recursively search nested arrays for a string starting with ")]}'" (protobuf data) */
function findProtobufString(data: unknown): string | null {
  if (typeof data === "string" && data.startsWith(")]}")) return data;
  if (Array.isArray(data)) {
    for (const item of data) {
      const result = findProtobufString(item);
      if (result) return result;
    }
  }
  return null;
}

// ─── Yelp Playwright Scraper ─────────────────────────────────────────────────

/** Extract city from a formatted address (e.g. "241 Spadina Ave, Toronto, ON M5T 3A8, Canada" → "Toronto") */
function extractCityFromAddress(address: string): string {
  const parts = address.split(",").map(p => p.trim());
  // Typically: Street, City, Province/PostalCode, Country
  if (parts.length >= 3) {
    // Second part is usually the city
    return parts[1];
  }
  if (parts.length === 2) {
    return parts[0]; // Just street and city
  }
  return "";
}

/**
 * Scrape Yelp business reviews via Playwright.
 * Best-effort — DataDome anti-bot protection may block the request.
 */
export async function scrapeYelpReviews(brandName: string, cityHint: string): Promise<ReviewSource | null> {
  const searchLoc = cityHint || "Canada";
  console.log(`[yelp] Scraping: ${brandName} in ${searchLoc}`);
  const { context, page } = await getContext("desktop-chrome", 1);
  try {
    // Step 1: Search Yelp for the business
    const searchUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(brandName)}&find_loc=${encodeURIComponent(searchLoc)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);

    // Check for DataDome block
    const pageTitle = await page.title();
    const bodySnippet = await page.evaluate(() => document.body.innerText.slice(0, 500));
    if (
      pageTitle === "Access Denied" ||
      bodySnippet.includes("verify you are a human") ||
      bodySnippet.toLowerCase().includes("datadome") ||
      bodySnippet.includes("are you a robot")
    ) {
      console.warn(`[yelp] Blocked by anti-bot protection for ${brandName}`);
      return null;
    }

    // Step 2: Find the first non-ad business result link
    const bizUrl = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/biz/"]'));
      for (const link of links) {
        const href = (link as HTMLAnchorElement).href;
        // Skip sponsored results
        const card = link.closest('[data-testid], [class*="container"]');
        if (card?.textContent?.includes("Sponsored") || card?.textContent?.includes("Ad")) continue;
        if (href.includes("/biz/") && !href.includes("/biz_photos/")) {
          // Return absolute URL
          return href.startsWith("http") ? href : `https://www.yelp.com${href}`;
        }
      }
      return null;
    });

    if (!bizUrl) {
      console.warn(`[yelp] No business results found for "${brandName}" in ${searchLoc}`);
      return null;
    }

    // Step 3: Navigate to the business page
    await page.goto(bizUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);

    // Re-check for DataDome on business page
    const bizTitle = await page.title();
    if (bizTitle === "Access Denied") {
      console.warn(`[yelp] Blocked by anti-bot on business page for ${brandName}`);
      return null;
    }

    // Step 4: Extract business data and reviews
    const yelpData = await page.evaluate(() => {
      // Business name
      const h1 = document.querySelector('h1');
      const name = h1?.textContent?.trim() ?? "";

      // Rating from aria-label
      let rating: number | null = null;
      const ratingEls = Array.from(document.querySelectorAll('[aria-label*="star rating"], [aria-label*="star"]'));
      for (const el of ratingEls) {
        const label = el.getAttribute("aria-label") ?? "";
        const m = label.match(/(\d+\.?\d*)\s*star/i);
        if (m) { rating = parseFloat(m[1]); break; }
      }

      // Review count
      let reviewCount: number | null = null;
      const bodyText = document.body.innerText;
      const countMatch = bodyText.match(/([\d,]+)\s+reviews?/i);
      if (countMatch) {
        reviewCount = parseInt(countMatch[1].replace(/,/g, ""), 10) || null;
      }

      // Extract individual reviews (first page only)
      const reviews: Array<{ author: string; rating: number; text: string; date: string }> = [];

      // Yelp review containers
      const reviewCards = Array.from(document.querySelectorAll(
        '[class*="review__"], [data-testid*="review"], li[class*="margin-b"], #reviews > section > div > div > div > ul > li'
      ));

      for (const card of reviewCards) {
        if (reviews.length >= 15) break;

        // Star rating
        let stars = 0;
        const starEl = card.querySelector('[aria-label*="star"]');
        if (starEl) {
          const m = starEl.getAttribute("aria-label")?.match(/(\d)/);
          if (m) stars = parseInt(m[1], 10);
        }

        // Review text — look for paragraph or span with substantial text
        let text = "";
        const paragraphs = Array.from(card.querySelectorAll('p, span[lang], [class*="comment"]'));
        for (const p of paragraphs) {
          const t = p.textContent?.trim() ?? "";
          if (t.length > text.length && t.length > 30) text = t;
        }

        // Date
        const dateEl = card.querySelector('span[class*="date"], [class*="css-"]');
        const dateText = dateEl?.textContent?.trim() ?? "";

        if (text.length > 20) {
          reviews.push({ author: "Yelp Reviewer", rating: stars, text, date: dateText });
        }
      }

      return { name, rating, reviewCount, reviews };
    });

    if (!yelpData.name && !yelpData.rating) {
      console.warn(`[yelp] Could not extract business data from ${bizUrl}`);
      return null;
    }

    // P0-2: Validate business name matches the brand being searched
    // Prevents wrong-business reviews from contaminating the analysis
    if (yelpData.name && !nameSimilar(yelpData.name, brandName)) {
      console.warn(`[yelp] Business name mismatch: found "${yelpData.name}" for brand "${brandName}" — skipping`);
      return null;
    }

    console.log(
      `[yelp] Scraped: ${yelpData.rating}★, ${yelpData.reviewCount} reviews, ` +
      `${yelpData.reviews.length} review texts extracted`
    );

    return {
      platform: "Yelp" as const,
      rating: yelpData.rating,
      reviewCount: yelpData.reviewCount,
      listingUrl: bizUrl,
      reviews: yelpData.reviews,
    };
  } catch (err) {
    console.warn("[yelp] Playwright scrape failed:", (err as Error).message);
    return null;
  } finally {
    await retireContext(context);
  }
}

// ─── Place Name Matching ──────────────────────────────────────────────────────

/** Compute normalized Levenshtein distance (0 = identical, 1 = completely different) */
function levenshteinNormalized(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0 && n === 0) return 0;
  if (m === 0 || n === 0) return 1;
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [];
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n] / Math.max(m, n);
}

/** Check if two names refer to the same business (substring match or edit distance) */
function nameSimilar(a: string, b: string): boolean {
  const al = a.toLowerCase().trim();
  const bl = b.toLowerCase().trim();
  return al.includes(bl) || bl.includes(al) || levenshteinNormalized(al, bl) < 0.4;
}

// ─── Google Maps URL Parsing ─────────────────────────────────────────────────

/**
 * Extract a Google Maps place_id from a URL.
 *
 * Handles:
 *   Format 1: https://maps.google.com/?place_id=ChIJ...
 *   Format 2: https://www.google.com/maps/place/Name/@lat,lng/data=!4m...!1sChIJ...
 *   Format 3: https://goo.gl/maps/... or https://maps.app.goo.gl/... (short URLs → follow redirect)
 */
export async function extractPlaceIdFromUrl(url: string): Promise<string | null> {
  try {
    // Format 1: place_id as query parameter
    const parsed = new URL(url);
    const qpPlaceId = parsed.searchParams.get("place_id");
    if (qpPlaceId && qpPlaceId.startsWith("ChIJ")) {
      return qpPlaceId;
    }

    // Format 2: place_id in /data= segment  (!1sChIJ...)
    const dataMatch = url.match(/!1s(ChIJ[^!&]+)/);
    if (dataMatch) {
      return dataMatch[1];
    }

    // Format 3: short URL — follow redirect to resolved URL
    if (url.includes("goo.gl/maps") || url.includes("maps.app.goo.gl")) {
      try {
        // Use fetchHtml with a HEAD-like approach: fetch the page and extract redirect target
        const html = await fetchHtml(url, { maxRetries: 1 });
        // After redirect, the final URL may be embedded in the HTML or meta refresh
        const metaRefresh = html.match(/url=([^"']+)/i);
        const resolvedUrl = metaRefresh?.[1] ?? "";

        // Try Format 1 on resolved URL
        if (resolvedUrl) {
          const resolvedParsed = new URL(resolvedUrl);
          const resolvedQp = resolvedParsed.searchParams.get("place_id");
          if (resolvedQp && resolvedQp.startsWith("ChIJ")) return resolvedQp;

          // Try Format 2 on resolved URL
          const resolvedData = resolvedUrl.match(/!1s(ChIJ[^!&]+)/);
          if (resolvedData) return resolvedData[1];
        }

        // Also try Format 2 on the full HTML (Google embeds the place_id in JS)
        const htmlData = html.match(/!1s(ChIJ[^!&"']+)/);
        if (htmlData) return htmlData[1];
      } catch {
        // Short URL resolution failed — fall through
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Google Maps Reviews (top 50) ────────────────────────────────────────────

/**
 * Fetch up to 50 Google Maps reviews for a brand.
 * The Places API returns up to 5 reviews per details call; we use the
 * `sort_by=newest` parameter to get the most recent and most diverse set.
 * We make multiple calls with different sort orders to maximize coverage.
 */
async function fetchGoogleMapsReviews(brandName: string, cityHint: string, directPlaceId?: string): Promise<ReviewSource | null> {
  try {
    let placeId: string;
    let placeName: string = brandName;
    let placeRating: number | undefined;
    let placeRatingTotal: number | undefined;

    if (directPlaceId) {
      // Direct place_id from URL — skip textsearch entirely
      placeId = directPlaceId;
      console.log(`[googleMaps] Using direct place_id: ${placeId} (skipping textsearch)`);
    } else {
      // Standard path: text search to find the place
      const query = cityHint ? `${brandName} ${cityHint}` : brandName;

    // Step 1: Text search to find the place
    const searchResult = await makeRequest<PlacesSearchResult>(
      "/maps/api/place/textsearch/json",
      { query, fields: "place_id,name,rating,user_ratings_total" }
    );

      if (searchResult.status !== "OK" || !searchResult.results?.length) {
        console.warn("[reviewResearch] Google Maps: no place found for", brandName);
        return null;
      }

      // Verify place name matches brand name (check top 3 results)
      let place: (typeof searchResult.results)[number] | null = null;
      for (const candidate of searchResult.results.slice(0, 3)) {
        if (nameSimilar(brandName, candidate.name)) {
          place = candidate;
          break;
        }
        console.warn(`[googleMaps] Rejected "${candidate.name}" for brand "${brandName}" — name mismatch`);
      }

      if (!place) {
        console.warn(`[reviewResearch] Google Maps: no matching place for "${brandName}" (top 3 results rejected)`);
        return null;
      }

      placeId = place.place_id;
      placeName = place.name;
      placeRating = place.rating;
      placeRatingTotal = place.user_ratings_total;
    }

    // Step 2: Fetch reviews with multiple sort orders to maximize coverage
    // Google Places API returns up to 5 reviews per call
    // We fetch with 3 different sort orders to get up to ~15 unique reviews
    // (the API doesn't support true pagination for reviews)
    const sortOrders = ["most_relevant", "newest", "highest_rating", "lowest_rating"];
    const allReviewsMap = new Map<string, ReviewEntry>(); // deduplicate by author+text key

    for (const sortBy of sortOrders) {
      try {
        const detailsResult = await makeRequest<PlaceDetailsResult>(
          "/maps/api/place/details/json",
          {
            place_id: placeId,
            fields: "name,rating,user_ratings_total,reviews,formatted_address",
            reviews_sort: sortBy,
          }
        );

        if (detailsResult.status !== "OK" || !detailsResult.result) continue;

        const details = detailsResult.result!;
        for (const r of (details.reviews ?? [])) {
          if (!r.text || r.text.length < 20) continue;
          const key = `${r.author_name}:${r.text.slice(0, 50)}`;
          if (!allReviewsMap.has(key)) {
            allReviewsMap.set(key, {
              author: r.author_name,
              rating: r.rating,
              text: r.text,
              date: new Date(r.time * 1000).toLocaleDateString("en-CA"),
            });
          }
        }

        // Small delay between calls
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        console.warn(`[reviewResearch] Google Maps details (${sortBy}) failed:`, err);
      }
    }

    // Get final place details for rating/count
    const finalDetails = await makeRequest<PlaceDetailsResult>(
      "/maps/api/place/details/json",
      { place_id: placeId, fields: "name,rating,user_ratings_total,formatted_address" }
    );

    const reviews = Array.from(allReviewsMap.values()).slice(0, 50);
    console.log(`[reviewResearch] Google Maps: ${reviews.length} unique reviews for ${brandName}`);

    return {
      platform: "Google Maps",
      rating: (finalDetails.result as { rating?: number } | null)?.rating ?? placeRating ?? null,
      reviewCount: (finalDetails.result as { user_ratings_total?: number } | null)?.user_ratings_total ?? placeRatingTotal ?? null,
      listingUrl: `https://www.google.com/maps/place/?q=place_id:${placeId}`,
      reviews,
    };
  } catch (err) {
    console.warn("[reviewResearch] Google Maps fetch failed:", err);
    return null;
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function fetchBrandReviews(
  brandName: string,
  websiteUrl: string,
  googleMapsUrl?: string
): Promise<AudiencePerceptionResult> {
  const cityHint = extractCityHint(websiteUrl, brandName);
  const sources: ReviewSource[] = [];
  let scrapedAddress = "";
  let scrapedPlaceName = brandName;

  // ── Path A: Playwright scraping from Google Maps URL (no API key needed) ──
  if (googleMapsUrl && googleMapsUrl.trim()) {
    // Extract place name from URL as a fallback for Yelp search
    const urlNameMatch = googleMapsUrl.match(/\/place\/([^/@]+)/i);
    if (urlNameMatch) {
      scrapedPlaceName = decodeURIComponent(urlNameMatch[1].replace(/\+/g, ' '));
    }

    try {
      const startTime = Date.now();
      const scrapeResult = await scrapeGoogleMapsFromUrl(googleMapsUrl.trim());
      if (scrapeResult) {
        scrapedAddress = scrapeResult.address ?? "";
        // Use the scraped place name for Yelp search (more accurate than URL/domain)
        scrapedPlaceName = scrapeResult.placeName || scrapedPlaceName || brandName;
        // Only add as a review source if we got rating data
        if (scrapeResult.rating !== null || scrapeResult.reviews.length > 0) {
          // Add Google Maps source (strip address and placeName from ReviewSource)
          const { address: _addr, placeName: _pn, ...googleSource } = scrapeResult;
          sources.push(googleSource);
        }

        // Log scrape event
        try {
          await insertScrapeEvent({
            platform: "google_maps",
            scrapeMethod: "google_maps_http",
            urlRequested: googleMapsUrl.trim().slice(0, 1000),
            httpStatus: 200,
            durationMs: Date.now() - startTime,
          });
        } catch { /* non-fatal */ }
      } else {
        console.warn("[reviewResearch] Google Maps HTTP fetch returned null, falling back to API path");
      }
    } catch (err) {
      console.warn("[reviewResearch] Google Maps HTTP fetch failed, falling back to API path:", (err as Error).message);
    }
  }

  // ── Path B: API fallback (when no URL provided or scrape failed) ──
  if (sources.length === 0) {
    // Try extracting place_id from URL for API path
    let directPlaceId: string | null = null;
    if (googleMapsUrl && googleMapsUrl.trim()) {
      directPlaceId = await extractPlaceIdFromUrl(googleMapsUrl.trim());
      if (directPlaceId) {
        console.log(`[googleMaps] Extracted place_id from URL: ${directPlaceId}`);
      }
    }

    try {
      const startTime = Date.now();
      const googleResult = await fetchGoogleMapsReviews(brandName, cityHint, directPlaceId ?? undefined);
      if (googleResult) sources.push(googleResult);
      try {
        await insertScrapeEvent({
          platform: "google_maps",
          scrapeMethod: "google_maps_api",
          urlRequested: `Google Maps Places API: ${brandName}`,
          httpStatus: googleResult ? 200 : 404,
          durationMs: Date.now() - startTime,
        });
      } catch { /* non-fatal */ }
    } catch (err) {
      console.warn("[reviewResearch] Google Maps API fetch failed (non-fatal):", err);
    }
  }

  // ── Yelp scraping (best-effort, after Google Maps) ──
  try {
    const yelpCity = scrapedAddress
      ? extractCityFromAddress(scrapedAddress)
      : cityHint;
    const yelpResult = await scrapeYelpReviews(scrapedPlaceName, yelpCity);
    if (yelpResult) sources.push(yelpResult);
  } catch (err) {
    console.warn("[reviewResearch] Yelp scrape failed (non-fatal):", (err as Error).message);
  }

  // Combine all review text
  const allReviews: ReviewEntry[] = sources.flatMap(s => s.reviews);
  const combinedReviewText = allReviews.map(r =>
    `[${r.rating > 0 ? `${r.rating}★` : "?★"}] ${r.author}: "${r.text}"`
  ).join("\n\n");

  // Compute overall rating
  const ratingSources = sources.filter(s => s.rating !== null);
  const overallRating = ratingSources.length > 0
    ? ratingSources.reduce((sum, s) => sum + (s.rating ?? 0), 0) / ratingSources.length
    : null;

  const totalReviews = sources.reduce((sum, s) => sum + (s.reviewCount ?? 0), 0);

  // Format the evidence block
  const audiencePerceptionBlock = formatAudiencePerceptionBlock(sources, allReviews, overallRating, totalReviews);

  return { sources, combinedReviewText, overallRating, totalReviews, audiencePerceptionBlock };
}

function formatAudiencePerceptionBlock(
  sources: ReviewSource[],
  allReviews: ReviewEntry[],
  overallRating: number | null,
  totalReviews: number
): string {
  if (sources.length === 0 || allReviews.length === 0) return "";

  const lines: string[] = [
    "AUDIENCE PERCEPTION — REVIEW DATA (Google Maps + Yelp)",
    "=======================================================",
    `Sources: ${sources.map(s => `${s.platform} (${s.reviewCount ?? "?"} total reviews on platform, ${s.reviews.length} ingested)`).join(" | ")}`,
    overallRating ? `Combined Rating: ${overallRating.toFixed(1)} / 5.0 from ${totalReviews} total reviews` : "",
    "",
    `WHAT CUSTOMERS ACTUALLY SAY (${allReviews.length} reviews ingested):`,
    "----------------------------",
  ];

  // Show up to 50 reviews (the full ingested set)
  for (const review of allReviews.slice(0, 50)) {
    lines.push(`[${review.rating > 0 ? `${review.rating}\u2605` : "?"}] ${review.author}${review.date ? ` (${review.date})` : ""}:`);
    lines.push(`  "${review.text.slice(0, 400)}"`);
    lines.push("");
  }

  lines.push(
    "INSTRUCTIONS FOR ANALYSIS:",
    "Use the review text above as AUDIENCE PERCEPTION evidence. This is how real customers",
    "decode the brand — not how the brand presents itself. Extract:",
    "  - What symbolic meaning customers assign to this brand (e.g. 'cultural anchor', 'status symbol', 'comfort food')",
    "  - Whether the brand's self-presentation matches how customers actually experience it (Goffman Stage Gap)",
    "  - What emotional drivers bring customers to this brand (belonging, nostalgia, discovery, status)",
    "  - Any in-group vs. out-group decoding split (Stuart Hall) — do different audience segments decode differently?",
    "  - Cultural risks visible in negative reviews (inconsistency, service gaps, unmet expectations)",
  );

  return lines.filter(l => l !== "").join("\n");
}
