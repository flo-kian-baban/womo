/**
 * Brand Instagram Analysis
 *
 * Parallel to brandTikTokAnalysis.ts — enriches brand evidence with
 * Instagram channel data when a brand handle is provided.
 *
 * Pipeline:
 *   1. Scrape brand's Instagram profile (bio, followers, posts)
 *   2. Extract post captions and compute engagement rate
 *   3. Run LLM voice analysis on bio + captions (same prompt pattern as TikTok)
 *   4. Format evidence block for insertion into brandEvidenceSummary
 *
 * This is pure data enrichment — no changes to the scoring framework,
 * schema, or anthropological science.
 */

import { invokeLLM } from "./_core/llm";
import { scrapeInstagramProfile } from "./scraping/instagram/profileScraper";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BrandDecodedSymbol {
  phrase: string;
  meaning: string;
  category: "identity_claim" | "status_signal" | "community_reference" | "aspiration_driver";
  source: "caption" | "bio";
}

export interface BrandInstagramMetadata {
  channelHandle: string;
  followerCount?: number;
  followingCount?: number;
  mediaCount?: number;
  engagementRate?: number;
  bio?: string;
  isVerified?: boolean;
  isBusinessAccount?: boolean;
  category?: string;
  brandVoice?: string;
  contentThemes?: string[];
  audienceInteractionStyle?: string;
  videoAnalysisSummary?: string;
  postCaptions?: string[];
  decodedSymbols?: BrandDecodedSymbol[];
  rawKeywords?: string[];
  themeLabels?: string[];
  symbolicVocabulary?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalize Instagram handle input.
 * Accepts: @handle, handle, https://www.instagram.com/handle/, etc.
 * Returns the bare lowercase handle, or null if invalid.
 */
export function extractInstagramHandle(input: string | undefined | null): string | null {
  if (!input || !input.trim()) return null;

  let handle = input.trim();

  // Strip @ prefix
  if (handle.startsWith("@")) {
    handle = handle.slice(1);
  }

  // Extract from full Instagram URL
  if (handle.includes("instagram.com")) {
    const match = handle.match(/instagram\.com\/([a-zA-Z0-9._]+)/);
    if (match) {
      handle = match[1];
    } else {
      return null;
    }
  }

  handle = handle.replace(/\/+$/, "").toLowerCase().trim();

  // Validate: Instagram handles are 1-30 chars, alphanumeric + dots + underscores
  if (!handle || handle.length > 30 || !/^[a-zA-Z0-9._]+$/.test(handle)) {
    return null;
  }

  return handle;
}

// ─── Channel Analysis ─────────────────────────────────────────────────────────

/**
 * Analyzes the brand's own Instagram channel (when handle is provided).
 * Returns brand-authored content signals — mirrors analyzeBrandTikTokChannel().
 */
export async function analyzeBrandInstagramChannel(
  instagramHandle: string | undefined | null
): Promise<BrandInstagramMetadata | null> {
  if (!instagramHandle || instagramHandle.trim() === "") {
    return null;
  }

  const handle = extractInstagramHandle(instagramHandle);
  if (!handle) {
    console.warn("[brandInstagram] Could not extract handle from:", instagramHandle);
    return null;
  }

  try {
    console.info(`[brandInstagram] Scraping @${handle}...`);

    // Step 1: Scrape Instagram profile
    const scrapeResult = await scrapeInstagramProfile(handle);
    if (!scrapeResult || scrapeResult.source === "none") {
      console.warn(`[brandInstagram] Scrape returned no data for @${handle}`);
      return null;
    }

    const { profile, posts } = scrapeResult;

    const followerCount = profile.follower_count || undefined;
    const followingCount = profile.following_count || undefined;
    const mediaCount = profile.media_count || undefined;
    const bio = profile.biography || undefined;
    const isVerified = profile.is_verified || false;
    const isBusinessAccount = profile.is_business_account || false;
    const category = profile.category || undefined;

    console.info(`[brandInstagram] @${handle}: ${followerCount?.toLocaleString() ?? "?"} followers, ${posts.length} posts scraped`);

    // Step 2: Extract post captions
    const postCaptions: string[] = posts
      .slice(0, 12)
      .map(p => p.caption)
      .filter(c => c && c.length > 20);

    console.info(`[brandInstagram] ${posts.length} posts collected, ${postCaptions.length} captions extracted`);

    // Step 3: Compute engagement rate
    let engagementRate: number | undefined;
    if (posts.length > 0 && followerCount && followerCount > 0) {
      let totalEngagement = 0;
      for (const post of posts) {
        totalEngagement += (post.like_count || 0) + (post.comment_count || 0);
      }
      engagementRate = Math.min(
        Math.round(((totalEngagement / (followerCount * posts.length)) * 100) * 100) / 100,
        100
      );
    }

    // Step 4: LLM voice analysis (if we have enough captions + bio)
    let brandVoice: string | undefined;
    let contentThemes: string[] | undefined;
    let audienceInteractionStyle: string | undefined;
    let videoAnalysisSummary: string | undefined;
    let decodedSymbols: BrandDecodedSymbol[] = [];
    let rawKeywords: string[] = [];
    let themeLabels: string[] = [];
    let symbolicVocabulary: string[] = [];

    if (postCaptions.length >= 2 || bio) {
      try {
        const analysisPrompt = `Analyze this brand's Instagram channel to extract cultural and voice signals.

**Channel Handle:** @${handle}
**Bio:** ${bio || "N/A"}
**Owned Post Captions (${postCaptions.length} posts):**
${postCaptions.slice(0, 10).map((c, i) => `${i + 1}. ${c}`).join("\n")}

Extract:
1. Brand Voice (2-4 descriptors)
2. Content Themes (3-5 themes)
3. Audience Interaction Style (1-2 sentences)
4. Overall Analysis (2-3 sentences)
5. Identity Claims (what the brand claims about itself)
6. Status Signals (prestige/positioning)
7. Community References (who they address)
8. Aspiration Drivers (what they promise)
9. Raw Keywords (15-20 key words)
10. Theme Labels (3-5 named themes)
11. Symbolic Vocabulary (5-8 core values)

Return JSON:
{
  "brandVoice": "descriptors",
  "contentThemes": ["theme1"],
  "audienceInteractionStyle": "description",
  "summary": "analysis",
  "identityClaims": [{"phrase": "...", "meaning": "..."}],
  "statusSignals": [{"phrase": "...", "meaning": "..."}],
  "communityReferences": [{"phrase": "...", "meaning": "..."}],
  "aspirationDrivers": [{"phrase": "...", "meaning": "..."}],
  "rawKeywords": ["keyword1"],
  "themeLabels": ["theme1"],
  "symbolicVocabulary": ["value1"]
}`;

        const response = await invokeLLM({
          purpose: "brand_instagram_voice_analysis",
          messages: [
            {
              role: "system",
              content: "You are a cultural analyst specializing in brand voice and social media positioning.",
            },
            { role: "user", content: analysisPrompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "brand_instagram_voice_analysis",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  brandVoice: { type: "string" },
                  contentThemes: { type: "array", items: { type: "string" } },
                  audienceInteractionStyle: { type: "string" },
                  summary: { type: "string" },
                  identityClaims: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { phrase: { type: "string" }, meaning: { type: "string" } },
                      required: ["phrase", "meaning"],
                      additionalProperties: false,
                    },
                  },
                  statusSignals: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { phrase: { type: "string" }, meaning: { type: "string" } },
                      required: ["phrase", "meaning"],
                      additionalProperties: false,
                    },
                  },
                  communityReferences: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { phrase: { type: "string" }, meaning: { type: "string" } },
                      required: ["phrase", "meaning"],
                      additionalProperties: false,
                    },
                  },
                  aspirationDrivers: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { phrase: { type: "string" }, meaning: { type: "string" } },
                      required: ["phrase", "meaning"],
                      additionalProperties: false,
                    },
                  },
                  rawKeywords: { type: "array", items: { type: "string" } },
                  themeLabels: { type: "array", items: { type: "string" } },
                  symbolicVocabulary: { type: "array", items: { type: "string" } },
                },
                required: [
                  "brandVoice", "contentThemes", "audienceInteractionStyle", "summary",
                  "identityClaims", "statusSignals", "communityReferences", "aspirationDrivers",
                  "rawKeywords", "themeLabels", "symbolicVocabulary",
                ],
                additionalProperties: false,
              },
            },
          },
        });

        const content = response.choices?.[0]?.message?.content;
        if (content) {
          const parsed = typeof content === "string" ? JSON.parse(content) : content;
          brandVoice = parsed.brandVoice;
          contentThemes = parsed.contentThemes;
          audienceInteractionStyle = parsed.audienceInteractionStyle;
          videoAnalysisSummary = parsed.summary;
          rawKeywords = parsed.rawKeywords || [];
          themeLabels = parsed.themeLabels || [];
          symbolicVocabulary = parsed.symbolicVocabulary || [];

          const allSymbols: BrandDecodedSymbol[] = [];
          for (const s of parsed.identityClaims || []) {
            allSymbols.push({ phrase: s.phrase, meaning: s.meaning, category: "identity_claim", source: "caption" });
          }
          for (const s of parsed.statusSignals || []) {
            allSymbols.push({ phrase: s.phrase, meaning: s.meaning, category: "status_signal", source: "caption" });
          }
          for (const s of parsed.communityReferences || []) {
            allSymbols.push({ phrase: s.phrase, meaning: s.meaning, category: "community_reference", source: "caption" });
          }
          for (const s of parsed.aspirationDrivers || []) {
            allSymbols.push({ phrase: s.phrase, meaning: s.meaning, category: "aspiration_driver", source: "caption" });
          }
          decodedSymbols = allSymbols;
        }

        console.info(`[brandInstagram] LLM voice analysis complete for @${handle}`);
      } catch (err) {
        console.warn("[brandInstagram] LLM analysis failed:", err);
      }
    } else {
      console.info(`[brandInstagram] Insufficient data for LLM — returning profile only for @${handle}`);
    }

    console.info(`[brandInstagram] Successfully analyzed @${handle}`);

    return {
      channelHandle: handle,
      followerCount,
      followingCount,
      mediaCount,
      engagementRate: engagementRate ? Math.round(engagementRate * 100) / 100 : undefined,
      bio,
      isVerified,
      isBusinessAccount,
      category,
      brandVoice,
      contentThemes,
      audienceInteractionStyle,
      videoAnalysisSummary,
      postCaptions,
      decodedSymbols,
      rawKeywords,
      themeLabels,
      symbolicVocabulary,
    };
  } catch (err) {
    console.warn("[brandInstagram] Error:", err);
    return null;
  }
}

// ─── Evidence Block Builder ───────────────────────────────────────────────────

/**
 * Formats Instagram channel data into evidence block for LLM extraction.
 * Mirrors formatBrandTikTokEvidenceBlock() exactly in structure.
 */
export function formatBrandInstagramEvidenceBlock(
  metadata: BrandInstagramMetadata | null
): string {
  if (!metadata) return "";

  const parts: string[] = [];
  parts.push(`## BRAND-AUTHORED INSTAGRAM CHANNEL DATA`);
  parts.push(`- Platform: Instagram`);

  if (metadata.channelHandle) {
    parts.push(`- Handle: @${metadata.channelHandle}`);
  }
  if (metadata.followerCount) {
    parts.push(`- Followers: ${metadata.followerCount.toLocaleString()}`);
  }
  if (metadata.followingCount) {
    parts.push(`- Following: ${metadata.followingCount.toLocaleString()}`);
  }
  if (metadata.mediaCount) {
    parts.push(`- Posts: ${metadata.mediaCount.toLocaleString()}`);
  }
  if (metadata.engagementRate !== undefined) {
    parts.push(`- Engagement Rate: ${metadata.engagementRate.toFixed(2)}%`);
  }
  if (metadata.isVerified) {
    parts.push(`- Verified: Yes`);
  }
  if (metadata.isBusinessAccount) {
    parts.push(`- Business Account: Yes`);
  }
  if (metadata.category) {
    parts.push(`- Category: ${metadata.category}`);
  }
  if (metadata.brandVoice) {
    parts.push(`- Brand Voice: ${metadata.brandVoice}`);
  }
  if (metadata.contentThemes?.length) {
    parts.push(`- Content Themes: ${metadata.contentThemes.join(", ")}`);
  }
  if (metadata.audienceInteractionStyle) {
    parts.push(`- Audience Interaction: ${metadata.audienceInteractionStyle}`);
  }
  if (metadata.bio) {
    parts.push(`- Bio: "${metadata.bio}"`);
  }

  // Include post captions for richer evidence
  if (metadata.postCaptions?.length) {
    parts.push(``);
    parts.push(`Recent Post Captions (most recent first):`);
    metadata.postCaptions.slice(0, 8).forEach((c, i) => {
      parts.push(`  ${i + 1}. "${c.slice(0, 300)}${c.length > 300 ? "…" : ""}"`);
    });
  }

  if (metadata.videoAnalysisSummary) {
    parts.push(``);
    parts.push(`- Analysis: ${metadata.videoAnalysisSummary}`);
  }

  return parts.join("\n");
}
