/**
 * Brand TikTok Analysis
 *
 * Two-track pipeline:
 *
 * Track A — Channel Data (when brand has a TikTok handle):
 *   Fetches user info (followers, bio) and searches for brand-owned videos.
 *   Used for: brand voice, post frequency, owned-content captions.
 *
 * Track B — Audience Mention Intelligence (always runs):
 *   Searches TikTok for the brand NAME (not handle) to capture audience-generated
 *   content. This is how the audience perceives and talks about the brand.
 *   Captures: captions, hashtags, music/sounds, engagement, author diversity.
 *   Applies temporal weighting: recent mentions count more.
 *   Used for: Stuart Hall decoding, Goffman gap detection, audience perception.
 *
 * Audience mention data is weighted HIGHER than brand-authored content for:
 *   - audienceTribe
 *   - stuartHallDecoding
 *   - brandGoffmanStageConsistency
 *   - brandAudienceDecodingSplit
 */

import { invokeLLM } from "./_core/llm";
import { scrapeTikTokUserInfo } from "./scraping/tiktok/profileScraper";
import { searchTikTokVideos } from "./scraping/tiktok/searchScraper";
import { fetchSingleTikTokTranscript } from "./webResearch";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BrandVideoTranscript {
  videoId: string;
  caption: string;
  postedDate?: string;
  transcriptText?: string;
  transcriptWordCount?: number;
  transcriptSource?: string;
}

export interface BrandDecodedSymbol {
  phrase: string;
  meaning: string;
  category: "identity_claim" | "status_signal" | "community_reference" | "aspiration_driver";
  source: "caption" | "bio";
}

export interface MentionVideo {
  videoId: string;
  caption: string;
  hashtags: string[];
  musicTitle: string;
  musicArtist: string;
  authorHandle: string;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  plays: number;
  createdAt: number; // Unix timestamp
  temporalWeight: number; // 1.5 = recent, 1.0 = mid, 0.5 = older
}

export interface AudienceMentionData {
  totalMentions: number;
  uniqueAuthors: number;
  mentionCaptions: string[];
  mentionHashtags: string[];         // Aggregated, deduplicated
  mentionMusicTitles: string[];      // Aggregated music signals
  mentionMusicArtists: string[];
  avgWeightedEngagement: number;     // Weighted by temporal recency
  sentimentSignal: "positive" | "mixed" | "negative" | "insufficient_data";
  sentimentConfidence: "high" | "medium" | "low";
  recentMentionCount: number;        // < 3 months
  midMentionCount: number;           // 3–12 months
  olderMentionCount: number;         // > 12 months
  topHashtags: string[];             // Top 10 by frequency
  audienceLanguageSummary?: string;  // LLM-decoded audience perception
  audienceIdentityClaims: string[];
  audienceStatusSignals: string[];
  audienceCommunityRefs: string[];
  audienceAspirationDrivers: string[];
  audienceTone: string;
  goffmanGapSignal: "Consistent" | "Minor Gap" | "Significant Gap";
  rawMentionVideos: MentionVideo[];
}

export interface BrandTikTokMetadata {
  // Channel data (from brand's own handle, if provided)
  channelHandle?: string;
  followerCount?: number;
  engagementRate?: number;
  brandVoice?: string;
  contentThemes?: string[];
  audienceInteractionStyle?: string;
  topVideoThemes?: string[];
  averageViews?: number;
  postFrequency?: string;
  tiktokBioAnalysis?: string;
  videoAnalysisSummary?: string;
  videoTranscripts?: BrandVideoTranscript[];
  decodedSymbols?: BrandDecodedSymbol[];
  rawKeywords?: string[];
  themeLabels?: string[];
  symbolicVocabulary?: string[];

  // Audience mention intelligence (Track B — always populated when brand name available)
  audienceMentions?: AudienceMentionData;

  // Temporal analysis
  temporalBuckets?: {
    recent: number; // < 3 months
    mid: number;    // 3-12 months
    older: number;  // > 12 months
  };
  culturalVelocity?: "Focusing" | "Drifting" | "Insufficient Data";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractBrandHandle(input: string): string {
  if (!input) return "";
  let handle = input.startsWith("@") ? input.slice(1) : input;
  if (handle.includes("tiktok.com")) {
    const match = handle.match(/@([a-zA-Z0-9._-]+)/);
    if (match) handle = match[1];
  }
  return handle.toLowerCase().trim();
}

/** Returns 1.5 for recent (<3mo), 1.0 for mid (3-12mo), 0.5 for older (>12mo) */
function getTemporalWeight(createdAt: number): number {
  const ageMs = Date.now() - createdAt * 1000;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < 90) return 1.5;
  if (ageDays < 365) return 1.0;
  return 0.5;
}

/** Extract hashtags from textExtra array */
function extractHashtags(textExtra: any[]): string[] {
  if (!Array.isArray(textExtra)) return [];
  return textExtra
    .filter((te: any) => te.type === 1 && te.hashtagName)
    .map((te: any) => te.hashtagName as string);
}

/** Extract hashtags from challenges array (more reliable for search results) */
function extractChallengeHashtags(challenges: any[]): string[] {
  if (!Array.isArray(challenges)) return [];
  return challenges
    .filter((c: any) => c.title)
    .map((c: any) => c.title as string);
}

// ─── Track B: Audience Mention Intelligence ───────────────────────────────────

/**
 * Searches TikTok for brand name mentions and extracts all available signals.
 * This is the primary data source for audience perception analysis.
 */
export async function fetchBrandMentionData(
  brandName: string,
  brandHandle?: string
): Promise<AudienceMentionData | null> {
  if (!brandName?.trim()) return null;

  console.info(`[fetchBrandMentionData] Fetching TikTok mentions for "${brandName}"...`);

  const allVideos: MentionVideo[] = [];
  const seenIds = new Set<string>();

  // Run multiple search queries to maximize coverage
  const searchQueries = [
    brandName,
    `${brandName} haul`,
    `${brandName} review`,
    `${brandName} finds`,
  ];

  for (const keyword of searchQueries) {
    try {
      // Each call now scrolls internally to accumulate 30-45 results
      // (replaces the broken 3-page loop that always fetched the same first page)
      const result = await searchTikTokVideos(keyword) as any;
      const items: any[] = result?.item_list || [];

      for (const video of items) {
        const videoId = String(video.id || video.aweme_id || "");
        if (!videoId || seenIds.has(videoId)) continue;

        // Skip the brand's own videos (we want audience mentions)
        const authorHandle = (video.author?.uniqueId || "").toLowerCase();
        if (brandHandle && authorHandle === brandHandle.toLowerCase()) continue;

        seenIds.add(videoId);

        const createdAt: number = video.createTime || 0;
        const temporalWeight = getTemporalWeight(createdAt);

        // Extract all available fields
        const hashtags = [
          ...extractHashtags(video.textExtra || []),
          ...extractChallengeHashtags(video.challenges || []),
        ];

        const stats = video.stats || video.statistics || {};
        const likes = stats.diggCount || 0;
        const comments = stats.commentCount || 0;
        const shares = stats.shareCount || 0;
        const saves = stats.collectCount || 0;
        const plays = stats.playCount || 0;

        const music = video.music || {};
        const musicTitle = music.title || "";
        const musicArtist = music.authorName || "";

        allVideos.push({
          videoId,
          caption: video.desc || "",
          hashtags,
          musicTitle,
          musicArtist,
          authorHandle,
          likes,
          comments,
          shares,
          saves,
          plays,
          createdAt,
          temporalWeight,
        });
      }
    } catch (err) {
      console.warn(`[fetchBrandMentionData] Search failed for "${keyword}":`, err);
    }
  }

  if (allVideos.length === 0) {
    console.info(`[fetchBrandMentionData] No mention videos found for "${brandName}"`);
    return null;
  }

  console.info(`[fetchBrandMentionData] Found ${allVideos.length} mention videos for "${brandName}"`);

  // ── Aggregate signals ──────────────────────────────────────────────────────

  const now = Date.now();
  const recentVideos = allVideos.filter(v => getTemporalWeight(v.createdAt) === 1.5);
  const midVideos = allVideos.filter(v => getTemporalWeight(v.createdAt) === 1.0);
  const olderVideos = allVideos.filter(v => getTemporalWeight(v.createdAt) === 0.5);

  const uniqueAuthors = new Set(allVideos.map(v => v.authorHandle)).size;

  // Aggregate hashtags with frequency count
  const hashtagFreq: Record<string, number> = {};
  const allHashtags: string[] = [];
  for (const v of allVideos) {
    for (const tag of v.hashtags) {
      const normalized = tag.toLowerCase();
      hashtagFreq[normalized] = (hashtagFreq[normalized] || 0) + v.temporalWeight;
      allHashtags.push(normalized);
    }
  }
  const topHashtags = Object.entries(hashtagFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag]) => tag);

  // Aggregate music signals
  const musicTitles = Array.from(new Set(allVideos.map(v => v.musicTitle).filter(Boolean))).slice(0, 20);
  const musicArtists = Array.from(new Set(allVideos.map(v => v.musicArtist).filter(Boolean))).slice(0, 20);

  // Weighted engagement
  let totalWeightedEngagement = 0;
  let totalWeight = 0;
  for (const v of allVideos) {
    if (v.plays > 0) {
      const engRate = (v.likes + v.comments + v.shares + v.saves) / v.plays;
      totalWeightedEngagement += engRate * v.temporalWeight;
      totalWeight += v.temporalWeight;
    }
  }
  const avgWeightedEngagement = totalWeight > 0
    ? (totalWeightedEngagement / totalWeight) * 100
    : 0;

  // Captions (weighted — recent first)
  const sortedByRecency = [...allVideos].sort((a, b) => b.createdAt - a.createdAt);
  const mentionCaptions = sortedByRecency
    .map(v => v.caption)
    .filter(Boolean)
    .slice(0, 25);

  // ── LLM: Decode audience language and detect sentiment ────────────────────

  let sentimentSignal: AudienceMentionData["sentimentSignal"] = "insufficient_data";
  let sentimentConfidence: AudienceMentionData["sentimentConfidence"] = "low";
  let audienceLanguageSummary: string | undefined;
  let audienceIdentityClaims: string[] = [];
  let audienceStatusSignals: string[] = [];
  let audienceCommunityRefs: string[] = [];
  let audienceAspirationDrivers: string[] = [];
  let audienceTone = "neutral";
  let goffmanGapSignal: AudienceMentionData["goffmanGapSignal"] = "Consistent";

  if (mentionCaptions.length >= 3) {
    try {
      const captionSample = mentionCaptions.slice(0, 20).map((c, i) => `${i + 1}. ${c}`).join("\n");
      const hashtagSample = topHashtags.slice(0, 15).join(", ");
      const musicSample = musicTitles.slice(0, 10).join(", ");

      const prompt = `You are a cultural anthropologist analyzing how audiences talk about the brand "${brandName}" on TikTok.

AUDIENCE-GENERATED CONTENT (${allVideos.length} videos from ${uniqueAuthors} unique creators):

VIDEO CAPTIONS (most recent first):
${captionSample}

TOP HASHTAGS USED BY AUDIENCE:
${hashtagSample}

MUSIC/SOUNDS IN MENTION VIDEOS:
${musicSample}

ENGAGEMENT CONTEXT:
- Weighted engagement rate: ${avgWeightedEngagement.toFixed(2)}%
- Recent mentions (< 3 months): ${recentVideos.length}
- Mid-range mentions (3-12 months): ${midVideos.length}
- Older mentions (> 12 months): ${olderVideos.length}

Analyze this audience-generated content and extract:

1. SENTIMENT: Is the overall audience sentiment about "${brandName}" positive, mixed, or negative?
   - Be conservative: casual/neutral language is "mixed", not negative
   - Only classify as "negative" if there are clear complaints or criticism
   - Confidence: high (15+ clear signals), medium (5-14), low (<5)

2. AUDIENCE IDENTITY CLAIMS: How does the audience identify themselves in relation to this brand?
   (e.g., "budget shoppers", "fashion hunters", "deal seekers")

3. STATUS SIGNALS: What status/positioning does the audience associate with this brand?
   (e.g., "affordable luxury", "everyday essential", "trendy but accessible")

4. COMMUNITY REFERENCES: What communities/groups talk about this brand?
   (e.g., "Gen Z fashion lovers", "Canadian shoppers", "thrift community")

5. ASPIRATION DRIVERS: What aspirations does the brand fulfill for its audience?
   (e.g., "looking stylish on a budget", "finding hidden gems", "smart shopping")

6. AUDIENCE TONE: How does the audience emotionally engage with this brand? (2-3 words)

7. AUDIENCE SUMMARY: 2-3 sentences summarizing how audiences perceive and talk about "${brandName}"

Return JSON:
{
  "sentiment": "positive" | "mixed" | "negative",
  "sentimentConfidence": "high" | "medium" | "low",
  "audienceIdentityClaims": ["claim1", "claim2"],
  "audienceStatusSignals": ["signal1", "signal2"],
  "audienceCommunityRefs": ["ref1", "ref2"],
  "audienceAspirationDrivers": ["driver1", "driver2"],
  "audienceTone": "2-3 word tone description",
  "audienceSummary": "2-3 sentence summary"
}`;

      const response = await invokeLLM({
        purpose: "brand_mention_analysis",
        messages: [
          {
            role: "system",
            content: "You are a cultural anthropologist specializing in brand perception analysis. Extract structured insights from audience-generated TikTok content.",
          },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "audience_mention_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                sentiment: { type: "string", enum: ["positive", "mixed", "negative"] },
                sentimentConfidence: { type: "string", enum: ["high", "medium", "low"] },
                audienceIdentityClaims: { type: "array", items: { type: "string" } },
                audienceStatusSignals: { type: "array", items: { type: "string" } },
                audienceCommunityRefs: { type: "array", items: { type: "string" } },
                audienceAspirationDrivers: { type: "array", items: { type: "string" } },
                audienceTone: { type: "string" },
                audienceSummary: { type: "string" },
              },
              required: [
                "sentiment", "sentimentConfidence", "audienceIdentityClaims",
                "audienceStatusSignals", "audienceCommunityRefs", "audienceAspirationDrivers",
                "audienceTone", "audienceSummary",
              ],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content;
      if (content) {
        const parsed = typeof content === "string" ? JSON.parse(content) : content;
        sentimentSignal = parsed.sentiment;
        sentimentConfidence = parsed.sentimentConfidence;
        audienceIdentityClaims = parsed.audienceIdentityClaims || [];
        audienceStatusSignals = parsed.audienceStatusSignals || [];
        audienceCommunityRefs = parsed.audienceCommunityRefs || [];
        audienceAspirationDrivers = parsed.audienceAspirationDrivers || [];
        audienceTone = parsed.audienceTone || "neutral";
        audienceLanguageSummary = parsed.audienceSummary;
      }
    } catch (err) {
      console.warn("[fetchBrandMentionData] LLM analysis failed:", err);
    }
  }

  return {
    totalMentions: allVideos.length,
    uniqueAuthors,
    mentionCaptions,
    mentionHashtags: Array.from(new Set(allHashtags)),
    mentionMusicTitles: musicTitles,
    mentionMusicArtists: musicArtists,
    avgWeightedEngagement,
    sentimentSignal,
    sentimentConfidence,
    recentMentionCount: recentVideos.length,
    midMentionCount: midVideos.length,
    olderMentionCount: olderVideos.length,
    topHashtags,
    audienceLanguageSummary,
    audienceIdentityClaims,
    audienceStatusSignals,
    audienceCommunityRefs,
    audienceAspirationDrivers,
    audienceTone,
    goffmanGapSignal: "Consistent", // Will be updated by brand extraction LLM
    rawMentionVideos: allVideos.slice(0, 50), // Store up to 50 for reference
  };
}

// ─── Track A: Brand Channel Analysis ─────────────────────────────────────────

/**
 * Analyzes the brand's own TikTok channel (when handle is provided).
 * Returns brand-authored content signals.
 */
export async function analyzeBrandTikTokChannel(
  tiktokChannelUrl: string | undefined | null
): Promise<BrandTikTokMetadata | null> {
  if (!tiktokChannelUrl || tiktokChannelUrl.trim() === "") {
    return null;
  }

  const handle = extractBrandHandle(tiktokChannelUrl);
  if (!handle) {
    console.warn("[analyzeBrandTikTokChannel] Could not extract handle from:", tiktokChannelUrl);
    return null;
  }

  try {
    console.info(`[analyzeBrandTikTokChannel] Fetching TikTok channel data for @${handle}...`);

    let followerCount: number | undefined;
    let bioText: string | undefined;
    let engagementRate: number | undefined;
    let averageViews: number | undefined;
    let videos: any[] = [];

    // Step 1: Fetch user info
    try {
      const userInfo = await scrapeTikTokUserInfo(handle) as any;

      if (userInfo?.userInfo?.user) {
        followerCount = userInfo.userInfo.stats?.followerCount;
        bioText = userInfo.userInfo.user.signature || userInfo.userInfo.user.desc;
        console.info(`[analyzeBrandTikTokChannel] Found @${handle} with ${followerCount?.toLocaleString()} followers`);
      }
    } catch (err) {
      console.warn(`[analyzeBrandTikTokChannel] Could not fetch user info for @${handle}:`, err);
    }

    // Step 2: Fetch brand's own videos via search (filter to brand-owned only)
    try {
      // Scrolling inside searchTikTokVideos accumulates 30-45 results per call
      const searchResult = await searchTikTokVideos(`@${handle}`) as any;
      const searchItems: any[] = searchResult?.item_list || [];
      const brandVideos = searchItems.filter(
        (v: any) => (v?.author?.uniqueId || "").toLowerCase() === handle.toLowerCase()
      );
      videos.push(...brandVideos);

      console.info(`[analyzeBrandTikTokChannel] Found ${videos.length} owned videos from @${handle}`);
    } catch (err) {
      console.warn(`[analyzeBrandTikTokChannel] Could not fetch owned videos for @${handle}:`, err);
    }

    // Step 3: Extract video metadata
    let totalEngagement = 0;
    let totalViews = 0;
    const videoCaptions: string[] = [];
    const videoTranscripts: BrandVideoTranscript[] = [];

    for (const video of videos) {
      const desc = video.desc || "";
      const videoId = video.aweme_id || video.id || "";
      const createTime = video.create_time || video.createTime;
      const stats = video.stats || video.statistics || {};
      const playCount = stats.playCount || stats.play_count || 0;
      const commentCount = stats.commentCount || stats.comment_count || 0;
      const shareCount = stats.shareCount || stats.share_count || 0;
      const diggCount = stats.diggCount || stats.digg_count || 0;

      totalViews += playCount;
      totalEngagement += commentCount + shareCount + diggCount;

      if (desc) {
        videoCaptions.push(desc);
        videoTranscripts.push({
          videoId,
          caption: desc,
          postedDate: createTime ? new Date(createTime * 1000).toISOString() : undefined,
        });
      }
    }

    if (totalViews > 0 && videos.length > 0) {
      averageViews = Math.round(totalViews / videos.length);
      engagementRate = (totalEngagement / totalViews) * 100;
    }

    // Step 3b: Fetch transcripts for up to 6 brand videos (non-fatal)
    const TRANSCRIPT_LIMIT = 6;
    const videosToTranscribe = videos.slice(0, TRANSCRIPT_LIMIT).filter(
      (v: any) => (v.aweme_id || v.id) && handle
    );
    if (videosToTranscribe.length > 0) {
      console.info(`[analyzeBrandTikTokChannel] Fetching transcripts for ${videosToTranscribe.length} brand videos...`);
      const transcriptResults = await Promise.allSettled(
        videosToTranscribe.map(async (video: any) => {
          const videoId = video.aweme_id || video.id || "";
          const desc = video.desc || "";
          const videoUrl = `https://www.tiktok.com/@${handle}/video/${videoId}`;
          return fetchSingleTikTokTranscript(videoUrl, videoId, desc);
        })
      );

      let transcriptsFound = 0;
      for (let i = 0; i < transcriptResults.length; i++) {
        const result = transcriptResults[i];
        if (result.status === "fulfilled" && result.value) {
          const t = result.value;
          transcriptsFound++;
          // Enrich the matching videoTranscript entry
          const existing = videoTranscripts.find(vt => vt.videoId === t.videoId);
          if (existing) {
            existing.transcriptText = t.transcript;
            existing.transcriptWordCount = t.wordCount;
            existing.transcriptSource = t.transcriptSource ?? "captions";
          }
          // Add to captions array for richer LLM analysis
          if (t.transcript && t.wordCount > 10) {
            videoCaptions.push(`[TRANSCRIPT] ${t.transcript.slice(0, 500)}`);
          }
        }
      }
      console.info(`[analyzeBrandTikTokChannel] Transcripts fetched: ${transcriptsFound}/${videosToTranscribe.length}`);
    }

    // Step 4: LLM analysis of brand voice (if we have captions or bio)
    let brandVoice: string | undefined;
    let contentThemes: string[] | undefined;
    let audienceInteractionStyle: string | undefined;
    let videoAnalysisSummary: string | undefined;
    let decodedSymbols: BrandDecodedSymbol[] = [];
    let rawKeywords: string[] = [];
    let themeLabels: string[] = [];
    let symbolicVocabulary: string[] = [];

    if (videoCaptions.length > 0 || bioText) {
      try {
        const analysisPrompt = `Analyze this brand's TikTok channel to extract cultural and voice signals.

**Channel Handle:** @${handle}
**Bio:** ${bioText || "N/A"}
**Owned Video Captions (${videoCaptions.length} videos):**
${videoCaptions.slice(0, 10).map((c, i) => `${i + 1}. ${c}`).join("\n")}

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
          purpose: "brand_channel_analysis",
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
              name: "brand_channel_analysis",
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
      } catch (err) {
        console.warn("[analyzeBrandTikTokChannel] LLM analysis failed:", err);
      }
    }

    // Post frequency estimate
    let postFrequency: string | undefined;
    if (videos.length >= 15) postFrequency = "daily or near-daily";
    else if (videos.length >= 8) postFrequency = "3-5x per week";
    else if (videos.length >= 4) postFrequency = "1-2x per week";
    else if (videos.length > 0) postFrequency = "sporadic";

    // Temporal analysis of brand-owned videos
    let temporalBuckets: { recent: number; mid: number; older: number } | undefined;
    let culturalVelocity: "Focusing" | "Drifting" | "Insufficient Data" | undefined;
    if (videos.length >= 3) {
      const now = Date.now() / 1000;
      const threeMonths = 90 * 24 * 60 * 60;
      const twelveMonths = 365 * 24 * 60 * 60;
      const recentVids: any[] = [];
      const midVids: any[] = [];
      const olderVids: any[] = [];

      for (const v of videos) {
        const ct = v.create_time || v.createTime || 0;
        const age = now - ct;
        if (age < threeMonths) recentVids.push(v);
        else if (age < twelveMonths) midVids.push(v);
        else olderVids.push(v);
      }

      temporalBuckets = {
        recent: recentVids.length,
        mid: midVids.length,
        older: olderVids.length,
      };

      // Compute cultural velocity: compare recent caption keywords vs older
      const extractWords = (vids: any[]) => {
        const words = new Set<string>();
        for (const v of vids) {
          const desc = (v.desc || "").toLowerCase();
          const tokens = desc.match(/[a-z]{3,}/g) || [];
          tokens.forEach((t: string) => words.add(t));
        }
        return words;
      };

      if (recentVids.length >= 2 && (midVids.length >= 1 || olderVids.length >= 1)) {
        const recentWords = extractWords(recentVids);
        const olderWords = extractWords([...midVids, ...olderVids]);
        if (recentWords.size > 0 && olderWords.size > 0) {
          let overlap = 0;
          const recentArr = Array.from(recentWords);
          for (const w of recentArr) {
            if (olderWords.has(w)) overlap++;
          }
          const overlapRatio = overlap / Math.min(recentWords.size, olderWords.size);
          culturalVelocity = overlapRatio >= 0.4 ? "Focusing" : "Drifting";
        } else {
          culturalVelocity = "Insufficient Data";
        }
      } else {
        culturalVelocity = "Insufficient Data";
      }
      console.info(`[analyzeBrandTikTokChannel] Temporal: recent=${recentVids.length}, mid=${midVids.length}, older=${olderVids.length}, velocity=${culturalVelocity}`);
    }

    console.info(`[analyzeBrandTikTokChannel] Successfully analyzed @${handle}`);

    return {
      channelHandle: handle,
      followerCount,
      engagementRate: engagementRate ? Math.round(engagementRate * 100) / 100 : undefined,
      brandVoice,
      contentThemes,
      audienceInteractionStyle,
      topVideoThemes: contentThemes,
      averageViews,
      postFrequency,
      tiktokBioAnalysis: bioText,
      videoAnalysisSummary,
      videoTranscripts,
      decodedSymbols,
      rawKeywords,
      themeLabels,
      symbolicVocabulary,
      temporalBuckets,
      culturalVelocity,
    };
  } catch (err) {
    console.warn("[analyzeBrandTikTokChannel] Error:", err);
    return null;
  }
}

// ─── Evidence Block Builders ──────────────────────────────────────────────────

/**
 * Formats brand channel data into evidence block for LLM extraction.
 */
export function formatBrandTikTokEvidenceBlock(
  metadata: BrandTikTokMetadata | null
): string {
  if (!metadata) return "";

  const parts: string[] = [];
  parts.push(`## BRAND-AUTHORED TIKTOK CHANNEL DATA`);

  if (metadata.channelHandle) {
    parts.push(`- Handle: @${metadata.channelHandle}`);
  }
  if (metadata.followerCount) {
    parts.push(`- Followers: ${metadata.followerCount.toLocaleString()}`);
  }
  if (metadata.engagementRate !== undefined) {
    parts.push(`- Engagement Rate: ${metadata.engagementRate.toFixed(2)}%`);
  }
  if (metadata.averageViews) {
    parts.push(`- Average Views: ${metadata.averageViews.toLocaleString()}`);
  }
  if (metadata.postFrequency) {
    parts.push(`- Post Frequency: ${metadata.postFrequency}`);
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
  if (metadata.videoAnalysisSummary) {
    parts.push(`- Analysis: ${metadata.videoAnalysisSummary}`);
  }
  if (metadata.tiktokBioAnalysis) {
    parts.push(`- Bio: "${metadata.tiktokBioAnalysis}"`);
  }

  return parts.join("\n");
}

/**
 * Formats audience mention intelligence into evidence block for LLM extraction.
 * This is the PRIMARY evidence source for audience perception fields.
 */
export function formatAudienceMentionEvidenceBlock(
  mentions: AudienceMentionData | null | undefined
): string {
  if (!mentions || mentions.totalMentions === 0) return "";

  const parts: string[] = [];

  parts.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  parts.push(`AUDIENCE MENTION INTELLIGENCE (PRIMARY EVIDENCE — weighted higher than brand website)`);
  parts.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  parts.push(`Source: ${mentions.totalMentions} TikTok videos from ${mentions.uniqueAuthors} unique creators`);
  parts.push(`Temporal breakdown: ${mentions.recentMentionCount} recent (<3mo) · ${mentions.midMentionCount} mid (3-12mo) · ${mentions.olderMentionCount} older (>12mo)`);
  parts.push(`Weighted engagement rate: ${mentions.avgWeightedEngagement.toFixed(2)}%`);
  parts.push(``);

  parts.push(`AUDIENCE SENTIMENT: ${mentions.sentimentSignal.toUpperCase()} (confidence: ${mentions.sentimentConfidence})`);
  parts.push(``);

  if (mentions.audienceLanguageSummary) {
    parts.push(`AUDIENCE PERCEPTION SUMMARY:`);
    parts.push(mentions.audienceLanguageSummary);
    parts.push(``);
  }

  if (mentions.audienceIdentityClaims.length > 0) {
    parts.push(`AUDIENCE IDENTITY CLAIMS (→ AudienceTribe, StuartHallDecoding):`);
    mentions.audienceIdentityClaims.forEach(c => parts.push(`  ▸ ${c}`));
    parts.push(``);
  }

  if (mentions.audienceStatusSignals.length > 0) {
    parts.push(`AUDIENCE STATUS SIGNALS (→ SymbolicPosition, BrandArchetypeClassification):`);
    mentions.audienceStatusSignals.forEach(s => parts.push(`  ▸ ${s}`));
    parts.push(``);
  }

  if (mentions.audienceCommunityRefs.length > 0) {
    parts.push(`AUDIENCE COMMUNITY REFERENCES (→ AudienceTribe, EmotionalPromise):`);
    mentions.audienceCommunityRefs.forEach(r => parts.push(`  ▸ ${r}`));
    parts.push(``);
  }

  if (mentions.audienceAspirationDrivers.length > 0) {
    parts.push(`AUDIENCE ASPIRATION DRIVERS (→ BarthesMyth, CulturalTension):`);
    mentions.audienceAspirationDrivers.forEach(d => parts.push(`  ▸ ${d}`));
    parts.push(``);
  }

  if (mentions.topHashtags.length > 0) {
    parts.push(`TOP AUDIENCE HASHTAGS (cultural positioning signals):`);
    parts.push(`  ${mentions.topHashtags.slice(0, 12).join(" · ")}`);
    parts.push(``);
  }

  if (mentions.mentionMusicTitles.length > 0) {
    parts.push(`MUSIC/SOUNDS IN AUDIENCE CONTENT (cultural association signals):`);
    parts.push(`  ${mentions.mentionMusicTitles.slice(0, 8).join(" · ")}`);
    parts.push(``);
  }

  if (mentions.mentionCaptions.length > 0) {
    parts.push(`SAMPLE AUDIENCE CAPTIONS (verbatim — most recent first):`);
    mentions.mentionCaptions.slice(0, 10).forEach((c, i) => {
      parts.push(`  ${i + 1}. "${c}"`);
    });
    parts.push(``);
  }

  parts.push(`⚠️  CRITICAL INSTRUCTION — AUDIENCE MENTIONS ARE PRIMARY EVIDENCE:`);
  parts.push(`    Use audience mention data as the DOMINANT signal for these fields:`);
  parts.push(`    - audienceTribe: use audience community references + identity claims`);
  parts.push(`    - brandStuartHallDecoding: use sentiment + how audience frames the brand`);
  parts.push(`    - brandGoffmanStageConsistency: compare brand self-claims vs audience language`);
  parts.push(`    - brandAudienceDecodingSplit: true if audience segments decode differently`);
  parts.push(`    - culturalTension: the gap between brand claims and audience perception`);
  parts.push(`    If sentiment is NEGATIVE: note this in aiSummary and lower brandGoffmanStageConsistency`);

  return parts.join("\n");
}
