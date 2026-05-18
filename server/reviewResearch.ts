/**
 * Review Research Layer
 *
 * Fetches audience perception data from Yelp (web scrape) and Google Maps
 * (Places API) for brand analysis. Review text is the most honest signal of
 * how an audience actually decodes a brand — not how the brand presents itself.
 *
 * Pipeline:
 *   1. Yelp: search for brand listing → scrape review text, rating, count
 *   2. Google Maps: Places text search → getDetails with reviews field
 *   3. Combine into a structured AudiencePerceptionResult
 *   4. Format into an evidence block for the brand AI extraction prompt
 */

import { makeRequest, PlacesSearchResult, PlaceDetailsResult } from "./_core/map";

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
  // Try to infer from common patterns — fallback to empty string
  const hints: Record<string, string> = {
    "toronto": "Toronto, ON",
    "richmond hill": "Richmond Hill, ON",
    "vancouver": "Vancouver, BC",
    "montreal": "Montreal, QC",
    "calgary": "Calgary, AB",
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

// ─── Yelp Scraper ─────────────────────────────────────────────────────────────

async function fetchYelpReviews(brandName: string, cityHint: string): Promise<ReviewSource | null> {
  try {
    const searchQuery = encodeURIComponent(brandName);
    const locationQuery = encodeURIComponent(cityHint || "Canada");

    // Step 1: Search Yelp for the business listing
    const searchUrl = `https://www.yelp.ca/search?find_desc=${searchQuery}&find_loc=${locationQuery}`;
    const searchHtml = await fetchHtmlWithHeaders(searchUrl);

    // Extract the first matching business URL
    const listingMatch = searchHtml.match(/href="(\/biz\/[^"?]+)"/);
    if (!listingMatch) {
      console.warn("[reviewResearch] Yelp: no listing found for", brandName);
      return null;
    }

    const listingPath = listingMatch[1];
    const listingUrl = `https://www.yelp.ca${listingPath}?sort_by=date_desc`;

    // Step 2: Fetch the listing page
    const listingHtml = await fetchHtmlWithHeaders(listingUrl);

    // Step 3: Parse reviews and metadata
    const reviews = parseYelpReviews(listingHtml);
    const { rating, reviewCount } = parseYelpMeta(listingHtml);

    // Fallback: extract visible review text from the markdown-like content
    if (reviews.length === 0) {
      // Try to extract text blocks that look like reviews (sentences > 40 chars)
      const textBlocks = listingHtml
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .split(/\n+/)
        .map(l => l.trim())
        .filter(l => l.length > 60 && l.length < 800 && /[.!?]/.test(l))
        .slice(0, 10);

      for (const text of textBlocks) {
        reviews.push({ author: "Reviewer", rating: 0, text });
      }
    }

    if (reviews.length === 0 && !rating) return null;

    return {
      platform: "Yelp",
      rating,
      reviewCount,
      listingUrl,
      reviews: reviews.slice(0, 8),
    };
  } catch (err) {
    console.warn("[reviewResearch] Yelp fetch failed:", err);
    return null;
  }
}

/** Fetch HTML with browser-like headers to avoid bot blocking */
async function fetchHtmlWithHeaders(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-CA,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

// ─── Google Maps Reviews ──────────────────────────────────────────────────────

async function fetchGoogleMapsReviews(brandName: string, cityHint: string): Promise<ReviewSource | null> {
  try {
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

    const place = searchResult.results[0];
    const placeId = place.place_id;

    // Step 2: Get place details with reviews
    const detailsResult = await makeRequest<PlaceDetailsResult>(
      "/maps/api/place/details/json",
      {
        place_id: placeId,
        fields: "name,rating,user_ratings_total,reviews,formatted_address",
      }
    );

    if (detailsResult.status !== "OK" || !detailsResult.result) {
      return null;
    }

    const details = detailsResult.result;
    const reviews: ReviewEntry[] = (details.reviews ?? []).slice(0, 8).map(r => ({
      author: r.author_name,
      rating: r.rating,
      text: r.text,
      date: new Date(r.time * 1000).toLocaleDateString("en-CA"),
    })).filter(r => r.text.length > 20);

    return {
      platform: "Google Maps",
      rating: details.rating ?? place.rating ?? null,
      reviewCount: details.user_ratings_total ?? place.user_ratings_total ?? null,
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
  websiteUrl: string
): Promise<AudiencePerceptionResult> {
  const cityHint = extractCityHint(websiteUrl, brandName);

  // Run Yelp and Google Maps in parallel
  const [yelpResult, googleResult] = await Promise.allSettled([
    fetchYelpReviews(brandName, cityHint),
    fetchGoogleMapsReviews(brandName, cityHint),
  ]);

  const sources: ReviewSource[] = [];
  if (yelpResult.status === "fulfilled" && yelpResult.value) sources.push(yelpResult.value);
  if (googleResult.status === "fulfilled" && googleResult.value) sources.push(googleResult.value);

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
    "AUDIENCE PERCEPTION — REVIEW DATA",
    "===================================",
    `Sources: ${sources.map(s => `${s.platform} (${s.reviewCount ?? "?"} reviews, ${s.rating ?? "?"}★)`).join(" | ")}`,
    overallRating ? `Combined Rating: ${overallRating.toFixed(1)} / 5.0 from ${totalReviews} total reviews` : "",
    "",
    "WHAT CUSTOMERS ACTUALLY SAY:",
    "----------------------------",
  ];

  for (const review of allReviews.slice(0, 8)) {
    lines.push(`[${review.rating > 0 ? `${review.rating}★` : "?"}] ${review.author}:`);
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
