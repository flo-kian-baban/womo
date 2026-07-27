/**
 * Web Research Layer — Transcript-First Pipeline
 *
 * For every creator, we attempt to collect ACTUAL SPOKEN TRANSCRIPTS from their
 * individual videos before passing anything to the LLM. Transcripts are the
 * gold-standard input because they capture what the creator literally says.
 *
 * TikTok pipeline:
 *   1. Query TikTok search API (count as STRING '20') for the creator's handle
 *   2. Author-filter results: only keep videos where author.uniqueId matches handle
 *   3. For each matching video, fetch the individual video page
 *   4. Parse __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON → extract subtitleInfos[].Url
 *   5. Download WEBVTT file → parse to plain text
 *   6. If < 3 transcripts: throw TRPCError (no hallucination)
 *
 * YouTube pipeline:
 *   1. Search YouTube API for channel → get channel ID
 *   2. Get channel videos list → collect video IDs
 *   3. For each video, fetch the watch page
 *   4. Extract caption track URL from ytInitialPlayerResponse
 *   5. Download caption XML → parse to plain text
 *   6. If < 3 transcripts: continue with titles/bio (YouTube captions are auto-generated,
 *      less reliable, so we degrade gracefully rather than hard-error)
 *
 * NO YouTube fallback for TikTok creators — it causes hallucinations.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { fetchHtml, requestGovernor, recordScrapeEvent } from "./scraping/httpClient";
import { getContext, retireContext } from "./scraping/browserClient";
import pLimit from "p-limit";
import { scrapeTikTokProfile } from "./scraping/tiktok/profileScraper";
import {
  parseWebVTT,
  budgetedTranscriptStrategies,
  budgetedTranscriptPhase,
  fetchVideoTranscript,
  type TranscriptPhase,
} from "./scraping/tiktok/transcriptStrategies";
import { searchTikTokVideos } from "./scraping/tiktok/searchScraper";
import { searchYouTube } from "./scraping/youtube/searchScraper";
import { scrapeYouTubeChannelDetails, scrapeYouTubeChannelVideos } from "./scraping/youtube/channelScraper";
import { searchWeb } from "./scraping/brand/searchFallback";
import { scrapeInstagramProfile } from "./scraping/instagram/profileScraper";
import { supplementPostsViaOEmbed } from "./scraping/instagram/postScraper";
// Instagram types imported via scrapeInstagramProfile return value
import { invokeLLM } from "./_core/llm";
import { TRPCError } from "@trpc/server";
import { decodeCreatorSymbols, formatDecodedSymbolsBlock } from "./symbolDecoder";
import { fetchBrandReviews } from "./reviewResearch";
import { fetchBrandMentionData, formatAudienceMentionEvidenceBlock, type AudienceMentionData } from "./brandTikTokAnalysis";
import { decodeBrandSymbols, formatBrandDecodedSymbolsBlock, type BrandDecodedSymbols } from "./brandSymbolDecoder";
import { transcribeAudio } from "./_core/voiceTranscription";
import { insertScrapeEvent, recordPhaseObservation, type PhaseStateWrite } from "./db";
import { currentRunId, currentDeadlineAt } from "./_core/runContext";
import { runPhases, bankedOutput } from "./phases/phaseRunner";
import { toolsetFor } from "./phases/platformTools";
import { makeSchedulerExecute } from "./phases/phaseScheduler";
import { assembleBrandEvidence, buildBrandBaseEvidence, type BrandBaseEvidenceInputs, type BrandEvidenceParts } from "./phases/brandEvidence";
import { encodeSubject } from "./_core/subjectIdentity";
import type { AnalysisPhase, CampaignState, PhaseName, PlatformName, SampleBucket } from "./_core/analysisPhase";
import { PHASE_NAMES } from "./_core/analysisPhase";
import { flush as flushCollectionFixture } from "./phases/fixtureCapture";
import {
  makeCapturePhase, makeAugmentPhase, makeTranscribePhase,
  type CapturePhaseOutput, type AugmentPhaseOutput, type TranscribePhaseOutput,
} from "./phases/collectionPhases";
import {
  makeDerivePhase, assembleFromPhases, type DerivePhaseOutput,
} from "./phases/derivePhases";
import { TRANSCRIPT_SOURCE, isSpeechTranscript } from "@shared/transcriptSource";
import { isStopword } from "@shared/stopwords";
import { isAuthorMatch } from "@shared/authorMatch";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TranscriptEntry {
  videoId: string;
  videoUrl: string;
  caption: string;       // The video's text caption / title
  transcript: string;    // Full spoken transcript (plain text)
  wordCount: number;
  bucket?: SampleBucket; // temporal bucket where the platform samples temporally
  createTime?: number;   // Unix timestamp (seconds)
  transcriptSource?: string; // normalized via @shared/transcriptSource (subtitle | speech_to_text | post_caption)
  // Phase 1.6 metadata
  musicMetadata?: { soundName?: string; isOriginal?: boolean; isTrending?: boolean; niche?: "niche" | "mainstream" | "unknown" };
  remixMetadata?: { duetCount?: number; stitchCount?: number; remixTotal?: number };
  videoDuration?: number;
  region?: string;
  collaborations?: string[];
}

export interface LongitudinalSample {
  recent: TranscriptEntry[];   // 6 most recent videos
  mid: TranscriptEntry[];      // 3 from ~9 months ago
  anchor: TranscriptEntry[];   // 3 from ~18 months ago
  totalFetched: number;
  completeness: "full" | "partial" | "insufficient"; // full=12, partial=6+, insufficient=<6
  culturalVelocity: "Focusing" | "Drifting" | "Insufficient Data";
}

export interface CreatorResearchResult {
  handle: string;
  platform: string;
  displayName: string;
  bio: string;
  followerCount: number;
  followingCount?: number;
  videoCount: number;
  totalLikes: number;
  totalViews: number;
  avgViews: number;
  engagementRate: number;   // percentage 0–100
  location: string;
  profileUrl: string;
  recentVideoTitles: string[];
  topHashtags: string[];
  rawKeywords: string[];           // All extracted keywords
  contentThemeLabels: string[];    // LLM-translated named themes (3–5)
  contentThemes: string[];         // Rule-based themes (kept for evidence summary)
  transcripts: TranscriptEntry[];  // Actual spoken transcripts
  transcriptCount: number;         // Number of transcripts successfully fetched
  transcriptExcerpts: string;      // Combined excerpt text for DB storage
  decodedSymbols?: Record<string, unknown> | null; // Symbol Decoder output for DB storage
  evidenceSummary: string;         // Plain-text evidence block passed to LLM
  // Phase 1.5 additions
  longitudinalSample?: LongitudinalSample; // 6-3-3 stratified sample
  culturalVelocity?: "Focusing" | "Drifting" | "Insufficient Data";
  dataConfidenceLevel?: "high" | "medium" | "low";
  // Session 8: true iff the COMPUTED ENGAGEMENT SIGNALS block was present in the
  // evidence (TikTok path with sampled videos) — i.e. parasocialBondStrength /
  // audienceRelationshipType / culturalCapital / remixRate were data-derived and
  // copied by the model. false = the model estimated them from its rubric
  // (Instagram / YouTube, or a TikTok run with no engagement data).
  sociologicalFieldsComputed?: boolean;
  /** Session 10: count of foreign / author-less videos rejected by the author guard (TikTok path). */
  foreignVideosRejected?: number;
  // Supplemental video pool — all discovered video URLs with engagement stats
  discoveredVideoPool?: Array<{
    id: string; url: string; caption: string; createTime: number;
    views: number; likes: number; comments: number; saves: number; shares: number;
    musicOriginal: boolean; musicTitle?: string; musicArtist?: string;
    durationSec: number;
    /** C3: 6-3-3 sample membership, set for all 12 sampled videos regardless of transcript success. */
    temporalBucket?: SampleBucket;
  }>;
}

export interface BrandResearchResult {
  brandName: string;
  websiteUrl: string;
  description: string;
  searchSnippets: string[];
  evidenceSummary: string;
  /**
   * The same evidence, UNCONCATENATED (S5). The router appends its own blocks
   * and must do so through the one shared assembly, so it needs the parts
   * rather than the finished string.
   */
  evidenceParts: BrandEvidenceParts;
  /** What the base block was built from, for the identity harness. */
  brandBaseInputs: BrandBaseEvidenceInputs;
  // Review data
  yelpRating: number | null;
  yelpReviewCount: number | null;
  yelpReviewExcerpts: string;
  googleRating: number | null;
  googleReviewCount: number | null;
  googleReviewExcerpts: string;
  combinedReviewText: string;
  overallRating: number | null;
  totalReviews: number;
  // Brand Symbol Decoder output
  brandDecodedSymbols: BrandDecodedSymbols | null;
  brandRawKeywords: string[];
  brandThemeLabels: string[];
  brandSymbolicVocabulary: string[];
  // Phase 1.5 — Semantic crawl metadata
  semanticWordCount: number;
  crawledPages: string[];
  dataConfidenceLevel: "high" | "medium" | "low";
  // Phase 6 — Audience Mention Intelligence
  audienceMentionData?: import("./brandTikTokAnalysis").AudienceMentionData | null;
  // Phase 6 — TikTok Metadata for performance signals
  tiktokMetadata?: Record<string, unknown> | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractHandle(handleOrUrl: string): string {
  const urlMatch = handleOrUrl.match(/(?:tiktok\.com\/@?|youtube\.com\/(?:@|channel\/|user\/)|instagram\.com\/)([^/?#\s]+)/i);
  if (urlMatch) return urlMatch[1].replace(/^@/, "");
  return handleOrUrl.replace(/^@/, "").trim();
}

/**
 * Normalize a handle for comparison: lowercase, remove dots/underscores/hyphens.
 * e.g. "malik.the.prince19" → "maliktheprince19"
 */
function normalizeHandle(h: string): string {
  return h.toLowerCase().replace(/[._\-]/g, "");
}

// ─── Known-location matcher (C1: mechanism-safe) ────────────────────────────
// The location list mixes full city names (safe — multi-char, unambiguous) with
// SHORT ABBREVIATIONS ("LA", "NYC"). Matching abbreviations case-INsensitively
// let a two-letter code match a common lowercase word in another language —
// e.g. the Spanish/French article "la" matched "LA" (Los Angeles), giving a
// creator location of "la". This fixes the MECHANISM (case handling), not the
// approach (still a hardcoded list, per Jason's ruling): full names stay
// case-insensitive; abbreviations must appear in UPPERCASE (case-sensitive),
// which no common lowercase word can satisfy in ANY language. Prevents the
// class of "short abbreviation matches a lowercase common word" false positives.
const KNOWN_CITY_FULL_NAMES = [
  "Toronto", "New York", "Los Angeles", "London", "Dubai", "Paris", "Chicago",
  "Miami", "Houston", "Atlanta", "Montreal", "Vancouver", "Sydney", "Melbourne",
  "Calgary", "Ottawa", "Edmonton", "Winnipeg", "Quebec", "Halifax", "Cleveland",
  "Brooklyn", "Nashville", "Austin", "Seattle", "Denver", "Boston", "Philadelphia",
];
const KNOWN_CITY_ABBREVIATIONS = ["NYC", "LA"]; // uppercase-only, matched case-sensitively
const CITY_FULL_RE = new RegExp(`\\b(${KNOWN_CITY_FULL_NAMES.join("|")})\\b`, "i");
const CITY_ABBR_RE = new RegExp(`\\b(${KNOWN_CITY_ABBREVIATIONS.join("|")})\\b`); // NO /i flag

export function matchKnownCity(text: string): string | null {
  const full = text.match(CITY_FULL_RE);
  if (full) return full[1];
  const abbr = text.match(CITY_ABBR_RE); // case-sensitive: "LA" yes, "la" no
  if (abbr) return abbr[1];
  return null;
}

/**
 * Session 10 (Commit 2): TikTok's `video.duration` on the web item_list is in
 * SECONDS, but it was consumed as milliseconds (`durationMs` then `/1000`
 * downstream), which zeroed every sub-1000-second video — so with_duration was
 * always 0 and avg_video_duration was always skipped. Normalize to ACTUAL
 * milliseconds, robust to either unit: a value over 1000 is already ms (no
 * TikTok video is 1000s+ long), otherwise it is seconds → ×1000.
 */
export function tiktokDurationToMs(raw: number): number {
  if (!raw || raw <= 0) return 0;
  return raw > 1000 ? Math.round(raw) : Math.round(raw * 1000);
}

export function extractHashtags(texts: string[]): string[] {
  const tagCounts: Record<string, number> = {};
  for (const text of texts) {
    const matches = text.match(/#([a-zA-Z0-9_]+)/g) ?? [];
    for (const tag of matches) {
      const clean = tag.toLowerCase();
      tagCounts[clean] = (tagCounts[clean] ?? 0) + 1;
    }
  }
  return Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag]) => tag);
}

function extractKeywords(texts: string[]): string[] {
  // C2: this local set keeps the original platform/domain fillers (video,
  // subscribe, link, …) and generic nouns; the shared isStopword() adds a
  // curated MULTILINGUAL function-word filter on top, closing the leaks
  // (because/there/over/going/done/out/wants) and handling non-English creators
  // (Spanish/French/Portuguese/German/Italian articles & prepositions).
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
    "from", "up", "about", "into", "through", "during", "is", "are", "was", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "i", "my", "me", "we", "our", "you", "your",
    "he", "she", "it", "they", "them", "this", "that", "these", "those", "what", "which",
    "who", "how", "when", "where", "why", "all", "each", "every", "both", "few", "more",
    "most", "other", "some", "such", "no", "not", "only", "same", "so", "than", "too",
    "very", "just", "also", "new", "get", "got", "let", "like", "make", "know", "think",
    "see", "look", "come", "go", "take", "give", "use", "find", "want", "need", "day",
    "time", "year", "way", "part", "place", "case", "week", "company", "number", "group",
    "problem", "fact", "video", "watch", "subscribe", "follow", "link", "bio", "check",
    "click", "here", "now", "today", "back", "first", "last", "next", "own", "old", "big",
    "high", "long", "great", "little", "good", "bad", "best", "right", "left", "real",
    "full", "free", "live", "show", "tell", "feel", "try", "turn", "ask", "seem", "leave",
    "call", "keep", "put", "set", "run", "move", "play", "pay", "hear", "help", "talk",
    "start", "always", "never", "ever", "still", "already", "again", "once", "often",
    "yeah", "okay", "like", "just", "really", "actually", "gonna", "wanna", "gotta",
    "um", "uh", "so", "well", "right", "know", "mean", "think", "said", "went", "came",
  ]);

  const wordCounts: Record<string, number> = {};
  for (const text of texts) {
    const clean = text.replace(/#\w+/g, "").replace(/https?:\/\/\S+/g, "").toLowerCase();
    const words = clean.match(/\b[a-z]{3,20}\b/g) ?? [];
    for (const word of words) {
      if (!stopWords.has(word) && !isStopword(word)) {
        wordCounts[word] = (wordCounts[word] ?? 0) + 1;
      }
    }
  }
  return Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([word]) => word);
}

async function translateKeywordsToThemes(
  keywords: string[],
  hashtags: string[],
  videoTitles: string[],
  bio: string,
  transcriptText?: string
): Promise<string[]> {
  if (keywords.length === 0 && hashtags.length === 0 && !transcriptText) {
    return ["General Content Creator"];
  }

  try {
    const transcriptSnippet = transcriptText
      ? `\nTranscript excerpt (spoken content): ${transcriptText.slice(0, 400)}`
      : "";

    const prompt = `You are a content analyst. Given the following data from a social media creator, identify 3–5 specific named content themes that best describe what this creator makes.

Keywords (most frequent): ${keywords.slice(0, 25).join(", ")}
Top hashtags: ${hashtags.slice(0, 15).join(", ")}
Sample video titles: ${videoTitles.slice(0, 10).join(" | ")}
Creator bio: ${bio}${transcriptSnippet}

Rules:
- Be specific (e.g., "Halal Food Reviews" not just "Food")
- Use 2–4 word theme names
- Return exactly 3–5 themes
- If transcript is provided, weight it HEAVILY — it is the most reliable signal
- Output ONLY a JSON array of strings, nothing else

Example output: ["Halal Street Food Reviews", "Toronto Local Culture", "Family & Parenting", "Muslim Identity Content"]`;

    const response = await invokeLLM({
      purpose: "content_theme_extraction",
      messages: [
        { role: "system", content: "You are a content analyst. Output only valid JSON arrays." },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "content_themes",
          strict: true,
          schema: {
            type: "object",
            properties: {
              themes: { type: "array", items: { type: "string" } },
            },
            required: ["themes"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (content) {
      const parsed = JSON.parse(content as string) as { themes: string[] };
      if (Array.isArray(parsed.themes) && parsed.themes.length > 0) {
        return parsed.themes.slice(0, 5);
      }
    }
  } catch (err) {
    console.warn("[webResearch] LLM theme translation failed:", err);
  }

  return inferContentThemes(videoTitles, hashtags, bio);
}

function inferContentThemes(videoTitles: string[], hashtags: string[], bio: string): string[] {
  const allText = [...videoTitles, ...hashtags, bio].join(" ").toLowerCase();
  const themeMap: Record<string, string[]> = {
    "Food & Restaurant Reviews": ["food", "restaurant", "review", "eat", "taste", "menu", "halal", "shawarma", "pizza", "chicken", "cooking", "recipe", "chef", "burger", "sushi", "ramen"],
    "Local City Culture": ["toronto", "montreal", "nyc", "london", "city", "local", "street", "neighbourhood", "downtown"],
    "Street Interviews": ["interview", "street", "ask", "people", "random", "reaction", "public"],
    "Comedy & Entertainment": ["funny", "comedian", "comedy", "laugh", "prank", "challenge", "skit", "standup", "humor"],
    "Music & Performance": ["music", "musician", "guitar", "band", "album", "song", "rock", "perform", "concert", "gig"],
    "Family & Parenting": ["father", "dad", "kids", "children", "family", "parenting", "single", "mom", "parent"],
    "Lifestyle & Daily Life": ["day in", "vlog", "lifestyle", "daily", "routine", "morning", "night"],
    "Culture & Identity": ["arab", "muslim", "culture", "heritage", "middle eastern", "immigrant", "diaspora", "identity"],
    "Fitness & Health": ["gym", "workout", "fitness", "health", "exercise", "training", "wellness"],
    "Fashion & Beauty": ["fashion", "outfit", "style", "beauty", "makeup", "skincare", "ootd"],
    "Travel & Adventure": ["travel", "trip", "explore", "adventure", "visit", "destination", "abroad"],
    "Tech & Gaming": ["tech", "gaming", "game", "app", "software", "review", "unboxing"],
    "Business & Entrepreneurship": ["business", "entrepreneur", "startup", "brand", "marketing"],
    "Education & Tutorials": ["tutorial", "how to", "learn", "teach", "tips", "guide", "explain"],
  };

  const matched: string[] = [];
  for (const [theme, keywords] of Object.entries(themeMap)) {
    const score = keywords.filter((kw) => allText.includes(kw)).length;
    if (score >= 2) matched.push(theme);
  }
  return matched.length > 0 ? matched.slice(0, 5) : ["General Content Creator"];
}

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// fetchHtml is now imported from ./scraping/httpClient (top of file)
// It provides: User-Agent rotation, retry with backoff, Cloudflare detection,
// and a pluggable proxy interface for Phase 3.

// ─── WEBVTT Parser ────────────────────────────────────────────────────────────
// parseWebVTT / downloadWebVTT / downloadAndParseSubtitle moved verbatim to
// scraping/tiktok/transcriptStrategies.ts (transcript-reliability session) and
// are imported at the top of this file where still needed.

// ─── TikTok Transcript Fetcher — Multi-Path System ────────────────────────────

/**
 * Multi-path transcript extraction for a single TikTok video.
 *
 * Transcript-reliability session: the path bodies now live as named strategies in
 * scraping/tiktok/transcriptStrategies.ts (subtitle_http = Path A,
 * subtitle_browser = Path B+C as one unit, caption_fallback = Path E; a future
 * STT path implements the same interface). This wrapper keeps the historical
 * signature for callers and owns only the entry enrichment. Strategy order and
 * effective behavior are identical to the pre-refactor multipath; every attempt
 * now emits one scrape_event (the formerly-invisible browser stretch included).
 */
async function fetchVideoTranscriptMultiPath(
  handle: string,
  videoId: string,
  caption: string,
  bucket: SampleBucket = "recent",
  createTime?: number,
  metadata?: { musicTitle?: string; musicOriginal?: boolean; duetEnabled?: boolean; stitchEnabled?: boolean; durationMs?: number; collaborations?: string[] },
  /** Shared Playwright context — reused across the batch to avoid one browser tab per video */
  sharedCtx?: { context: Awaited<ReturnType<typeof getContext>>["context"]; page?: null },
  /** Shared per-batch phase state (budgets + early-bail); a fresh unlimited phase when absent. */
  phase?: TranscriptPhase,
): Promise<TranscriptEntry | null> {
  const videoUrl = `https://www.tiktok.com/@${handle}/video/${videoId}`;

  function enrichEntry(entry: TranscriptEntry): TranscriptEntry {
    if (metadata?.musicTitle) entry.musicMetadata = { soundName: metadata.musicTitle, isOriginal: metadata.musicOriginal };
    if (metadata?.duetEnabled || metadata?.stitchEnabled) entry.remixMetadata = { duetCount: 0, stitchCount: 0 };
    if (metadata?.durationMs) entry.videoDuration = Math.round(metadata.durationMs / 1000);
    if (metadata?.collaborations?.length) entry.collaborations = metadata.collaborations;
    return entry;
  }

  // C2: the approved production budgets are active (per-video caps via the
  // strategy list, phase deadline + early-bail via the shared batch phase).
  const hit = await fetchVideoTranscript(
    { handle, videoId, videoUrl, caption, sharedContext: sharedCtx?.context },
    budgetedTranscriptStrategies(),
    phase ?? budgetedTranscriptPhase(),
  );

  if (!hit) {
    console.log(`[transcript] ${videoId}: all paths exhausted (caption: ${caption?.length ?? 0} chars)`);
    return null;
  }

  const t = hit.result.transcript;
  return enrichEntry({
    videoId, videoUrl, caption,
    transcript: t.text, wordCount: t.wordCount,
    bucket, createTime, transcriptSource: t.source,
  });
}

/**
 * Main TikTok transcript pipeline:
 * 1. Search TikTok for the creator's handle (count as STRING '20')
 * 2. Author-filter results to only keep the target creator's videos
 * 3. Fetch transcript for each video
 * 4. Return all successful transcripts
 */
// ─── Computed Engagement Signals ─────────────────────────────────────────────

export interface EngagementSignals {
  // Per-video rate averages (0.0–1.0 fractions, multiply by 100 for %)
  avgCommentRate: number;    // comments / plays
  avgSaveRate: number;       // saves / plays
  avgShareRate: number;      // shares / plays
  avgLikeRate: number;       // likes / plays (true engagement rate)
  // Content production signals
  originalAudioRate: number; // fraction of videos with creator-original audio
  remixEnablementRate: number; // fraction with duet OR stitch enabled
  adTagRate: number;         // fraction tagged as ads
  avgDurationSeconds: number; // average video duration in seconds
  // Temporal buckets
  recentVideos: TemporalVideoEntry[];   // < 3 months old
  midVideos: TemporalVideoEntry[];      // 3–12 months old
  olderVideos: TemporalVideoEntry[];    // > 12 months old
  totalSampled: number;
}

export interface TemporalVideoEntry {
  caption: string;
  dateStr: string;   // YYYY-MM-DD
  views: number;
  likes: number;
  comments: number;
  saves: number;
}

/**
 * Fetch videos from the TikTok API (PRIMARY SOURCE).
 * Uses TikTok/get_user_post_list to fetch the full list of creator's videos.
 * Returns array of VideoItem objects with full metadata.
 */
export async function fetchTikTokVideosFromAPI(
  handle: string,
  prefetchedProfile?: Awaited<ReturnType<typeof scrapeTikTokProfile>>,
): Promise<{ items: Array<{
  id: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  createTime: number;
  musicOriginal: boolean;
  musicTitle: string;
  musicArtist: string;
  duetEnabled: boolean;
  stitchEnabled: boolean;
  isAd: boolean;
  durationMs: number;
}>; rejected: number }> {
  let rejected = 0;
  const items: Array<{
    id: string;
    caption: string;
    views: number;
    likes: number;
    comments: number;
    saves: number;
    shares: number;
    createTime: number;
    musicOriginal: boolean;
    musicTitle: string;
    musicArtist: string;
    duetEnabled: boolean;
    stitchEnabled: boolean;
    isAd: boolean;
    durationMs: number;
  }> = [];

  try {
    // Combined profile scrape gets user info + video list via XHR interception.
    // Session 11 (Commit 1): reuse the profile the caller (researchTikTokCreator
    // Step 1) already scraped instead of scraping the same page a second time
    // (~30-45s of duplicate Playwright work). Standalone callers pass nothing →
    // self-fetch, unchanged.
    const profileResult = prefetchedProfile ?? await scrapeTikTokProfile(handle);

    const userInfoData = profileResult.userInfo?.userInfo ?? {} as Record<string, unknown>;
    const user = userInfoData?.user ?? {} as Record<string, unknown>;
    const secUid = user?.secUid ?? "";

    if (!secUid) {
      console.log(`[webResearch] @${handle}: could not get secUid from user info`);
      return { items, rejected };
    }

    // Get video list from the combined profile scrape
    const itemList = profileResult.posts?.data?.itemList ?? [];

    console.log(`[webResearch] @${handle}: API fetch found ${itemList.length} videos`);

    for (const item of itemList) {
      const videoId = item.id ?? "";
      if (!videoId) continue;

      // Session 10 (1b): every item must pass the shared author guard before it
      // enters the pool — fail closed. The narrowed XHR match (1a) is the primary
      // defense; this rejects any residual foreign / author-less item.
      if (!isAuthorMatch(handle, item.author?.uniqueId)) { rejected++; continue; }

      items.push({
        id: videoId,
        caption: item.desc ?? "",
        views: Number(item.stats?.playCount ?? 0),
        likes: Number(item.stats?.diggCount ?? 0),
        comments: Number(item.stats?.commentCount ?? 0),
        saves: Number(item.stats?.collectCount ?? 0),
        shares: Number(item.stats?.shareCount ?? 0),
        createTime: Number(item.createTime ?? 0),
        musicOriginal: Boolean(item.music?.original ?? false),
        musicTitle: String(item.music?.title ?? ""),
        musicArtist: String(item.music?.authorName ?? ""),
        duetEnabled: Boolean(item.duetEnabled ?? false),
        stitchEnabled: Boolean(item.stitchEnabled ?? false),
        isAd: Boolean(item.isAd ?? false),
        durationMs: tiktokDurationToMs(Number(item.video?.duration ?? 0)),
      });
    }
  } catch (err) {
    console.warn(`[webResearch] @${handle}: API fetch failed:`, (err as Error).message);
  }

  return { items, rejected };
}

// ─── Pool collection & sampling stages (phased architecture S2 decomposition) ─
//
// The transcript orchestrator used to fuse four jobs in one function body:
// API pool collection, supplemental search, 6-3-3 sampling, and per-video
// transcription. They are separate PHASES in the target architecture (search is
// `augment`, the rest is `transcribe`), so the orchestration is taken apart
// here — as its own step, before any phase conversion depends on it.
//
// The statements inside each stage are moved VERBATIM. The only change is that
// the shared accumulators, which used to be closure variables, are now passed
// explicitly in a PoolAccumulator. Same objects, same mutation order, same
// dedup and author-guard behavior — the ordering of videoTitles / viewCounts /
// hashtags feeds downstream evidence, so it must not drift by a single entry.
//
// NOTE for reviewers: the identity harness does NOT cover this split — it
// starts from banked evidence, downstream of collection. The real proof for
// this commit is the live-run comparison plus the sampler unit tests below.

/** One collected video with the full engagement snapshot temporal analysis needs. */
export interface PoolVideoItem {
  id: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  createTime: number;      // Unix timestamp (seconds)
  musicOriginal: boolean;  // true = creator made original audio
  musicTitle: string;      // Session 7: carried through to content_items (J-4)
  musicArtist: string;
  duetEnabled: boolean;
  stitchEnabled: boolean;
  isAd: boolean;
  durationMs: number;      // video duration in milliseconds
}

/** Shared mutable state the collection stages accumulate into (was closure vars). */
interface PoolAccumulator {
  videoItems: PoolVideoItem[];
  seen: Set<string>;
  viewCounts: number[];
  videoTitles: string[];
  hashtags: string[];
  musicTitles: string[];
  foreignVideosRejected: number;
  searchQuotaExhausted: boolean;
  apiVideoCount: number;
  /**
   * Opt-in raw-payload sink for the collection-fixture refresh
   * (WOMO_COLLECTION_FIXTURE). Seeded by the augment phase; absent in normal
   * operation, when not a single extra object is allocated.
   */
  rawCapture?: { searchResponses: Array<{ query: string; items: unknown[] }> };
}

/**
 * Snapshot the accumulator at a stage boundary. ORDER IS THE POINT: the id
 * sequence, title order and view-count order are what decide which videos the
 * 6-3-3 sampler picks, so the harness compares these arrays element-for-element.
 */
export function snapshotPool(acc: {
  videoItems: PoolVideoItem[]; viewCounts: number[]; videoTitles: string[];
  hashtags: string[]; musicTitles: string[]; foreignVideosRejected: number;
}): {
  videoIds: string[]; videoItems: PoolVideoItem[]; viewCounts: number[];
  videoTitles: string[]; hashtags: string[]; musicTitles: string[];
  foreignVideosRejected: number;
} {
  return {
    videoIds: acc.videoItems.map(v => v.id),
    videoItems: acc.videoItems.map(v => ({ ...v })),
    viewCounts: [...acc.viewCounts],
    videoTitles: [...acc.videoTitles],
    hashtags: [...acc.hashtags],
    musicTitles: [...acc.musicTitles],
    foreignVideosRejected: acc.foreignVideosRejected,
  };
}


function isQuotaErrMsg(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("usage exhausted") || msg.includes("quota") || msg.includes("rate limit") || msg.includes("too many requests");
}

/** Stage 1 — PRIMARY SOURCE: TikTok API (get_user_post_list). Exported for the
 *  collection harness, which replays it from a fixture prefetchedProfile (with
 *  a prefetched profile this stage touches no network). */
export async function collectPoolFromApi(
  handle: string,
  prefetchedProfile: Awaited<ReturnType<typeof scrapeTikTokProfile>> | undefined,
  acc: PoolAccumulator,
): Promise<void> {
  // Session 10: the API path now author-guards each item and returns the count
  // of foreign / author-less items it rejected. Track the run total so it can be
  // surfaced in the Run diagnostics ("N videos excluded — author mismatch").
  const { items: apiVideos, rejected: apiRejectedForeign } = await fetchTikTokVideosFromAPI(handle, prefetchedProfile);
  acc.foreignVideosRejected += apiRejectedForeign;
  for (const v of apiVideos) {
    if (!acc.seen.has(v.id)) {
      acc.seen.add(v.id);
      acc.videoItems.push(v);
      if (v.views > 0) acc.viewCounts.push(v.views);
      if (v.caption) acc.videoTitles.push(v.caption);
    }
  }
  acc.apiVideoCount = apiVideos.length;

  console.log(`[webResearch] @${handle}: API fetch yielded ${apiVideos.length} videos`);
}

/** Stage 2 — SUPPLEMENTAL SOURCE: multi-query TikTok search (the `augment`
 *  phase). Exported for the collection harness, which replays it with the
 *  search leaf mocked to return recorded raw payloads. */
export async function collectPoolFromSupplementalSearch(
  handle: string,
  normalizedHandle: string,
  acc: PoolAccumulator,
): Promise<void> {
  // Uses dot-stripped handle variant to work around TikTok search tokenisation
  const noDot = handle.replace(/\./g, "");
  const queries = [
    handle,          // kaylee.nhi
    `@${handle}`,    // @kaylee.nhi
    noDot,           // kayleenhi
    `@${noDot}`,     // @kayleenhi
  ];

  // Session 11 (Commit 2): the 4 handle-variant search queries used to run
  // strictly sequentially (~65s — each is a full Playwright search: warm + nav +
  // scroll + XHR capture). Fetch them with bounded concurrency (2 at a time) over
  // ONE dedicated shared context, then MERGE sequentially in query order so the
  // author guard + dedup stay byte-identical to the old path. Bounded at 2 (not
  // 4) to respect the tiktok request governor's human-pattern spacing and cap
  // simultaneous hits; the single shared context avoids the retire race (Part 0.2).
  const searchLimit = pLimit(2);
  let searchCtx: Awaited<ReturnType<typeof getContext>> | null = null;
  try {
    searchCtx = await getContext("desktop-chrome");
  } catch (err) {
    console.warn(`[webResearch] @${handle}: could not acquire shared search context (queries will self-manage):`, (err as Error).message);
  }

  const rawSearchResults = await Promise.all(
    queries.map((q) =>
      searchLimit(async () => {
        try {
          const result = await searchTikTokVideos(q, undefined, searchCtx?.context) as unknown as Record<string, unknown>;
          const items = (result?.item_list as unknown[]) ?? [];
          console.log(`[webResearch] TikTok search "${q}" (fallback): ${items.length} results`);
          return { q, items, error: null as unknown };
        } catch (err) {
          return { q, items: [] as unknown[], error: err as unknown };
        }
      })
    )
  );

  // The shared search context is done — close it once (never per-query).
  if (searchCtx) {
    try { await retireContext(searchCtx.context); } catch { /* ignore */ }
  }

  // Opt-in raw capture for the collection harness — records exactly what the
  // platform returned, before any processing, so the harness can replay it.
  if (acc.rawCapture) {
    for (const { q, items } of rawSearchResults) {
      acc.rawCapture.searchResponses.push({ query: q, items });
    }
  }

  // Sequential merge in query order — identical processing to the old loop.
  for (const { q, items, error } of rawSearchResults) {
    if (error) {
      if (isQuotaErrMsg(error)) acc.searchQuotaExhausted = true;
      console.warn(`[webResearch] TikTok search "${q}" (supplemental) failed:`, error);
      continue;
    }
      for (const item of items) {
        const v = item as Record<string, unknown>;

        // Session 10 (1c): shared author guard — FAIL CLOSED. The old check used
        // normalizedHandle.includes(authorNorm) (true for an empty author) plus
        // an `authorId !== ""` escape, so foreign / author-less search results
        // were accepted. Now a video is kept only if its author verifiably IS
        // this creator; missing/empty/foreign authors are rejected and counted.
        const author = (v?.author as Record<string, unknown>) ?? {};
        const authorId = (author?.uniqueId as string) ?? (author?.unique_id as string) ?? "";
        if (!isAuthorMatch(handle, authorId)) {
          acc.foreignVideosRejected++;
          continue;
        }

        const videoId = (v?.id as string) ?? ((v?.video as Record<string, unknown>)?.id as string) ?? "";
        if (!videoId || acc.seen.has(videoId)) continue;
        acc.seen.add(videoId);

        const desc = (v?.desc as string) ?? "";
        const statsObj = (v?.stats as Record<string, unknown>) ?? (v?.statistics as Record<string, unknown>) ?? {};
        const views = Number(statsObj?.playCount ?? statsObj?.play_count ?? 0);
        const likes = Number(statsObj?.diggCount ?? statsObj?.digg_count ?? 0);
        const comments = Number(statsObj?.commentCount ?? statsObj?.comment_count ?? 0);
        const saves = Number(statsObj?.collectCount ?? statsObj?.collect_count ?? 0);
        const shares = Number(statsObj?.shareCount ?? statsObj?.share_count ?? 0);
        const createTime = Number(v?.createTime ?? v?.create_time ?? 0);

        // Music signals
        const music = (v?.music as Record<string, unknown>) ?? {};
        const musicTitle = (music?.title as string) ?? "";
        const musicAuthor = (music?.authorName as string) ?? "";
        const musicOriginal = Boolean(music?.original ?? false);
        if (musicTitle && !musicTitle.startsWith("original sound") && musicTitle.length > 3) {
          if (!acc.musicTitles.includes(musicTitle)) acc.musicTitles.push(musicTitle);
        }
        if (musicTitle.startsWith("original sound") && normalizeHandle(musicAuthor) === normalizedHandle) {
          if (!acc.musicTitles.includes(`[original audio by @${handle}]`)) {
            acc.musicTitles.push(`[original audio by @${handle}]`);
          }
        }

        // Interaction flags
        const duetEnabled = Boolean(v?.duetEnabled ?? v?.duet_enabled ?? false);
        const stitchEnabled = Boolean(v?.stitchEnabled ?? v?.stitch_enabled ?? false);
        const isAd = Boolean(v?.isAd ?? v?.is_ad ?? false);
        const videoObj = (v?.video as Record<string, unknown>) ?? {};
        const durationMs = tiktokDurationToMs(Number(videoObj?.duration ?? 0));

        // Collect hashtags from challenges and textExtra
        const challenges = (v?.challenges as Array<Record<string, unknown>>) ?? [];
        for (const c of challenges) {
          const tagName = (c?.title as string) ?? (c?.name as string) ?? "";
          if (tagName) acc.hashtags.push(`#${tagName}`);
        }
        const textExtra = (v?.textExtra as Array<Record<string, unknown>>) ?? (v?.text_extra as Array<Record<string, unknown>>) ?? [];
        for (const tag of textExtra) {
          const tagName = (tag?.hashtagName as string) ?? (tag?.hashtag_name as string) ?? "";
          if (tagName) acc.hashtags.push(`#${tagName}`);
        }
        if (desc) {
          const inlineTags = desc.match(/#([a-zA-Z0-9_]+)/g) ?? [];
          acc.hashtags.push(...inlineTags);
        }

        if (views > 0) acc.viewCounts.push(views);
        if (desc) acc.videoTitles.push(desc);

        acc.videoItems.push({
          id: videoId, caption: desc, views, likes, comments, saves, shares,
          createTime, musicOriginal, musicTitle, musicArtist: musicAuthor,
          duetEnabled, stitchEnabled, isAd, durationMs,
        });
      }
  }
}

/**
 * Stage 3 — the 6-3-3 stratified sampler. FROZEN selection logic, moved
 * verbatim; exported so it can be unit-tested in isolation for the first time
 * (the identity harness cannot reach it).
 *
 * `nowSec` is injectable purely so tests can pin the temporal windows; the
 * production caller passes nothing and gets Date.now() exactly as before.
 */
export function selectLongitudinalSample(
  handle: string,
  videoItems: PoolVideoItem[],
  nowSec?: number,
): { sampledVideos: Array<{ item: PoolVideoItem; bucket: "recent" | "mid" | "anchor" }> } {
  const nowSec2 = nowSec ?? Math.floor(Date.now() / 1000);
  const nineMonthsSec = 270 * 24 * 3600;  // ~9 months
  const eighteenMonthsSec = 540 * 24 * 3600; // ~18 months
  void nineMonthsSec; // retained: documents the window the mid bucket targets

  // Sort by createTime descending (newest first)
  const sortedVideos = [...videoItems].sort((a, b) => b.createTime - a.createTime);

  // Bucket 1: 6 most recent videos
  const recentBucket = sortedVideos.filter(v => v.createTime > 0).slice(0, 6);

  // Bucket 2: 3 videos from ~9 months ago (6–12 months window)
  const sixMonthsSec = 180 * 24 * 3600;
  const midCandidates = sortedVideos.filter(v => {
    const age = nowSec2 - v.createTime;
    return v.createTime > 0 && age >= sixMonthsSec && age < eighteenMonthsSec;
  });
  // Pick 3 evenly spaced from the mid window
  const midBucket: PoolVideoItem[] = [];
  if (midCandidates.length > 0) {
    const step = Math.max(1, Math.floor(midCandidates.length / 3));
    for (let i = 0; i < midCandidates.length && midBucket.length < 3; i += step) {
      midBucket.push(midCandidates[i]);
    }
    // If we didn't get 3, fill from the end
    for (let i = midCandidates.length - 1; midBucket.length < 3 && i >= 0; i--) {
      if (!midBucket.includes(midCandidates[i])) midBucket.push(midCandidates[i]);
    }
  }

  // Bucket 3: 3 "Anchor" videos from ~18 months ago (12–24 months window)
  const anchorCandidates = sortedVideos.filter(v => {
    const age = nowSec2 - v.createTime;
    return v.createTime > 0 && age >= eighteenMonthsSec;
  });
  const anchorBucket: PoolVideoItem[] = [];
  if (anchorCandidates.length > 0) {
    const step = Math.max(1, Math.floor(anchorCandidates.length / 3));
    for (let i = 0; i < anchorCandidates.length && anchorBucket.length < 3; i += step) {
      anchorBucket.push(anchorCandidates[i]);
    }
    for (let i = anchorCandidates.length - 1; anchorBucket.length < 3 && i >= 0; i--) {
      if (!anchorBucket.includes(anchorCandidates[i])) anchorBucket.push(anchorCandidates[i]);
    }
  }

  // ─── Fill-forward fallback: if mid or anchor buckets are short, fill from oldest available ──
  // Build a pool of videos NOT already in the recent bucket, sorted oldest-first
  const recentIds = new Set(recentBucket.map(v => v.id));
  const remainingOldestFirst = sortedVideos
    .filter(v => v.createTime > 0 && !recentIds.has(v.id))
    .reverse(); // oldest first

  // Fill mid bucket to 3 using oldest available if needed
  const midFallback = midBucket.length < 3;
  if (midFallback) {
    const midIds = new Set(midBucket.map(v => v.id));
    for (const v of remainingOldestFirst) {
      if (midBucket.length >= 3) break;
      if (!midIds.has(v.id) && !recentIds.has(v.id)) {
        midBucket.push(v);
        midIds.add(v.id);
      }
    }
    if (midBucket.length > midCandidates.length) {
      console.log(`[webResearch] @${handle}: mid bucket filled via fallback (${midBucket.length - midCandidates.length} oldest-available videos added)`);
    }
  }

  // Fill anchor bucket to 3 using oldest available if needed (excluding recent + mid)
  const anchorFallback = anchorBucket.length < 3;
  if (anchorFallback) {
    const midAndRecentIds = new Set([...recentBucket, ...midBucket].map(v => v.id));
    const anchorIds = new Set(anchorBucket.map(v => v.id));
    for (const v of remainingOldestFirst) {
      if (anchorBucket.length >= 3) break;
      if (!anchorIds.has(v.id) && !midAndRecentIds.has(v.id)) {
        anchorBucket.push(v);
        anchorIds.add(v.id);
      }
    }
    if (anchorBucket.length > anchorCandidates.length) {
      console.log(`[webResearch] @${handle}: anchor bucket filled via fallback (${anchorBucket.length - anchorCandidates.length} oldest-available videos added)`);
    }
  }

  // Combine the 12 sampled videos (deduplicated)
  const bucketedIds = new Set<string>();
  const sampledVideos: Array<{ item: PoolVideoItem; bucket: "recent" | "mid" | "anchor" }> = [];
  for (const v of recentBucket) {
    if (!bucketedIds.has(v.id)) { bucketedIds.add(v.id); sampledVideos.push({ item: v, bucket: "recent" }); }
  }
  for (const v of midBucket) {
    if (!bucketedIds.has(v.id)) { bucketedIds.add(v.id); sampledVideos.push({ item: v, bucket: "mid" }); }
  }
  for (const v of anchorBucket) {
    if (!bucketedIds.has(v.id)) { bucketedIds.add(v.id); sampledVideos.push({ item: v, bucket: "anchor" }); }
  }

  const midUsedFallback = midFallback && midBucket.length > midCandidates.length;
  const anchorUsedFallback = anchorFallback && anchorBucket.length > anchorCandidates.length;
  console.log(`[webResearch] @${handle}: 6-3-3 sample — recent=${recentBucket.length}, mid=${midBucket.length}${midUsedFallback ? "(+fallback)" : ""}, anchor=${anchorBucket.length}${anchorUsedFallback ? "(+fallback)" : ""} → ${sampledVideos.length} total`);

  return { sampledVideos };
}

/**
 * Per-video transcription over the 6-3-3 sample (phased architecture S2,
 * Part 2). Body moved VERBATIM out of the orchestrator; transcriptStrategies
 * and its budgets/early-bail are called, never modified.
 *
 * Exported so the transcribe phase unit owns it and the collection harness can
 * replay it with the transcript leaf mocked (boundary 4).
 */
export async function transcribeSampledVideos(
  handle: string,
  sampledVideos: Array<{ item: PoolVideoItem; bucket: SampleBucket }>,
): Promise<TranscriptEntry[]> {
  const transcripts: TranscriptEntry[] = [];
  // Fetch transcripts for the 12 sampled videos using p-limit concurrency
  const transcriptLimit = pLimit(3);
  // One shared phase for the whole batch: budgets + early-bail state common to
  // the pLimit(3) workers. C2: the approved production budgets are active
  // (phase 120s, early-bail after 4 consecutive subtitle-less browser results).
  const transcriptPhase = budgetedTranscriptPhase();
  // Acquire a shared Playwright context for all videos in this batch
  let sharedCtx: Awaited<ReturnType<typeof getContext>> | null = null;
  try {
    sharedCtx = await getContext("desktop-chrome");
  } catch (err) {
    console.warn(`[transcript] Failed to acquire Playwright context — will use per-video fallback:`, (err as Error).message);
  }

  const transcriptPromises = sampledVideos.map(({ item, bucket }) =>
    transcriptLimit(async () => {
      const collaborations = (item.caption.match(/@[a-zA-Z0-9_.]+/g) ?? []).map(m => m.slice(1));
      try {
        return await fetchVideoTranscriptMultiPath(handle, item.id, item.caption, bucket, item.createTime, {
          // Session 7: musicTitle is now a real VideoItem field (was an
          // undefined any-cast) — transcript entries get musicMetadata.soundName
          musicTitle: item.musicTitle || undefined,
          musicOriginal: item.musicOriginal,
          duetEnabled: item.duetEnabled,
          stitchEnabled: item.stitchEnabled,
          durationMs: item.durationMs,
          collaborations: collaborations.length > 0 ? collaborations : undefined,
        }, sharedCtx ? { context: sharedCtx.context } : undefined, transcriptPhase);
      } catch (err) {
        console.warn(`[transcript] ${item.id}: unexpected error: ${(err as Error).message}`);
        return null;
      }
    })
  );

  const transcriptResults = await Promise.allSettled(transcriptPromises);
  for (const r of transcriptResults) {
    if (r.status === "fulfilled" && r.value) {
      transcripts.push(r.value);
    }
  }


  // Clean up shared context after batch is done
  if (sharedCtx) {
    try { await retireContext(sharedCtx.context); } catch { /* ignore */ }
  }

  console.log(`[webResearch] @${handle}: ${transcripts.length} transcripts fetched out of ${sampledVideos.length} sampled videos`);

  return transcripts;
}

/**
 * Per-reel transcription for Instagram (S4).
 *
 * ─── What this is ───────────────────────────────────────────────────────────
 * The body was INLINE in researchInstagramCreator. Extracted, not rewritten, so
 * the Instagram TranscribeTool can call it exactly as TikTok's tool calls
 * transcribeSampledVideos. The behaviour is unchanged: batches of 3 over ONE
 * Playwright context (its cookies are what make the CDN download work at all),
 * stop once 5 transcripts land, skip reels with no video_url, skip files under
 * 10KB, and require at least 10 characters of text before accepting a result.
 *
 * Instagram has no subtitle track to read, so this is speech-to-text over the
 * downloaded audio — hence TRANSCRIPT_SOURCE.speechToText. That classification
 * is FROZEN and is the reason the same transcript count means something
 * different here than it does on TikTok.
 */
export async function transcribeInstagramReels(
  handle: string,
  sampled: Array<{ item: PoolVideoItem; bucket: SampleBucket }>,
  videoUrlById: Map<string, string>,
): Promise<TranscriptEntry[]> {
  const transcripts: TranscriptEntry[] = [];
  if (sampled.length === 0) return transcripts;

  const { getContext } = await import("./scraping/browserClient");
  const { requestGovernor } = await import("./scraping/httpClient");

  let dlCtx: Awaited<ReturnType<typeof getContext>> | null = null;
  try {
    await requestGovernor("instagram");
    dlCtx = await getContext("mobile-ios", 10);
    const { context: browserCtx } = dlCtx;

    const batchSize = 3;
    for (let i = 0; i < sampled.length && transcripts.length < 5; i += batchSize) {
      const batch = sampled.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(async ({ item, bucket }) => {
          const videoUrl = videoUrlById.get(item.id);
          if (!videoUrl) {
            console.log(`[webResearch] Instagram reel ${item.id}: no video_url — skipping`);
            return null;
          }
          try {
            console.log(`[webResearch] Instagram reel ${item.id}: downloading via context.request...`);
            const dlStart = Date.now();
            const dlRes = await browserCtx.request.get(videoUrl, {
              timeout: 20000,
              headers: { "Accept": "*/*", "Referer": "https://www.instagram.com/" },
            });

            if (!dlRes.ok()) {
              console.log(`[webResearch] Instagram reel ${item.id}: download failed — HTTP ${dlRes.status()}`);
              recordScrapeEvent({
                platform: "instagram", scrapeMethod: "instagram_playwright",
                urlRequested: videoUrl.slice(0, 1000), httpStatus: dlRes.status(),
                failureReason: `reel video download failed — HTTP ${dlRes.status()}`,
                durationMs: Date.now() - dlStart,
              });
              return null;
            }

            const audioBuffer = Buffer.from(await dlRes.body());
            const mimeType = dlRes.headers()["content-type"] || "video/mp4";
            const sizeMB = audioBuffer.length / (1024 * 1024);
            console.log(`[webResearch] Instagram reel ${item.id}: downloaded ${sizeMB.toFixed(1)}MB`);
            recordScrapeEvent({
              platform: "instagram", scrapeMethod: "instagram_playwright",
              urlRequested: videoUrl.slice(0, 1000), httpStatus: dlRes.status(),
              responseSizeBytes: audioBuffer.length, durationMs: Date.now() - dlStart,
            });

            if (sizeMB < 0.01) {
              console.log(`[webResearch] Instagram reel ${item.id}: file too small — skipping`);
              return null;
            }

            const transcribeStart = Date.now();
            const result = await transcribeAudio({
              audioUrl: videoUrl,
              language: "en",
              audioBuffer,
              mimeType: mimeType.includes("video") ? "video/mp4" : mimeType,
            });

            if (result && !("error" in result) && result.text && result.text.length >= 10) {
              const wordCount = result.text.split(/\s+/).length;
              console.log(`[webResearch] ✅ Instagram reel ${item.id}: ${wordCount} words transcribed`);
              // S4 instrumentation parity: one event per transcription ATTEMPT,
              // success or failure, so the next failure taxonomy can see this
              // path at all. TikTok has emitted these since the reliability
              // session; Instagram's transcription leg emitted nothing.
              recordScrapeEvent({
                platform: "instagram", scrapeMethod: "whisper_transcription",
                urlRequested: `instagram:reel:${item.id}#transcribe=speech:success`,
                durationMs: Date.now() - transcribeStart,
              });
              return {
                videoId: item.id,
                videoUrl: `https://www.instagram.com/p/${item.id}/`,
                caption: item.caption.slice(0, 100),
                transcript: result.text.trim(),
                wordCount,
                transcriptSource: TRANSCRIPT_SOURCE.speechToText,
                // Carry the sampler's own verdict. A NULL temporal_bucket means
                // "not in the sample" for TikTok; without this, a sampled
                // Instagram reel would be indistinguishable from an unsampled
                // one, which is the ambiguity `unbucketed` exists to remove.
                bucket,
              } as TranscriptEntry;
            }

            const errDetail = result && "error" in result
              ? `${(result as { error: string; details?: string }).error}: ${(result as { details?: string }).details ?? ""}`
              : "empty/short text";
            console.log(`[webResearch] Instagram reel ${item.id}: transcription failed — ${errDetail}`);
            recordScrapeEvent({
              platform: "instagram", scrapeMethod: "whisper_transcription",
              urlRequested: `instagram:reel:${item.id}#transcribe=speech`,
              failureReason: `transcript speech: ${errDetail}`.slice(0, 500),
              durationMs: Date.now() - transcribeStart,
            });
            return null;
          } catch (err) {
            console.log(`[webResearch] Instagram reel ${item.id}: download/transcribe error — ${(err as Error).message}`);
            recordScrapeEvent({
              platform: "instagram", scrapeMethod: "whisper_transcription",
              urlRequested: `instagram:reel:${item.id}#transcribe=speech`,
              failureReason: `transcript speech: ${(err as Error).message}`.slice(0, 500),
            });
            return null;
          }
        })
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled" && result.value) transcripts.push(result.value);
      }
    }

    try { await dlCtx.page.close(); } catch { /* */ }
  } catch (err) {
    console.log(`[webResearch] Instagram @${handle}: transcript batch failed — ${(err as Error).message}`);
    if (dlCtx) { try { await dlCtx.page.close(); } catch { /* */ } }
  }

  console.log(`[webResearch] Instagram @${handle}: ${transcripts.length} transcripts from ${sampled.length} sampled reels`);
  return transcripts;
}

/**
 * Engagement signals + LongitudinalSample + discoveredVideoPool, assembled
 * from the collected pool and the fetched transcripts. Body moved VERBATIM;
 * the cultural-velocity heuristic and the 6-3-3 membership stamping are
 * FROZEN interpretation and are called, not changed.
 */
export function assembleTranscribeOutputs(
  handle: string,
  videoItems: PoolVideoItem[],
  transcripts: TranscriptEntry[],
  sampledVideos: Array<{ item: PoolVideoItem; bucket: SampleBucket }>,
): {
  engagementSignals: EngagementSignals;
  longitudinalSample: LongitudinalSample;
  discoveredVideoPool: NonNullable<CreatorResearchResult["discoveredVideoPool"]>;
} {
  // ─── Compute engagement signals from all collected videoItems ───────────────
  const nowSec = Math.floor(Date.now() / 1000);
  const threeMonthsSec = 90 * 24 * 3600;
  const twelveMonthsSec = 365 * 24 * 3600;

  const recentVideos: TemporalVideoEntry[] = [];
  const midVideos: TemporalVideoEntry[] = [];
  const olderVideos: TemporalVideoEntry[] = [];

  let sumCommentRate = 0, sumSaveRate = 0, sumShareRate = 0, sumLikeRate = 0;
  let sumOriginalAudio = 0, sumRemixEnabled = 0, sumIsAd = 0, sumDurationSec = 0;
  let rateCount = 0;

  for (const vi of videoItems) {
    const entry: TemporalVideoEntry = {
      caption: vi.caption.slice(0, 80) || "(no caption)",
      dateStr: vi.createTime > 0 ? new Date(vi.createTime * 1000).toISOString().slice(0, 10) : "unknown",
      views: vi.views, likes: vi.likes, comments: vi.comments, saves: vi.saves,
    };
    if (vi.createTime > 0) {
      const ageSec = nowSec - vi.createTime;
      if (ageSec < threeMonthsSec) recentVideos.push(entry);
      else if (ageSec < twelveMonthsSec) midVideos.push(entry);
      else olderVideos.push(entry);
    }

    if (vi.views > 0) {
      sumCommentRate += vi.comments / vi.views;
      sumSaveRate += vi.saves / vi.views;
      sumShareRate += vi.shares / vi.views;
      sumLikeRate += vi.likes / vi.views;
      rateCount++;
    }
    sumOriginalAudio += vi.musicOriginal ? 1 : 0;
    sumRemixEnabled += (vi.duetEnabled || vi.stitchEnabled) ? 1 : 0;
    sumIsAd += vi.isAd ? 1 : 0;
    sumDurationSec += vi.durationMs > 0 ? vi.durationMs / 1000 : 0;
  }

  const n = videoItems.length || 1;
  const engagementSignals: EngagementSignals = {
    avgCommentRate: rateCount > 0 ? sumCommentRate / rateCount : 0,
    avgSaveRate: rateCount > 0 ? sumSaveRate / rateCount : 0,
    avgShareRate: rateCount > 0 ? sumShareRate / rateCount : 0,
    avgLikeRate: rateCount > 0 ? sumLikeRate / rateCount : 0,
    originalAudioRate: sumOriginalAudio / n,
    remixEnablementRate: sumRemixEnabled / n,
    adTagRate: sumIsAd / n,
    avgDurationSeconds: sumDurationSec / n,
    recentVideos, midVideos, olderVideos,
    totalSampled: videoItems.length,
  };

  console.log(`[webResearch] @${handle} engagement signals: commentRate=${(engagementSignals.avgCommentRate * 100).toFixed(3)}% saveRate=${(engagementSignals.avgSaveRate * 100).toFixed(3)}% originalAudio=${(engagementSignals.originalAudioRate * 100).toFixed(0)}%`);

  // ─── Assemble LongitudinalSample from 6-3-3 transcripts ─────────────────────────────
  const longitudinalRecent = transcripts.filter(t => t.bucket === "recent");
  const longitudinalMid = transcripts.filter(t => t.bucket === "mid");
  const longitudinalAnchor = transcripts.filter(t => t.bucket === "anchor");
  const totalFetched = transcripts.length;
  const completeness: LongitudinalSample["completeness"] =
    totalFetched >= 12 ? "full" :
      totalFetched >= 6 ? "partial" :
        "insufficient";

  // Cultural velocity: compare theme consistency across buckets
  // "Focusing" = themes are consistent across time; "Drifting" = themes diverge
  let culturalVelocity: LongitudinalSample["culturalVelocity"] = "Insufficient Data";
  if (longitudinalRecent.length > 0 && (longitudinalMid.length > 0 || longitudinalAnchor.length > 0)) {
    const recentText = longitudinalRecent.map(t => t.transcript).join(" ").toLowerCase();
    const historicText = [...longitudinalMid, ...longitudinalAnchor].map(t => t.transcript).join(" ").toLowerCase();
    // Extract top 10 words from each period and measure overlap
    const topWords = (text: string): Set<string> => {
      const counts: Record<string, number> = {};
      const matches = text.match(/\b[a-z]{4,}\b/g) ?? [];
      for (const w of matches) counts[w] = (counts[w] ?? 0) + 1;
      return new Set(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([w]) => w));
    };
    const recentWords = topWords(recentText);
    const historicWords = topWords(historicText);
    const overlap = Array.from(recentWords).filter(w => historicWords.has(w)).length;
    // If >50% of top words overlap across time periods, creator is "Focusing"
    culturalVelocity = overlap >= 10 ? "Focusing" : "Drifting";
    console.log(`[webResearch] @${handle} cultural velocity: ${culturalVelocity} (${overlap}/20 word overlap)`);
  }

  const longitudinalSample: LongitudinalSample = {
    recent: longitudinalRecent,
    mid: longitudinalMid,
    anchor: longitudinalAnchor,
    totalFetched,
    completeness,
    culturalVelocity,
  };

  // Build the supplemental video pool: ALL confirmed videos (including sampled ones)
  // This gives the user the full picture of what was found and allows adding more transcript
  // data from any video — even ones already sampled (to get longer/richer transcripts)
  const sampledIds = new Set([
    ...longitudinalRecent.map(t => t.videoId),
    ...longitudinalMid.map(t => t.videoId),
    ...longitudinalAnchor.map(t => t.videoId),
  ]);
  // Transcript-reliability session (C3): persist 6-3-3 SAMPLE MEMBERSHIP
  // independently of transcript success. sampledVideos is the true selection
  // (12 videos with buckets); the old path only stamped temporal_bucket via
  // successful transcripts, so a subtitle-less creator lost its longitudinal
  // structure entirely. alreadySampled keeps its historical (transcript-derived)
  // meaning — this adds evidence, it does not re-label the UI.
  const sampledBucketById = new Map(sampledVideos.map(sv => [sv.item.id, sv.bucket]));
  const discoveredVideoPool = videoItems
    .sort((a, b) => b.createTime - a.createTime)
    .map(v => ({
      id: v.id,
      url: `https://www.tiktok.com/@${handle}/video/${v.id}`,
      caption: v.caption,
      createTime: v.createTime,
      views: v.views,
      likes: v.likes,
      comments: v.comments,
      saves: v.saves,
      shares: v.shares,
      musicOriginal: v.musicOriginal,
      // Session 7 (J-4 creator side): carry the REAL scraped music metadata —
      // these previously wrote hardcoded empty strings, permanently erasing
      // music data before persistence.
      musicTitle: v.musicTitle || undefined,
      musicArtist: v.musicArtist || undefined,
      durationSec: Math.round(v.durationMs / 1000),
      alreadySampled: sampledIds.has(v.id),
      temporalBucket: sampledBucketById.get(v.id),
    }));
  return { engagementSignals, longitudinalSample, discoveredVideoPool };
}

// ─── YouTube Transcript Fetcher ───────────────────────────────────────────────

/**
 * Parse YouTube's XML caption format (timedtext) to plain text.
 */
function parseYouTubeCaptionXml(xml: string): string {
  // Remove XML tags, decode HTML entities
  const text = xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

/**
 * Fetch the transcript for a single YouTube video.
 * Extracts the caption track URL from ytInitialPlayerResponse.
 */
async function fetchYouTubeVideoTranscript(
  videoId: string,
  title: string
): Promise<TranscriptEntry | null> {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const html = await fetchHtml(videoUrl);

    // Extract ytInitialPlayerResponse JSON
    const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});\s*(?:var|window|document)/);
    if (!playerMatch) {
      // Try alternative pattern
      const altMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});/);
      if (!altMatch) {
        console.log(`[webResearch] No ytInitialPlayerResponse for YouTube video ${videoId}`);
        return null;
      }
    }

    const jsonStr = (playerMatch ?? html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});/))?.[1];
    if (!jsonStr) return null;

    let playerData: Record<string, unknown>;
    try {
      playerData = JSON.parse(jsonStr) as Record<string, unknown>;
    } catch {
      return null;
    }

    // Navigate to captions
    const captions = (playerData?.captions as Record<string, unknown>) ?? {};
    const captionTracks = (
      (captions?.playerCaptionsTracklistRenderer as Record<string, unknown>)?.captionTracks as Array<Record<string, unknown>>
    ) ?? [];

    if (captionTracks.length === 0) {
      console.log(`[webResearch] No caption tracks for YouTube video ${videoId}`);
      return null;
    }

    // Prefer English (manual or auto-generated)
    const engTrack =
      captionTracks.find((t) => (t?.languageCode as string) === "en") ??
      captionTracks.find((t) => (t?.languageCode as string)?.startsWith("en")) ??
      captionTracks[0];

    const baseUrl = engTrack?.baseUrl as string;
    if (!baseUrl) return null;

    const { default: axios } = await import("axios");
    const captionStart = Date.now();
    const captionResponse = await axios.get(baseUrl, {
      headers: {
        "Referer": "https://www.youtube.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 10000,
      responseType: "text",
    }).catch((err: Error & { response?: { status?: number } }) => {
      // Session 7 telemetry: caption downloads bypass fetchHtml (axios)
      recordScrapeEvent({
        platform: "youtube", scrapeMethod: "youtube_html", urlRequested: baseUrl,
        httpStatus: err.response?.status, failureReason: err.message.slice(0, 500),
        durationMs: Date.now() - captionStart,
      });
      throw err;
    });

    const captionXml = captionResponse.data as string;
    const transcript = parseYouTubeCaptionXml(captionXml);
    recordScrapeEvent({
      platform: "youtube", scrapeMethod: "youtube_html", urlRequested: baseUrl,
      httpStatus: captionResponse.status, responseSizeBytes: captionXml?.length,
      durationMs: Date.now() - captionStart,
      failureReason: !transcript || transcript.length < 10 ? "caption XML downloaded but parsed to empty/too-short transcript" : undefined,
    });

    if (!transcript || transcript.length < 10) return null;

    const wordCount = transcript.split(/\s+/).length;
    console.log(`[webResearch] ✅ YouTube transcript for ${videoId}: ${wordCount} words`);

    return { videoId, videoUrl, caption: title, transcript, wordCount, transcriptSource: TRANSCRIPT_SOURCE.subtitle };
  } catch (err) {
    console.warn(`[webResearch] YouTube transcript fetch failed for ${videoId}:`, (err as Error).message);
    return null;
  }
}

/**
 * Main YouTube transcript pipeline:
 * 1. Find channel via YouTube search
 * 2. Get channel video list
 * 3. Fetch transcript for each video
 */
/** What a YouTube channel capture yields — profile stats plus the video list. */
export interface YouTubeChannelCapture {
  channelId: string;
  displayName: string;
  bio: string;
  followerCount: number;
  videoCount: number;
  totalViews: number;
  location: string;
  channelKeywords: string[];
  videoTitles: string[];
  videoViewCounts: number[];
  /** The videos transcription will read, in channel order. */
  videoIds: Array<{ id: string; title: string }>;
  quotaExhausted: boolean;
}

/**
 * YouTube CAPTURE (S4b) — channel search, channel details, channel videos, and
 * the title-search fallback. Steps 1-3 of fetchYouTubeTranscripts, moved
 * VERBATIM; nothing reordered, no condition changed.
 *
 * ─── Why the fallback moved with them ───────────────────────────────────────
 * It ran AFTER transcription in the original, but it reads and appends only
 * `videoTitles`, which transcription never touches. Running it at the end of
 * capture therefore produces the identical list in the identical order — and it
 * belongs here, because it is a capture concern: it exists for the case where no
 * channel was found at all.
 */
export async function captureYouTubeChannel(handle: string): Promise<YouTubeChannelCapture> {
  let channelId = "";
  let displayName = handle;
  let bio = "";
  let followerCount = 0;
  let ytQuotaExhausted = false;

  const isQuotaErr = (err: unknown) => {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return msg.includes("usage exhausted") || msg.includes("quota") || msg.includes("rate limit") || msg.includes("too many requests");
  };
  let videoCount = 0;
  let totalViews = 0;
  let location = "";
  let channelKeywords: string[] = [];
  const videoTitles: string[] = [];
  const videoViewCounts: number[] = [];
  const videoIds: Array<{ id: string; title: string }> = [];

  // Step 1: Find channel
  try {
    const searchResponse = await searchYouTube(handle, { type: "channel", hl: "en", gl: "US" }) as unknown as Record<string, unknown>;

    const contents = (searchResponse?.contents as unknown[]) ?? [];
    for (const item of contents.slice(0, 3)) {
      const channelData = ((item as Record<string, unknown>)?.channel as Record<string, unknown>);
      if (channelData) {
        channelId = (channelData?.channelId as string) ?? "";
        displayName = (channelData?.title as string) ?? handle;
        const desc = (channelData?.descriptionSnippet as string) ?? "";
        if (desc) bio = desc;
        break;
      }
    }
  } catch (err) {
    if (isQuotaErr(err)) ytQuotaExhausted = true;
    console.warn("[webResearch] YouTube channel search failed:", err);
  }

  // Step 2: Get channel details
  if (channelId) {
    try {
      const details = await scrapeYouTubeChannelDetails(channelId) as unknown as Record<string, unknown>;

      if (details && !details.status) {
        displayName = (details.title as string) ?? displayName;
        const fullDesc = (details.description as string) ?? "";
        if (fullDesc) bio = fullDesc.slice(0, 500);
        location = (details.country as string) ?? "";

        const statsData = (details.stats as Record<string, unknown>) ?? {};
        followerCount = Number(statsData?.subscribers ?? 0);
        videoCount = Number(statsData?.videos ?? 0);
        totalViews = Number(statsData?.views ?? 0);

        const kws = (details.keywords as string[]) ?? [];
        channelKeywords = kws.slice(0, 20);
      }
    } catch (err) {
      if (isQuotaErr(err)) ytQuotaExhausted = true;
      console.warn("[webResearch] YouTube channel details failed:", err);
    }

    // Step 3: Get channel videos
    try {
      const videosResponse = await scrapeYouTubeChannelVideos(channelId) as unknown as Record<string, unknown>;

      const contents = (videosResponse?.contents as unknown[]) ?? [];
      for (const item of contents.slice(0, 15)) {
        const videoData = ((item as Record<string, unknown>)?.video as Record<string, unknown>);
        if (videoData) {
          const title = (videoData?.title as string) ?? "";
          const vid = (videoData?.videoId as string) ?? "";
          const videoStats = (videoData?.stats as Record<string, unknown>) ?? {};
          const views = Number(videoStats?.views ?? 0);
          if (title) videoTitles.push(title);
          if (views > 0) videoViewCounts.push(views);
          if (vid) videoIds.push({ id: vid, title });
        }
      }
    } catch (err) {
      if (isQuotaErr(err)) ytQuotaExhausted = true;
      console.warn("[webResearch] YouTube channel videos failed:", err);
    }
  }

  // Fallback: video search if no channel found
  if (videoTitles.length < 3) {
    try {
      const videoSearch = await searchYouTube(`${handle} youtube`, { hl: "en", gl: "US" }) as unknown as Record<string, unknown>;
      const contents = (videoSearch?.contents as unknown[]) ?? [];
      for (const item of contents.slice(0, 10)) {
        const videoData = ((item as Record<string, unknown>)?.video as Record<string, unknown>);
        if (videoData) {
          const title = (videoData?.title as string) ?? "";
          if (title) videoTitles.push(title);
        }
      }
    } catch (err) {
      if (isQuotaErr(err)) ytQuotaExhausted = true;
      console.warn("[webResearch] YouTube video search fallback failed:", err);
    }
  }

  console.log(`[webResearch] YouTube @${handle}: captured ${videoIds.length} video ids, ${videoTitles.length} titles`);

  return {
    channelId, displayName, bio, followerCount, videoCount, totalViews,
    location, channelKeywords, videoTitles, videoViewCounts, videoIds,
    quotaExhausted: ytQuotaExhausted,
  };
}

/**
 * YouTube TRANSCRIBE (S4b) — step 4 of fetchYouTubeTranscripts, moved VERBATIM:
 * batches of 3 over the first 10 video ids, 300ms between batches, results
 * collected in order. fetchYouTubeVideoTranscript (caption-XML) is called, never
 * modified.
 */
export async function transcribeYouTubeVideos(
  videoIds: Array<{ id: string; title: string }>,
): Promise<TranscriptEntry[]> {
  const transcripts: TranscriptEntry[] = [];
  const batchSize = 3;
  for (let i = 0; i < Math.min(videoIds.length, 10); i += batchSize) {
    const batch = videoIds.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((v) => fetchYouTubeVideoTranscript(v.id, v.title))
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        transcripts.push(r.value);
      }
    }
    if (i + batchSize < videoIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return transcripts;
}

/**
 * The original composed shape, preserved so researchYouTubeCreator (the monolith
 * path) behaves exactly as before. Capture then transcribe, in the same order,
 * with the same inputs.
 */
async function fetchYouTubeTranscripts(handle: string): Promise<YouTubeChannelCapture & { transcripts: TranscriptEntry[] }> {
  const captured = await captureYouTubeChannel(handle);
  const transcripts = await transcribeYouTubeVideos(captured.videoIds);
  console.log(`[webResearch] YouTube @${handle}: ${transcripts.length} transcripts, ${captured.videoTitles.length} video titles`);
  return { ...captured, transcripts };
}

// ─── Creator Type Detector ────────────────────────────────────────────────────

function detectCreatorType(
  videoTitles: string[],
  musicSignals: string[],
  bio: string,
  followerCount: number,
  avgViews: number,
  transcriptText?: string
): string {
  const allText = [...videoTitles, bio, transcriptText ?? ""].join(" ").toLowerCase();
  const hasNicheKeywords = [
    "food", "restaurant", "review", "recipe", "travel", "fitness", "fashion", "makeup",
    "tutorial", "how to", "tech", "gaming", "business", "finance", "education", "news"
  ].some(kw => allText.includes(kw));

  const emptyRatio = videoTitles.length === 0 ? 1 : (videoTitles.filter(t => t.trim().length < 5).length / videoTitles.length);
  const hasOriginalSounds = musicSignals.some(m => m.includes("original audio"));
  const isViral = avgViews > 500_000;

  if (!hasNicheKeywords && (emptyRatio > 0.5 || hasOriginalSounds) && (isViral || followerCount > 500_000)) {
    return "PERSONALITY / COMEDY CREATOR";
  }
  if (allText.includes("comedy") || allText.includes("comedian") || allText.includes("funny") || allText.includes("skit")) {
    return "COMEDY CREATOR";
  }
  if (allText.includes("food") || allText.includes("restaurant") || allText.includes("eat") || allText.includes("halal")) {
    return "FOOD CREATOR";
  }
  if (allText.includes("travel") || allText.includes("explore") || allText.includes("trip")) {
    return "TRAVEL CREATOR";
  }
  return "GENERAL CONTENT CREATOR";
}

// ─── Evidence Summary Builder ─────────────────────────────────────────────────

// ─── Banked evidence (phased-architecture S1, M1 seam) ───────────────────────
//
// The explicit struct that stages A–D produce and stage E (assembly) consumes.
// Today the monolith populates it inline, in exactly the order it always
// computed these values — nothing about execution changed. When the phases land
// (S2+), each section is written by its phase and read back from the ledger;
// assembly does not care which produced it, which is the whole point.
//
// Assembly is PURE: same banked struct in → byte-identical evidence out. That
// property is the acceptance criterion for the entire program and is pinned by
// evidenceIdentity.test.ts.

export interface BankedCreatorEvidence {
  schemaVersion: 1;
  handle: string;
  platform: string;
  /** P1 capture — surface stats from the profile read. */
  capture: {
    displayName: string;
    bio: string;
    followerCount: number;
    followingCount: number;
    videoCount: number;
    totalLikes: number;
    /** Final location (bio match, refined by the full-text pass below). */
    location: string;
    profileUrl: string;
  };
  /** P2 augment + P3 transcribe — the collected corpus. */
  collection: {
    transcripts: TranscriptEntry[];
    musicTitles: string[];
    /**
     * S4: OPTIONAL, because a platform may genuinely not compute them. TikTok
     * derives engagement signals and a 6-3-3 longitudinal sample from a dated,
     * metric-bearing pool; Instagram has neither and has never claimed to
     * (`sociologicalFieldsComputed: false` on that path says so). The evidence
     * builder already treats `engagementSignals` as optional and omits its block
     * when absent, so making the banked field optional records the absence
     * honestly instead of forcing a fabricated empty object.
     */
    engagementSignals?: EngagementSignals;
    longitudinalSample?: LongitudinalSample;
    discoveredVideoPool: CreatorResearchResult["discoveredVideoPool"];
    foreignVideosRejected: number;
  };
  /** Pure preparations computed once from capture+collection (no I/O). */
  prepared: {
    allTitles: string[];
    topHashtags: string[];
    rawKeywords: string[];
    contentThemes: string[];
    transcriptExcerpts: string;
    totalViews: number;
    avgViews: number;
    engagementRate: number;
  };
  /** P4 derive — the two independent LLM calls. */
  derived: {
    contentThemeLabels: string[];
    decodedSymbols: Awaited<ReturnType<typeof decodeCreatorSymbols>>;
  };
}


/**
 * Env-gated fixture dump (`WOMO_EVIDENCE_FIXTURE=<path>`): writes a REAL run's
 * banked struct to disk so the identity harness replays genuine stage outputs
 * rather than hand-made ones. Inert unless the env var is set — normal runs
 * never touch the filesystem here. Failures are swallowed: a debug hook must
 * never be able to fail an analysis.
 */
function maybeDumpEvidenceFixture(banked: BankedCreatorEvidence): void {
  const target = process.env.WOMO_EVIDENCE_FIXTURE;
  if (!target) return;
  try {
    writeFileSync(target, JSON.stringify(banked, null, 2), "utf-8");
    console.log(`[webResearch] evidence fixture written: ${target}`);
  } catch (err) {
    console.warn("[webResearch] evidence fixture dump failed (ignored):", (err as Error).message);
  }
}

/** What a monolith baseline records — see maybeDumpMonolithBaseline. */
export interface MonolithBaseline {
  banked: BankedCreatorEvidence;
  /** Platform-specific evidence the shared assembly appends via evidenceExtras. */
  extras: string;
  /** The exact evidenceSummary the monolith produced from `banked`. */
  expectedEvidenceSummary: string;
}

/**
 * Env-gated baseline dump (`WOMO_MONOLITH_BASELINE=<path>`), S4.
 *
 * TikTok's assembly is proven against `frozenPreSeamAssembly` — a verbatim copy
 * of the pre-seam code kept as a museum piece. Instagram has no such copy: the
 * monolith IS its reference, and porting it to the phase contract is exactly
 * what removes that reference from the live path.
 *
 * So a real monolith run records its banked inputs AND the evidence text it
 * produced from them. The harness then proves the phase assembly reproduces
 * that text byte-for-byte from the same inputs — the same proof shape, with a
 * recorded reference instead of a frozen function.
 *
 * Inert unless the env var is set; failures swallowed. A debug hook must never
 * be able to fail an analysis.
 */
function maybeDumpMonolithBaseline(baseline: MonolithBaseline): void {
  const target = process.env.WOMO_MONOLITH_BASELINE;
  if (!target) return;
  try {
    writeFileSync(target, JSON.stringify(baseline, null, 2), "utf-8");
    console.log(`[webResearch] monolith baseline written: ${target}`);
  } catch (err) {
    console.warn("[webResearch] monolith baseline dump failed (ignored):", (err as Error).message);
  }
}

// ─── M3: resume from banked ledger output (phased architecture S2, Part 1) ───
//
// The failure class this exists for: a campaign whose capture/augment/
// transcribe all succeeded but which died at derive or extract_commit. Three
// historical runs lost everything that way when the Gemini key went dead —
// minutes of scraping discarded because the last two cheap steps failed.
//
// Resume re-runs ONLY phases 4-5 from banked output. It does NOT re-scrape.
// The full monolith path is untouched and remains the default.
//
// Byte-identity is the requirement, not a nicety: a resumed run must produce
// the same evidence as a straight-through run. That holds because (a) the
// ledger column is `json`, so banked values round-trip byte-exactly
// (womo_0010), and (b) resume reconstructs `allTitles` / `viewCounts` with the
// SAME merge order the monolith uses and then calls the SAME pure functions.

/** What the banked phases must contain for a resume to be possible. */
export interface ResumableBankedPhases {
  capture: {
    stats: {
      displayName: string; bio: string; followerCount: number; followingCount: number;
      videoCount: number; totalLikes: number; secUid?: string; location: string;
    };
    profileTitles: string[];
    profileViewCounts: number[];
  };
  augment: { searchTitles: string[]; searchHashtags: string[] };
  transcribe: {
    transcripts: TranscriptEntry[];
    musicTitles: string[];
    /** Absent when the platform computes none (S4). */
    engagementSignals?: EngagementSignals;
    longitudinalSample?: LongitudinalSample;
    discoveredVideoPool: CreatorResearchResult["discoveredVideoPool"];
    foreignVideosRejected: number;
    transcriptViewCounts: number[];
  };
}

/**
 * Rebuild the merged title and view-count lists exactly as the monolith does.
 * PURE and exported so the identity harness can pin the merge order — this is
 * the one place a resumed run could silently diverge.
 */
export function reconstructMergedInputs(banked: ResumableBankedPhases): {
  allTitles: string[]; viewCounts: number[];
} {
  // Monolith: Array.from(new Set([...searchTitles, ...htmlTitles, ...popularTitles])).slice(0, 30)
  // popularTitles is always empty in the TikTok path.
  const allTitles = Array.from(new Set([
    ...banked.augment.searchTitles,
    ...banked.capture.profileTitles,
  ])).slice(0, 30);

  // Monolith: profile view counts first, then transcript view counts merged
  // in order, skipping zeros and duplicates.
  const viewCounts = [...banked.capture.profileViewCounts];
  for (const vc of banked.transcribe.transcriptViewCounts) {
    if (vc > 0 && !viewCounts.includes(vc)) viewCounts.push(vc);
  }

  return { allTitles, viewCounts };
}

/**
 * resumeResearchFromBanked REMOVED (S4).
 *
 * It re-ran phases 4-5 from banked output as a manual escape hatch. S3b made the
 * queue's boot loop resume every incomplete campaign automatically — through the
 * runner, which skips phases already banked as usable — so this second resume
 * path had no caller left. Keeping it would have meant threading the platform
 * and the collected pool through dead code to satisfy the S4 engagement-rate
 * tool, i.e. maintaining a resume path nothing exercises.
 *
 * The capability is not lost; it is strictly better, because the queue's version
 * survives a process restart and this one never did.
 */


/**
 * Prepared-evidence derivations, extracted as PURE functions (phased
 * architecture S2). Split in two to preserve the monolith's deliberate
 * interleaving exactly (Session 11 Commit 3): everything the LLM calls need is
 * computed FIRST, the calls are launched, and the remaining local work runs
 * WHILE they are in flight. Collapsing these into one function would serialize
 * that window and slow every run.
 *
 * Both are reused verbatim by the resume-from-banked path, which is the point:
 * a resumed campaign must derive `prepared` byte-identically to a
 * straight-through run, and the only way to guarantee that is to run the same
 * code on the same inputs.
 */
export function computeDeriveInputs(input: {
  searchHashtags: string[];
  allTitles: string[];
  bio: string;
  transcripts: TranscriptEntry[];
  viewCounts: number[];
  followerCount: number;
  /** Absent when the platform computes none (S4). */
  engagementSignals?: EngagementSignals;
  /** S4: whose engagement-rate formula to use. */
  platform: PlatformName;
  /** The collected pool — some platforms' rates are derived from it. */
  pool: PoolVideoItem[];
}): {
  totalViews: number; avgViews: number; engagementRate: number;
  topHashtags: string[]; rawKeywords: string[]; combinedTranscriptText: string;
} {
  const { searchHashtags, allTitles, bio, transcripts, viewCounts, followerCount, engagementSignals, platform, pool } = input;

  // Compute stats
  const totalViews = viewCounts.reduce((a, b) => a + b, 0);
  const avgViews = viewCounts.length > 0
    ? Math.round(viewCounts.reduce((a, b) => a + b, 0) / viewCounts.length)
    : 0;
  // S4: the platform owns its engagement-rate formula. This function used to
  // hardcode TikTok's as though it were universal, which turned Instagram's
  // 32.9 into a clamped 100 on the phase path. The formulas are different by
  // design — including their rounding — so they live with their platforms.
  const engagementRate = toolsetFor(platform).engagementRate({
    followerCount, avgViews, engagementSignals, pool,
  });

  const allHashtagSources = [...searchHashtags, ...allTitles, bio];
  const topHashtags = extractHashtags(allHashtagSources);

  // Include transcript text in keyword extraction for richer signal
  const transcriptTexts = transcripts.map(t => t.transcript);
  const rawKeywords = extractKeywords([...allTitles, bio, ...transcriptTexts]);

  // Use full transcript text for richer AI analysis (up to 6000 chars combined)
  const combinedTranscriptText = transcriptTexts.join(" ").slice(0, 6000);

  return { totalViews, avgViews, engagementRate, topHashtags, rawKeywords, combinedTranscriptText };
}

/** The local work the monolith does WHILE the two LLM calls are in flight. */
export function computeLocalPrepared(input: {
  allTitles: string[];
  topHashtags: string[];
  bio: string;
  /** Location so far (bio match from capture); refined here if still empty. */
  location: string;
  combinedTranscriptText: string;
  transcripts: TranscriptEntry[];
}): { contentThemes: string[]; location: string; transcriptExcerpts: string } {
  const { allTitles, topHashtags, bio, combinedTranscriptText, transcripts } = input;
  let location = input.location;

  const contentThemes = inferContentThemes(allTitles, topHashtags, bio);

  if (!location) {
    const allText = [bio, ...allTitles, combinedTranscriptText].join(" ");
    const cityMatch = matchKnownCity(allText);
    if (cityMatch) location = cityMatch;
  }

  // Build transcript excerpts for DB storage — store ALL transcripts in full (no truncation)
  // This maximises the language data available for scoring and cultural analysis
  const transcriptExcerpts = transcripts
    .map(t => `[${t.caption.slice(0, 60) || "video"}]: ${t.transcript}`)
    .join("\n\n");

  return { contentThemes, location, transcriptExcerpts };
}

/**
 * Stage E — assembly. PURE: no I/O, no clock, no randomness. Given the banked
 * struct it returns the CreatorResearchResult the extraction step consumes.
 *
 * The pure helpers it calls (buildCreatorEvidenceSummary, detectCreatorType via
 * that, formatDecodedSymbolsBlock) are untouched by the seam work — only where
 * their inputs come from changed.
 */
export function assembleCreatorResearchResult(
  b: BankedCreatorEvidence,
  /**
   * S4: platform-specific evidence appended verbatim to the summary. Instagram
   * contributes its business-signals block here; TikTok and YouTube contribute
   * "". Defaulted so every existing caller — including the evidence harness's
   * frozen pre-seam reference — behaves exactly as before.
   */
  evidenceExtras = "",
): CreatorResearchResult {
  const decodedSymbolsBlock = b.derived.decodedSymbols
    ? formatDecodedSymbolsBlock(b.derived.decodedSymbols)
    : "";

  const evidenceSummary = buildCreatorEvidenceSummary({
    handle: b.handle,
    platform: b.platform,
    displayName: b.capture.displayName,
    bio: b.capture.bio,
    followerCount: b.capture.followerCount,
    videoCount: b.capture.videoCount,
    totalLikes: b.capture.totalLikes,
    totalViews: b.prepared.totalViews,
    avgViews: b.prepared.avgViews,
    engagementRate: b.prepared.engagementRate,
    location: b.capture.location,
    videoTitles: b.prepared.allTitles,
    topHashtags: b.prepared.topHashtags,
    rawKeywords: b.prepared.rawKeywords,
    contentThemeLabels: b.derived.contentThemeLabels,
    contentThemes: b.prepared.contentThemes,
    musicSignals: b.collection.musicTitles,
    transcripts: b.collection.transcripts,
    engagementSignals: b.collection.engagementSignals,
    decodedSymbolsBlock,
  }) + evidenceExtras;

  // Compute data confidence level (thresholds FROZEN — unchanged).
  const dataConfidenceLevel: CreatorResearchResult["dataConfidenceLevel"] =
    b.collection.transcripts.length >= 6 ? "high" :
      b.collection.transcripts.length >= 3 ? "medium" :
        "low";

  return {
    handle: b.handle,
    platform: b.platform,
    displayName: b.capture.displayName,
    bio: b.capture.bio,
    followerCount: b.capture.followerCount,
    followingCount: b.capture.followingCount,
    videoCount: b.capture.videoCount,
    totalLikes: b.capture.totalLikes,
    totalViews: b.prepared.totalViews,
    avgViews: b.prepared.avgViews,
    engagementRate: b.prepared.engagementRate,
    location: b.capture.location,
    profileUrl: b.capture.profileUrl,
    recentVideoTitles: b.prepared.allTitles,
    topHashtags: b.prepared.topHashtags,
    rawKeywords: b.prepared.rawKeywords,
    contentThemeLabels: b.derived.contentThemeLabels,
    contentThemes: b.prepared.contentThemes,
    transcripts: b.collection.transcripts,
    transcriptCount: b.collection.transcripts.length,
    transcriptExcerpts: b.prepared.transcriptExcerpts,
    decodedSymbols: b.derived.decodedSymbols as Record<string, unknown> | null,
    evidenceSummary,
    longitudinalSample: b.collection.longitudinalSample,
    culturalVelocity: b.collection.longitudinalSample?.culturalVelocity,
    dataConfidenceLevel,
    // Session 8: computed iff the engagement-signals block was built (sampled
    // videos). S4: a platform that computes no engagement signals at all lands
    // here as `false` — which is exactly what the Instagram monolith already
    // reported, so the shared assembly reproduces it without a special case.
    sociologicalFieldsComputed: (b.collection.engagementSignals?.totalSampled ?? 0) > 0,
    foreignVideosRejected: b.collection.foreignVideosRejected,
    discoveredVideoPool: b.collection.discoveredVideoPool,
  };
}

/** Exported for the identity harness (evidenceIdentity.test.ts) — the frozen
 *  pre-seam reference assembly calls the SAME pure function, so the harness
 *  compares plumbing, not this function's behavior. Untouched otherwise. */
export function buildCreatorEvidenceSummary(data: {
  handle: string; platform: string; displayName: string; bio: string;
  followerCount: number; videoCount: number; totalLikes: number;
  totalViews: number; avgViews: number; engagementRate: number;
  location: string; videoTitles: string[]; topHashtags: string[];
  rawKeywords: string[]; contentThemeLabels: string[]; contentThemes: string[];
  musicSignals?: string[];
  transcripts?: TranscriptEntry[];
  engagementSignals?: EngagementSignals;
  decodedSymbolsBlock?: string;
}): string {
  const {
    handle, platform, displayName, bio, followerCount, videoCount, totalLikes,
    totalViews, avgViews, engagementRate, location, videoTitles, topHashtags,
    rawKeywords, contentThemeLabels, contentThemes, musicSignals = [],
    transcripts = [], engagementSignals, decodedSymbolsBlock = "",
  } = data;

  // Build combined transcript text for creator type detection
  const combinedTranscriptText = transcripts.map(t => t.transcript).join(" ").slice(0, 2000);
  const creatorType = detectCreatorType(videoTitles, musicSignals, bio, followerCount, avgViews, combinedTranscriptText);

  const hasTranscripts = transcripts.length > 0;
  const transcriptBlock = hasTranscripts
    ? transcripts.slice(0, 5).map((t, i) =>
      `  [Video ${i + 1}] "${t.caption.slice(0, 60) || "(no caption)"}" — ${t.wordCount} words spoken\n  TRANSCRIPT: ${t.transcript.slice(0, 500)}${t.transcript.length > 500 ? "..." : ""}`
    ).join("\n\n")
    : "  [No transcripts available — analysis based on video titles and profile metadata]";

  // ─── Build engagement signals block ───────────────────────────────────────────────────────────
  let engagementBlock = "";
  let temporalBlock = "";
  if (engagementSignals && engagementSignals.totalSampled > 0) {
    const sig = engagementSignals;
    const pct = (v: number) => (v * 100).toFixed(3) + "%";
    const pct1 = (v: number) => (v * 100).toFixed(1) + "%";
    const secs = (s: number) => s > 0 ? `${Math.round(s)}s (${s >= 60 ? (s / 60).toFixed(1) + "min" : "short-form"})` : "unknown";

    // Parasocial bond interpretation
    const commentPct = sig.avgCommentRate * 100;
    const bondLabel =
      commentPct >= 0.5 ? "5.0 — Deep parasocial bond (audience treats creator as a close friend)" :
        commentPct >= 0.25 ? "4.0 — Strong bond (regular emotional engagement)" :
          commentPct >= 0.10 ? "3.0 — Moderate bond (engaged but professional distance)" :
            commentPct >= 0.05 ? "2.0 — Weak bond (passive audience, low interaction)" :
              "1.0 — Transactional / informational (minimal emotional connection)";

    // Audience relationship interpretation
    const savePct = sig.avgSaveRate * 100;
    const relLabel =
      savePct >= 1.0 ? "Authority / Expert (audience saves content as a reference resource)" :
        savePct >= 0.4 ? "Mentor (audience saves for future use — high utility value)" :
          "Friend / Entertainer (audience watches but does not save — entertainment-first)";

    // Cultural capital interpretation
    const origAudio = sig.originalAudioRate;
    const sharePct = sig.avgShareRate * 100;
    const capitalLabel =
      origAudio >= 0.5 && sharePct >= 0.3 ? "PRODUCE — Creator originates culture (original audio + high share rate)" :
        origAudio >= 0.3 ? "PRODUCE (leaning) — Creates original audio but limited cultural spread" :
          sharePct >= 0.5 ? "RELAY (amplifier) — Spreads existing culture widely" :
            "RELAY — Participates in existing trends, does not originate";

    // Remix signal
    const remixLabel = sig.remixEnablementRate >= 0.5
      ? `HIGH (${pct1(sig.remixEnablementRate)} of videos allow duet/stitch — community remix culture)`
      : sig.remixEnablementRate > 0
        ? `LOW (${pct1(sig.remixEnablementRate)} allow remix — selective openness)`
        : "NONE (all duet/stitch disabled — closed content strategy)";

    // Brand saturation
    const adLabel = sig.adTagRate >= 0.3
      ? `HIGH (${pct1(sig.adTagRate)} of videos tagged as ads — significant commercial activity)`
      : sig.adTagRate > 0
        ? `MODERATE (${pct1(sig.adTagRate)} ad-tagged)`
        : "NONE detected in sampled videos";

    engagementBlock = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPUTED ENGAGEMENT SIGNALS (from ${sig.totalSampled} sampled videos — DATA-DRIVEN)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RATE METRICS (avg per video):
  Like Rate (true engagement):  ${pct(sig.avgLikeRate)} of views → use this as engagementRate
  Comment Rate (parasocial):    ${pct(sig.avgCommentRate)} of views
  Save Rate (utility/reference): ${pct(sig.avgSaveRate)} of views
  Share Rate (cultural spread): ${pct(sig.avgShareRate)} of views
  Avg Video Duration:           ${secs(sig.avgDurationSeconds)}

DERIVED SOCIOLOGICAL SIGNALS:
  ▶ PARASOCIAL BOND STRENGTH: ${bondLabel}
    (Comment rate ${pct(sig.avgCommentRate)} → use this number, do not re-derive)

  ▶ AUDIENCE RELATIONSHIP TYPE: ${relLabel}
    (Save rate ${pct(sig.avgSaveRate)} → use this number, do not re-derive)

  ▶ CULTURAL CAPITAL: ${capitalLabel}
    (Original audio: ${pct1(origAudio)}, Share rate: ${pct(sig.avgShareRate)})

  ▶ REMIX RATE / COMMUNITY OPENNESS: ${remixLabel}

  ▶ BRAND SATURATION: ${adLabel}

⚠️  INSTRUCTION: The above signals are COMPUTED FROM RAW DATA. You MUST use these
    values directly when setting parasocialBondStrength, audienceRelationshipType,
    culturalCapitalType, and remixRate. Do NOT override them with your own estimate.`;

    // Build temporal content table
    const fmtBucket = (label: string, items: TemporalVideoEntry[]) => {
      if (items.length === 0) return `${label}: [no videos in this period]`;
      return `${label} (${items.length} videos):\n` +
        items.slice(0, 5).map(v =>
          `  [${v.dateStr}] ${v.caption.slice(0, 60)} | ${formatNum(v.views)} plays, ${formatNum(v.likes)} likes, ${formatNum(v.comments)} comments, ${formatNum(v.saves)} saves`
        ).join("\n");
    };

    const hasTemporalData = sig.recentVideos.length + sig.midVideos.length + sig.olderVideos.length > 0;
    if (hasTemporalData) {
      temporalBlock = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEMPORAL CONTENT ANALYSIS (for Drift Signal + Goffman Stage Test)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${fmtBucket("RECENT (last 90 days)", sig.recentVideos)}

${fmtBucket("MID-PERIOD (3–12 months ago)", sig.midVideos)}

${fmtBucket("OLDER (12+ months ago)", sig.olderVideos)}

INSTRUCTION: Compare the topic/tone/style across time periods to assess:
  • DRIFT SIGNAL: Zero Change / Minor Drift / Significant Drift / Full Pivot
  • GOFFMAN STAGE TEST: Consistent / Minor Gap / Significant Gap
  If only one time period has data, set Drift Signal to "Zero Change" (insufficient history).`;
    }
  }

  const personalityNote = (creatorType.includes("PERSONALITY") || creatorType.includes("COMEDY")) ? `
⚠️  PERSONALITY CREATOR NOTE: This creator uses minimal captions. Their identity comes from
    their PRESENCE, STYLE, and AUDIENCE RELATIONSHIP — not from descriptive post titles.
    Use follower count, avg views, bio tone, music choices, and any transcript content to infer archetype.
` : "";

  return `
CREATOR RESEARCH EVIDENCE — @${handle} (${platform})
=====================================================
Display Name: ${displayName}
Platform: ${platform}
Bio / Signature: "${bio}"
Location: ${location || "Not specified"}

STATS:
  Followers / Subscribers: ${formatNum(followerCount)}
  Total Videos: ${videoCount}
  Total Likes / Hearts: ${formatNum(totalLikes)}
  Total Views: ${formatNum(totalViews)}
  Avg Views per Video: ${formatNum(avgViews)}
  Engagement Rate: ${engagementRate}%

DETECTED CREATOR TYPE: ${creatorType}${personalityNote}${engagementBlock}${temporalBlock}${decodedSymbolsBlock ? "\n\n" + decodedSymbolsBlock : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRIMARY EVIDENCE — SPOKEN TRANSCRIPTS (${transcripts.length} videos)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${hasTranscripts ? `⚡ TRANSCRIPT DATA IS AVAILABLE. This is the HIGHEST CONFIDENCE evidence.
Analyze what the creator LITERALLY SAYS. Their spoken words reveal their true niche,
personality, values, and audience relationship more accurately than any other signal.` : "⚠️  No transcripts available. Analysis relies on titles and metadata."}

${transcriptBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECONDARY EVIDENCE — VIDEO TITLES & METADATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTENT THEMES (LLM-translated from actual content):
${contentThemeLabels.map((t) => `  • ${t}`).join("\n")}

RULE-BASED THEMES (cross-reference):
${contentThemes.map((t) => `  • ${t}`).join("\n")}

TOP KEYWORDS (from video titles/descriptions):
${rawKeywords.slice(0, 20).join(", ")}

TOP HASHTAGS:
${topHashtags.slice(0, 15).join(", ")}

ACTUAL VIDEO TITLES / DESCRIPTIONS (${videoTitles.length} posts sampled):
${videoTitles.length > 0 ? videoTitles.slice(0, 20).map((t, i) => `  ${i + 1}. ${t}`).join("\n") : "  [No video titles available]"}

MUSIC / AUDIO SIGNALS (${musicSignals.length} tracks):
${musicSignals.length > 0 ? musicSignals.slice(0, 10).map((m) => `  • ${m}`).join("\n") : "  [No named audio tracks extracted]"}

DATA CONFIDENCE LEVEL: ${transcripts.length >= 3 ? `HIGH ✅ (${transcripts.length} video transcripts available — spoken content analyzed)` : transcripts.length > 0 ? `MEDIUM ⚠️ (${transcripts.length} transcript(s) + ${videoTitles.length} video titles)` : videoTitles.length >= 10 ? `MEDIUM ⚠️ (${videoTitles.length} video titles, no transcripts)` : `LOW ❌ (${videoTitles.length} titles, no transcripts — limited confidence)`}

CRITICAL ANALYSIS INSTRUCTIONS:
⚠️  TRANSCRIPT CONTENT IS THE HIGHEST PRIORITY SIGNAL.
    If transcripts are available, derive archetype, niche, values, and tone FROM WHAT THEY SAY.
    Bio/signature is a SELF-REPORTED label — challenge it with the transcript evidence.

RULE 1: Transcripts reveal the creator's TRUE identity. If they talk about food in every video,
         they are a food creator — regardless of what their bio says.

RULE 2: If no transcripts are available, use video titles and hashtags as the primary signal.
         Bio is only context, not identity.

RULE 3: Archetype, niche, and values must be derived from actual content evidence.
         DO NOT invent themes not supported by the evidence.

RULE 4: If data confidence is LOW, set identityCoherenceScore to 40 or below and state
         clearly in aiSummary that this analysis is based on limited data.
`.trim();
}

// ─── TikTok Creator Research ──────────────────────────────────────────────────

/**
 * Scraper-reliability Part 2: explain an empty/thin capture honestly.
 * Three cases, from the profile scrape's capture assessment:
 *   genuine-empty — the profile's own stats confirmed 0 posts (clean fact);
 *   transient     — the profile states videos exist (or its stats were
 *                   unreadable) but capture got none, even after the bounded
 *                   retry → "retry in a minute", NOT "verify the handle";
 *   unknown       — no assessment available (prefetch itself failed) → generic.
 */
export function emptyCaptureMessage(
  handle: string,
  capture: { videosCaptured: number; statedVideoCount: number | null; emptyCaptureRetried: boolean; genuineEmpty: boolean } | undefined,
  generic: string,
): string {
  if (capture?.genuineEmpty) {
    return `@${handle}'s profile reports 0 public posts — there is no content to analyze. (Confirmed by the profile's own stats; this is not a scraping failure.)`;
  }
  if (capture && capture.videosCaptured === 0) {
    const stated = capture.statedVideoCount != null && capture.statedVideoCount > 0
      ? `the profile reports ${capture.statedVideoCount} videos`
      : "the profile's video count could not be read";
    const retried = capture.emptyCaptureRetried ? " even after an automatic retry" : "";
    return `TikTok blocked video capture for @${handle} (${stated}, but capture returned none${retried}). This is usually transient — wait a minute and retry. Do not delete the profile.`;
  }
  return generic;
}

/**
 * TikTok creator research — THE LIVE PATH (phased architecture S2, Part 3).
 *
 * Executes the five-phase runner instead of the inline orchestration. Each
 * phase reads its declared inputs from the campaign's banked state and the
 * runner writes every output to the ledger as it goes, so this run is a real
 * campaign rather than a monolith that happens to log.
 *
 * The endpoint's shape is unchanged: still one synchronous call that returns
 * the finished CreatorResearchResult. No scheduler, no enqueue/poll — S3.
 *
 * FROZEN and preserved verbatim below: the quota gate, the no-data gate and the
 * minimum-data threshold, including their exact messages via
 * emptyCaptureMessage. Those are interpretation, not gathering, and this
 * session does not touch them.
 *
 * This is now the ONLY path: the previous inline orchestration was deleted in
 * the S2 cutover.
 */
/** Collection result plus the banked phase state that produced it (S3b). */
export interface TikTokCollectionCampaign {
  research: CreatorResearchResult;
  /** Every phase's banked output, ready to seed the extract_commit phase. */
  phases: CampaignState["phases"];
}

/**
 * Phases 1-4 plus the FROZEN evidence gates and the pure assembly, returning
 * the banked state alongside the result (S3b).
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 * extract_commit is the fifth phase and reads its inputs from banked output.
 * Running it through the runner therefore needs the state phases 1-4 produced —
 * which `researchTikTokCreator` used to discard. This is that function, verbatim,
 * with the state returned instead of thrown away; `researchTikTokCreator` is now
 * a thin wrapper over it, so every existing caller behaves identically.
 *
 * ─── Why the gates still live here, between phase 4 and phase 5 ─────────────
 * The quota gate, the no-data gate and the minimum-data threshold are FROZEN
 * interpretation, and they decide whether evidence is sufficient to extract from
 * at all. They must run BEFORE extract_commit — a campaign that runs all five
 * phases in one pass would persist a profile the min-data gate exists to refuse.
 * They throw, exactly as before; the campaign turns that throw into a terminal
 * campaign outcome carrying the same honest message.
 */

/**
 * THE CREATOR-SHAPED TAIL OF A COLLECTION (extraction only — zero edits).
 *
 * Everything below is pool-shaped: it reads `augment.pool` / `capture.pool`,
 * reconstructs the merged title and hashtag order, and assembles a
 * `CreatorResearchResult`. None of it is the operating model — the operating
 * model is "run the phases, read what they banked, ask the gate" — and a
 * subject with no video pool (a brand) has no use for any of it.
 *
 * Lifted VERBATIM so the driver above can become generic without this moving
 * and changing in the same step. The identity harnesses are the arbiters of
 * that claim: a single reordered merge here silently repicks which videos
 * become the evidence, and every downstream score moves while the run still
 * looks successful.
 */
function assembleCreatorCollection(args: {
  handle: string;
  platform: PlatformName;
  capture: CapturePhaseOutput;
  augment: AugmentPhaseOutput | null;
  transcribe: TranscribePhaseOutput | null;
  derived: DerivePhaseOutput | null;
  summary: Awaited<ReturnType<typeof runPhases>>;
  /** `currentRunId()` returns null outside a run context. */
  runId: string | null | undefined;
}): TikTokCollectionCampaign {
  const { handle, platform, capture, augment, transcribe, derived, summary, runId } = args;
  const transcripts = transcribe?.transcripts ?? [];
  const banked: ResumableBankedPhases = {
    capture: {
      stats: capture.stats,
      profileTitles: capture.profileTitles,
      profileViewCounts: capture.profileViewCounts,
    },
    augment: {
      searchTitles: augment?.pool.videoTitles ?? capture.pool.videoTitles,
      searchHashtags: augment?.pool.hashtags ?? capture.pool.hashtags,
    },
    transcribe: (transcribe ?? {
      transcripts: [], musicTitles: [], engagementSignals: { totalSampled: 0 } as never,
      longitudinalSample: undefined as never, discoveredVideoPool: [],
      foreignVideosRejected: 0, transcriptViewCounts: [],
    }) as ResumableBankedPhases["transcribe"],
  };
  const { allTitles } = reconstructMergedInputs(banked);

  if (augment?.quotaExhausted) {
    console.warn(`[webResearch] @${handle}: quota exhausted but proceeding with content data (${allTitles.length} titles, ${transcripts.length} transcripts)`);
  }

  if (!augment || !transcribe || !derived) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Analysis for @${handle} stopped at the ${summary.stoppedAt?.phase ?? "unknown"} phase (${summary.stoppedAt?.reason ?? "incomplete"}). Nothing was saved.`,
    });
  }

  // Flush the collection-fixture draft (inert unless WOMO_COLLECTION_FIXTURE).
  if (runId) flushCollectionFixture(runId);

  // Stage E — the SAME pure assembly the resume path uses.
  const result = assembleFromPhases(handle, platform, { handle, capture, augment, transcribe }, derived);
  maybeDumpEvidenceFixture({
    schemaVersion: 1, handle, platform: "TikTok",
    capture: {
      displayName: result.displayName, bio: result.bio,
      followerCount: result.followerCount, followingCount: result.followingCount ?? 0,
      videoCount: result.videoCount, totalLikes: result.totalLikes,
      location: result.location, profileUrl: result.profileUrl ?? "",
    },
    collection: {
      transcripts, musicTitles: transcribe.musicTitles,
      engagementSignals: transcribe.engagementSignals,
      longitudinalSample: transcribe.longitudinalSample,
      discoveredVideoPool: transcribe.discoveredVideoPool,
      foreignVideosRejected: transcribe.foreignVideosRejected,
    },
    prepared: {
      allTitles: result.recentVideoTitles ?? [], topHashtags: result.topHashtags ?? [],
      rawKeywords: result.rawKeywords ?? [], contentThemes: result.contentThemes ?? [],
      transcriptExcerpts: result.transcriptExcerpts ?? "",
      totalViews: result.totalViews, avgViews: result.avgViews, engagementRate: result.engagementRate,
    },
    derived: { contentThemeLabels: derived.contentThemeLabels, decodedSymbols: derived.decodedSymbols },
  });

  return { research: result, phases: summary.state.phases };
}

export async function runPhaseCollection<TOut>(args: {
  handle: string;
  platform: PlatformName;
  /** The phases to run, in order. THE ONLY THING THAT VARIES BY SUBJECT. */
  phases: Array<AnalysisPhase<never, unknown>>;
  /**
   * Banked state from a previous attempt (S3b). The runner skips any phase
   * already banked as usable, so a RESUMED campaign re-runs only what it has
   * to — without this, a resume would silently re-scrape everything it had
   * already collected, which is precisely the cost resumption exists to avoid.
   */
  initialPhases?: CampaignState["phases"];
  /** Turn the banked outputs into whatever this subject's result type is. */
  assemble: (ctx: {
    handle: string;
    platform: PlatformName;
    banked: Partial<Record<PhaseName, unknown>>;
    summary: Awaited<ReturnType<typeof runPhases>>;
    runId: string | null;
  }) => TOut;
}): Promise<TOut> {
  const { handle, platform, phases, initialPhases, assemble } = args;
  /**
   * ENCODED ONCE, by the module that owns the encoding — the twin of the fix
   * already made in creatorCampaign. A hand-rolled hint agrees with the queue's
   * only while every subject is a bare handle, and silently disagrees the
   * moment one carries extras.
   */
  const subjectHint = encodeSubject({ handle, platform });
  const runId = currentRunId();

  const summary = await runPhases({
    runId: runId ?? "no-run-context",
    handle,
    platform,
    phases: phases as never,
    // Resumed campaigns skip whatever the ledger already holds as usable.
    initialPhases,
    // S3a: every phase now runs through the scheduler — admitted against its
    // resource class's bound BEFORE any tool (and so any browser context) is
    // touched, and retried per its declared policy. The runner still owns order
    // and stop conditions; nothing about WHAT is gathered changes.
    execute: makeSchedulerExecute({
      deadlineAt: currentDeadlineAt(),
      // Show the phase's live state, distinguishing WAITING from WORKING:
      // `pending` while it queues for a permit, `running` once admitted. Both
      // fire-and-forget, like every other observation write — recordPhaseObservation
      // drops a write older than the row it would overwrite, so an out-of-order
      // marker can never clobber the terminal outcome.
      onAttemptStart: (phase, attempt, status) => {
        if (!runId) return;
        void recordPhaseObservation({
          runId, subjectHint,
          phase: phase.name as PhaseStateWrite["phase"],
          tool: phase.tool,
          status,
          attemptCount: attempt,
        });
      },
    }),
    // Each phase's output is banked as it completes. Fire-and-forget so
    // observation can never add latency to, or fail, an analysis.
    bank: (entry) => {
      if (!runId) return;
      void recordPhaseObservation({
        runId, subjectHint,
        phase: entry.phase as PhaseStateWrite["phase"],
        tool: entry.tool,
        status: entry.status as PhaseStateWrite["status"],
        failureClass: entry.failureClass as PhaseStateWrite["failureClass"],
        attemptCount: entry.attemptCount,
        nextEarliestAt: entry.nextEarliestAt,
        output: entry.output,
      });
    },
  });

  /**
   * Every phase's banked output, keyed by name. The driver does not know what
   * any of them CONTAIN — that is the subject's business, and the gate's.
   */
  const banked: Partial<Record<PhaseName, unknown>> = {};
  for (const name of PHASE_NAMES) {
    banked[name] = bankedOutput<unknown>(summary, name);
  }

  // ── Evidence gate (S4) ──
  // The platform decides whether its evidence is fit to extract from, and words
  // that decision in its own FROZEN text. The driver only asks and throws.
  // Runs BETWEEN phase 4 and phase 5: a single five-phase pass would persist a
  // profile the min-data gate exists to refuse.
  const verdict = toolsetFor(platform).gate({ handle, banked });
  if (!verdict.ok) {
    throw new TRPCError({ code: verdict.code, message: verdict.message });
  }

  return assemble({ handle, platform, banked, summary, runId });
}

/**
 * The CREATOR collection — the four creator phases plus the creator assembly,
 * handed to the generic driver above.
 *
 * Its signature is unchanged, so `creatorCampaign` and every other caller are
 * untouched. What changed is that the pool, the merge order and the
 * CreatorResearchResult all live on THIS side of the seam now; the driver keeps
 * only what every subject shares.
 */
export async function runCollection(
  handleOrUrl: string,
  platform: PlatformName,
  initialPhases?: CampaignState["phases"],
): Promise<TikTokCollectionCampaign> {
  const handle = extractHandle(handleOrUrl);
  return runPhaseCollection<TikTokCollectionCampaign>({
    handle,
    platform,
    initialPhases,
    phases: [
      makeCapturePhase(platform),
      makeAugmentPhase(platform),
      makeTranscribePhase(platform),
      makeDerivePhase(platform, {
        translateKeywordsToThemes,
        decodeCreatorSymbols: (i) => decodeCreatorSymbols(i),
      }),
    ] as never,
    assemble: ({ banked, summary, runId }) => {
      const capture = banked.capture as CapturePhaseOutput | null;
      const augment = banked.augment as AugmentPhaseOutput | null;
      const transcribe = banked.transcribe as TranscribePhaseOutput | null;
      const derived = banked.derive as DerivePhaseOutput | null;

      if (!capture) {
        // Unreachable once a gate refuses a null capture, but the assembly
        // dereferences it, so this keeps the type honest rather than asserting.
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No public content found for @${handle}.`,
        });
      }
      return assembleCreatorCollection({
        handle, platform, capture, augment, transcribe, derived, summary, runId,
      });
    },
  });
}

/**
 * TikTok creator research — the collection half, for callers that only want the
 * assembled evidence. Unchanged behaviour; the banked state is simply dropped.
 */
async function researchTikTokCreator(handleOrUrl: string): Promise<CreatorResearchResult> {
  return (await runCollection(handleOrUrl, "TikTok")).research;
}

// ─── Instagram Creator Research ───────────────────────────────────────────────

async function researchInstagramCreator(handleOrUrl: string): Promise<CreatorResearchResult> {
  const handle = extractHandle(handleOrUrl);

  console.log(`[webResearch] Starting Instagram research for @${handle}`);

  // Step 1: Scrape Instagram profile (multi-path)
  const scraped = await scrapeInstagramProfile(handle);
  const { profile, posts: rawPosts, source, confidence } = scraped;

  // Step 2: Supplement incomplete posts with oEmbed
  const posts = rawPosts.length > 0 ? await supplementPostsViaOEmbed(rawPosts) : [];

  const hasProfileData = profile.follower_count > 0 || profile.biography.length > 0;
  const hasPostData = posts.length > 0;
  const hasAnyData = hasProfileData || hasPostData;

  if (!hasAnyData) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No public content found for @${handle} on Instagram. Please verify the handle is correct and that the account is public.`,
    });
  }

  // Step 3: Extract captions, hashtags, and engagement data
  const allCaptions = posts.map(p => p.caption).filter(c => c.length > 0);
  const allHashtags = extractHashtags(allCaptions);
  // Reel captions are extracted in Step 5 when flagging reels for Whisper

  // Extract video titles (use first line of caption or first 60 chars)
  const videoTitles = allCaptions.map(c => {
    const firstLine = c.split("\n")[0];
    return firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;
  }).slice(0, 25);

  // Step 4: Engagement metrics
  const totalLikes = posts.reduce((sum, p) => sum + (p.like_count ?? 0), 0);
  const avgLikes = posts.length > 0 ? Math.round(totalLikes / posts.length) : 0;
  const engagementRate = profile.follower_count > 0 && avgLikes > 0
    ? Math.min(100, Math.round((avgLikes / profile.follower_count) * 100 * 10) / 10)
    : 0;

  // FIX 2.1: Calculate real view counts from post data (GraphQL returns view_count for videos)
  const totalViews = posts.reduce((sum, p) => sum + (p.view_count ?? 0), 0);
  const avgViews = posts.length > 0 ? Math.round(totalViews / posts.length) : 0;

  // Step 5: Transcripts — download via Playwright context.request (has Instagram cookies)
  const transcripts: TranscriptEntry[] = [];
  const reelPosts = posts.filter(p => p.media_type === "video" || p.media_type === "reel").slice(0, 6);

  console.log(`[webResearch] Instagram @${handle}: ${reelPosts.length} video/reel posts found for transcript extraction`);

  if (reelPosts.length > 0) {
    // Import browserClient to get a context with cookies for downloading CDN videos
    const { getContext } = await import("./scraping/browserClient");
    const { requestGovernor } = await import("./scraping/httpClient");

    let dlCtx: Awaited<ReturnType<typeof getContext>> | null = null;
    try {
      await requestGovernor("instagram");
      dlCtx = await getContext("mobile-ios", 10);
      const { context: browserCtx } = dlCtx;

      // Process reels in batches of 3 for speed
      const batchSize = 3;
      for (let i = 0; i < reelPosts.length && transcripts.length < 5; i += batchSize) {
        const batch = reelPosts.slice(i, i + batchSize);

        const batchResults = await Promise.allSettled(
          batch.map(async (reel) => {
            if (!reel.video_url) {
              console.log(`[webResearch] Instagram reel ${reel.shortcode}: no video_url — skipping`);
              return null;
            }

            // Download video via Playwright context.request (inherits cookies)
            try {
              console.log(`[webResearch] Instagram reel ${reel.shortcode}: downloading via context.request...`);
              const dlStart = Date.now();
              const dlRes = await browserCtx.request.get(reel.video_url, {
                timeout: 20000,
                headers: {
                  "Accept": "*/*",
                  "Referer": "https://www.instagram.com/",
                },
              });

              if (!dlRes.ok()) {
                console.log(`[webResearch] Instagram reel ${reel.shortcode}: download failed — HTTP ${dlRes.status()}`);
                recordScrapeEvent({
                  platform: "instagram", scrapeMethod: "instagram_playwright",
                  urlRequested: reel.video_url.slice(0, 1000), httpStatus: dlRes.status(),
                  failureReason: `reel video download failed — HTTP ${dlRes.status()}`,
                  durationMs: Date.now() - dlStart,
                });
                return null;
              }

              const audioBuffer = Buffer.from(await dlRes.body());
              const mimeType = dlRes.headers()["content-type"] || "video/mp4";
              const sizeMB = audioBuffer.length / (1024 * 1024);
              console.log(`[webResearch] Instagram reel ${reel.shortcode}: downloaded ${sizeMB.toFixed(1)}MB`);
              recordScrapeEvent({
                platform: "instagram", scrapeMethod: "instagram_playwright",
                urlRequested: reel.video_url.slice(0, 1000), httpStatus: dlRes.status(),
                responseSizeBytes: audioBuffer.length, durationMs: Date.now() - dlStart,
              });

              if (sizeMB < 0.01) {
                console.log(`[webResearch] Instagram reel ${reel.shortcode}: file too small — skipping`);
                return null;
              }

              // Transcribe with pre-downloaded buffer (no second download needed)
              const result = await transcribeAudio({
                audioUrl: reel.video_url,
                language: "en",
                audioBuffer,
                mimeType: mimeType.includes("video") ? "video/mp4" : mimeType,
              });

              if (result && !("error" in result) && result.text && result.text.length >= 10) {
                const wordCount = result.text.split(/\s+/).length;
                console.log(`[webResearch] ✅ Instagram reel ${reel.shortcode}: ${wordCount} words transcribed`);
                return {
                  videoId: reel.shortcode,
                  videoUrl: `https://www.instagram.com/p/${reel.shortcode}/`,
                  caption: reel.caption.slice(0, 100),
                  transcript: result.text.trim(),
                  wordCount,
                  transcriptSource: TRANSCRIPT_SOURCE.speechToText, // Gemini/Whisper audio = speech
                } as TranscriptEntry;
              } else {
                const errDetail = result && "error" in result
                  ? `${(result as { error: string; details?: string }).error}: ${(result as { details?: string }).details ?? ""}`
                  : "empty/short text";
                console.log(`[webResearch] Instagram reel ${reel.shortcode}: transcription failed — ${errDetail}`);
                return null;
              }
            } catch (err) {
              console.log(`[webResearch] Instagram reel ${reel.shortcode}: download/transcribe error — ${(err as Error).message}`);
              return null;
            }
          })
        );

        // Collect successful transcripts
        for (const result of batchResults) {
          if (result.status === "fulfilled" && result.value) {
            transcripts.push(result.value);
          }
        }
      }

      // Close the download page
      try { await dlCtx.page.close(); } catch { /* */ }
    } catch (err) {
      console.log(`[webResearch] Instagram @${handle}: transcript batch failed — ${(err as Error).message}`);
      if (dlCtx) {
        try { await dlCtx.page.close(); } catch { /* */ }
      }
    }
  }

  // Step 6: Keywords and themes
  const transcriptTexts = transcripts.map(t => t.transcript);
  const rawKeywords = extractKeywords([...videoTitles, profile.biography, ...transcriptTexts]);
  const combinedTranscriptText = transcriptTexts.join(" ").slice(0, 6000);
  // Session 11 (Commit 3): themes + symbols are independent LLM calls — launch
  // both, do the local work (location, excerpts) while they run, then await both.
  const themesPromise = translateKeywordsToThemes(rawKeywords, allHashtags, videoTitles, profile.biography, combinedTranscriptText);
  const symbolsPromise = decodeCreatorSymbols({
    handle,
    bio: profile.biography,
    videoTitles,
    hashtags: allHashtags,
    transcriptExcerpts: transcriptTexts,
  });
  const contentThemes = inferContentThemes(videoTitles, allHashtags, profile.biography);

  // Step 7: Location detection
  let location = "";
  const locationText = [profile.biography, ...videoTitles, combinedTranscriptText].join(" ");
  const cityMatch = matchKnownCity(locationText);
  if (cityMatch) location = cityMatch;

  // Step 8: Build transcript excerpts
  const transcriptExcerpts = transcripts
    .map(t => `[${t.caption.slice(0, 60) || "reel"}]: ${t.transcript}`)
    .join("\n\n");

  // Step 9: Await themes + symbols (launched above, ran concurrently)
  const [contentThemeLabels, decodedSymbols] = await Promise.all([themesPromise, symbolsPromise]);
  const decodedSymbolsBlock = decodedSymbols ? formatDecodedSymbolsBlock(decodedSymbols) : "";

  // Step 10: Build evidence summary with Instagram-specific signals
  const businessSignal = profile.is_business_account
    ? `\nINSTAGRAM BUSINESS SIGNALS:\n  Business Account: YES\n  Category: ${profile.category || "Not specified"}\n  Verified: ${profile.is_verified ? "YES" : "NO"}\n  External URL: ${profile.external_url || "None"}`
    : "";

  const evidenceSummary = buildCreatorEvidenceSummary({
    handle,
    platform: "Instagram",
    displayName: profile.full_name || handle,
    bio: profile.biography,
    followerCount: profile.follower_count,
    videoCount: profile.media_count,
    totalLikes,
    totalViews,
    avgViews,
    engagementRate,
    location,
    videoTitles,
    topHashtags: allHashtags,
    rawKeywords,
    contentThemeLabels,
    contentThemes,
    transcripts,
    decodedSymbolsBlock,
  }) + businessSignal;

  // Data confidence level — preliminary estimate based on scrape results.
  // FIX 8.2: The authoritative value is recalculated in routers.ts after
  // DB persistence confirms how many transcripts actually landed.
  const dataConfidenceLevel: CreatorResearchResult["dataConfidenceLevel"] =
    transcripts.length >= 3 ? "high" :
      (posts.length >= 6 || transcripts.length >= 1) ? "medium" :
        "low";

  console.log(`[webResearch] Instagram @${handle}: ${posts.length} posts, ${transcripts.length} transcripts, confidence=${dataConfidenceLevel}, source=${source}`);

  // Map Instagram posts to discoveredVideoPool format (enables content_items persistence)
  const discoveredVideoPool = posts.map(p => ({
    id: p.shortcode || p.id,
    url: p.shortcode ? `https://www.instagram.com/p/${p.shortcode}/` : "",
    caption: p.caption || "",
    createTime: p.timestamp || 0,
    views: p.view_count || 0,
    likes: p.like_count || 0,
    comments: p.comment_count || 0,
    saves: 0,
    shares: 0,
    musicOriginal: false,
    musicTitle: undefined as string | undefined,
    musicArtist: undefined as string | undefined,
    durationSec: p.video_duration ? Math.round(p.video_duration) : 0,
    videoUrl: p.video_url || undefined as string | undefined,
    transcriptText: undefined as string | undefined,
    transcriptWordCount: undefined as number | undefined,
    transcriptSource: undefined as string | undefined,
  }));

  // Merge extracted transcripts into discoveredVideoPool
  let mergedCount = 0;
  for (const t of transcripts) {
    const poolItem = discoveredVideoPool.find(v => v.id === t.videoId || v.url === t.videoUrl);
    if (poolItem) {
      poolItem.transcriptText = t.transcript;
      poolItem.transcriptWordCount = t.wordCount;
      poolItem.transcriptSource = TRANSCRIPT_SOURCE.speechToText;
      mergedCount++;
      console.log(`[webResearch] Merged transcript into pool: ${t.videoId} (${t.wordCount} words)`);
    } else {
      console.log(`[webResearch] ⚠️ Transcript videoId=${t.videoId} NOT found in pool (pool IDs: ${discoveredVideoPool.map(v => v.id).join(', ')})`);
    }
  }

  const poolWithTranscripts = discoveredVideoPool.filter(v => v.transcriptText);
  console.log(`[webResearch] Instagram @${handle}: built discoveredVideoPool with ${discoveredVideoPool.length} items (${mergedCount} merged, ${poolWithTranscripts.length} with transcriptText)`);

  // S4 baseline capture. TikTok has a FROZEN pre-seam function to compare the
  // phase assembly against; Instagram has no such museum piece — this monolith
  // IS the reference, and it is about to be bypassed. So record both the banked
  // inputs and the exact evidence this path produced, and let the harness prove
  // the phase path reproduces it byte-for-byte. Inert unless the flag is set.
  maybeDumpMonolithBaseline({
    banked: {
      schemaVersion: 1,
      handle,
      platform: "Instagram",
      capture: {
        displayName: profile.full_name || handle,
        bio: profile.biography,
        followerCount: profile.follower_count,
        followingCount: 0,
        videoCount: profile.media_count,
        totalLikes,
        location,
        profileUrl: `https://www.instagram.com/${handle}/`,
      },
      collection: {
        transcripts,
        musicTitles: [],
        // Instagram computes neither — see the optional fields on the type.
        engagementSignals: undefined,
        longitudinalSample: undefined,
        discoveredVideoPool,
        foreignVideosRejected: 0,
      },
      prepared: {
        allTitles: videoTitles,
        topHashtags: allHashtags,
        rawKeywords,
        contentThemes,
        transcriptExcerpts,
        totalViews,
        avgViews,
        engagementRate,
      },
      derived: { contentThemeLabels, decodedSymbols },
    },
    extras: businessSignal,
    expectedEvidenceSummary: evidenceSummary,
  });

  return {
    handle,
    platform: "Instagram",
    displayName: profile.full_name || handle,
    bio: profile.biography,
    followerCount: profile.follower_count,
    videoCount: profile.media_count,
    totalLikes,
    totalViews,
    avgViews,
    engagementRate,
    location,
    profileUrl: `https://www.instagram.com/${handle}/`,
    recentVideoTitles: videoTitles,
    topHashtags: allHashtags,
    rawKeywords,
    contentThemeLabels,
    contentThemes,
    transcripts,
    transcriptCount: transcripts.length,
    transcriptExcerpts,
    decodedSymbols: decodedSymbols as Record<string, unknown> | null,
    evidenceSummary,
    dataConfidenceLevel,
    // Session 8: Instagram has no computed engagement-signal block → the
    // sociological fields are LLM rubric estimates.
    sociologicalFieldsComputed: false,
    discoveredVideoPool,
  };
}



// ─── YouTube Creator Research ─────────────────────────────────────────────────

async function researchYouTubeCreator(handleOrUrl: string): Promise<CreatorResearchResult> {
  const handle = extractHandle(handleOrUrl);

  const ytData = await fetchYouTubeTranscripts(handle);
  const {
    transcripts, channelId, displayName, bio, followerCount, videoCount,
    totalViews, location, channelKeywords, videoTitles, videoViewCounts,
    quotaExhausted: ytQuotaExhausted,
  } = ytData;

  const hasYtContentData = transcripts.length > 0 || videoTitles.length > 0;
  const hasAnyYtData = hasYtContentData || followerCount > 0 || bio.length > 0;

  // Block when quota exhausted AND no content data — bio alone produces hallucinated profiles
  if (ytQuotaExhausted && !hasYtContentData) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `The YouTube data API is temporarily rate-limited from recent activity. No video content could be retrieved for @${handle}. Please wait 2–5 minutes and try again.`,
    });
  }

  if (!hasAnyYtData) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No public content found for @${handle}. Please verify the YouTube handle or channel URL is correct and that the channel is public.`,
    });
  }

  const avgViews = videoViewCounts.length > 0
    ? Math.round(videoViewCounts.reduce((a, b) => a + b, 0) / videoViewCounts.length)
    : totalViews > 0 && videoCount > 0 ? Math.round(totalViews / videoCount) : 0;
  const engagementRate = followerCount > 0 && avgViews > 0
    ? Math.min(100, Math.round((avgViews / followerCount) * 100 * 10) / 10)
    : 0;

  const uniqueVideoTitles = Array.from(new Set([...channelKeywords, ...videoTitles])).slice(0, 25);
  const topHashtags = extractHashtags([...uniqueVideoTitles, bio]);
  const transcriptTexts = transcripts.map(t => t.transcript);
  const rawKeywords = Array.from(new Set([...channelKeywords, ...extractKeywords([...uniqueVideoTitles, bio, ...transcriptTexts])])).slice(0, 40);
  // Use full transcript text for richer AI analysis (up to 6000 chars combined)
  const combinedTranscriptText = transcriptTexts.join(" ").slice(0, 6000);
  // Session 11 (Commit 3): themes + symbols are independent LLM calls — launch
  // both, do the local work (profile URL, excerpts) while they run, then await both.
  const themesPromise = translateKeywordsToThemes(rawKeywords, topHashtags, uniqueVideoTitles, bio, combinedTranscriptText);
  const symbolsPromise = decodeCreatorSymbols({
    handle,
    bio,
    videoTitles: uniqueVideoTitles,
    hashtags: topHashtags,
    transcriptExcerpts: transcripts.map(t => t.transcript),
  });
  const contentThemes = inferContentThemes(uniqueVideoTitles, topHashtags, bio);

  const profileUrl = channelId
    ? `https://www.youtube.com/channel/${channelId}`
    : `https://www.youtube.com/@${handle}`;

  // Store ALL transcripts in full (no truncation) for maximum language data
  const transcriptExcerpts = transcripts
    .map(t => `[${t.caption.slice(0, 60) || "video"}]: ${t.transcript}`)
    .join("\n\n");

  // Await themes + symbols (launched above, ran concurrently)
  const [contentThemeLabels, ytDecodedSymbols] = await Promise.all([themesPromise, symbolsPromise]);
  const ytDecodedSymbolsBlock = ytDecodedSymbols ? formatDecodedSymbolsBlock(ytDecodedSymbols) : "";

  const evidenceSummary = buildCreatorEvidenceSummary({
    handle, platform: "YouTube", displayName, bio, followerCount, videoCount,
    totalLikes: 0, totalViews, avgViews, engagementRate, location,
    videoTitles: uniqueVideoTitles, topHashtags, rawKeywords, contentThemeLabels, contentThemes,
    transcripts, decodedSymbolsBlock: ytDecodedSymbolsBlock,
  });

  return {
    handle, platform: "YouTube", displayName, bio, followerCount, videoCount,
    totalLikes: 0, totalViews, avgViews, engagementRate, location,
    profileUrl, recentVideoTitles: uniqueVideoTitles, topHashtags, rawKeywords,
    contentThemeLabels, contentThemes,
    transcripts, transcriptCount: transcripts.length, transcriptExcerpts,
    decodedSymbols: ytDecodedSymbols as Record<string, unknown> | null,
    evidenceSummary,
    // Session 8: YouTube has no computed engagement-signal block → estimated.
    sociologicalFieldsComputed: false,
  };
}

// ─── Recursive Brand Semantic Crawler ──────────────────────────────────────────

/**
 * Extract plain text from HTML, removing scripts, styles, and tags.
 */
function extractTextFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract internal links from HTML that match semantic page patterns
 * (About, Story, Blog, Mission, Values, Culture, etc.)
 */
function extractSemanticLinks(html: string, baseUrl: string): string[] {
  const semanticPatterns = [
    /about/i, /story/i, /mission/i, /values/i, /culture/i, /blog/i,
    /journal/i, /manifesto/i, /philosophy/i, /vision/i, /team/i, /who-we-are/i,
    /products?/i, /services?/i, /solutions?/i, /features?/i, /why-us/i, /our-story/i,
  ];


  const links: string[] = [];
  const seen = new Set<string>();
  const hrefMatches = Array.from(html.matchAll(/href="([^"#?]+)"/gi));

  let base: URL;
  try { base = new URL(baseUrl); } catch { return []; }

  for (const match of hrefMatches) {
    const href = match[1];
    if (!href) continue;

    let fullUrl: string;
    try {
      fullUrl = new URL(href, base).href;
    } catch {
      continue;
    }

    // Only follow internal links on the same origin
    if (!fullUrl.startsWith(base.origin)) continue;
    if (seen.has(fullUrl)) continue;
    if (fullUrl === baseUrl) continue;

    // Only follow links that match semantic patterns
    const path = new URL(fullUrl).pathname.toLowerCase();
    if (semanticPatterns.some(p => p.test(path))) {
      seen.add(fullUrl);
      links.push(fullUrl);
    }
  }

  return links.slice(0, 8); // max 8 semantic pages
}

/**
 * Recursively crawl a brand website to collect 2,000+ words of semantic content.
 * Follows internal links to About, Story, Blog, Mission pages.
 */
export async function crawlBrandWebsite(startUrl: string): Promise<{
  allText: string;
  snippets: string[];
  crawledPages: string[];
  wordCount: number;
}> {
  const TARGET_WORDS = 2000;
  const crawledPages: string[] = [];
  const allTextParts: string[] = [];
  const snippets: string[] = [];
  const visited = new Set<string>();

  const crawlPage = async (url: string): Promise<void> => {
    if (visited.has(url)) return;
    visited.add(url);

    try {
      const html = await fetchHtml(url);
      crawledPages.push(url);

      // Extract metadata (standard + Open Graph + keywords)
      const metaDesc = html.match(/<meta\s+(?:name|property)="description"\s+content="([^"]+)"/i)?.[1] ?? "";
      const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)?.[1] ?? "";
      const keywords = html.match(/<meta\s+name="keywords"\s+content="([^"]+)"/i)?.[1] ?? "";
      const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
      const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1] ?? "";

      if (metaDesc) snippets.push(`Page description (${new URL(url).pathname}): ${metaDesc}`);
      if (ogDesc && ogDesc !== metaDesc) snippets.push(`OG description: ${ogDesc}`);
      if (keywords) snippets.push(`Keywords: ${keywords}`);
      if (title && crawledPages.length === 1) snippets.push(`Website title: ${title}`);
      if (ogTitle && ogTitle !== title && crawledPages.length === 1) snippets.push(`OG title: ${ogTitle}`);

      // Extract headings (h1-h3)
      const headings = html.match(/<h[123][^>]*>([^<]+)<\/h[123]>/gi) ?? [];
      for (const h of headings.slice(0, 10)) {
        const text = h.replace(/<[^>]+>/g, "").trim();
        if (text.length > 5) snippets.push(`Heading (${new URL(url).pathname}): ${text}`);
      }

      // Extract structured data (JSON-LD schema.org)
      const jsonLdMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([^<]+)<\/script>/gi) ?? [];
      for (const jsonLd of jsonLdMatches.slice(0, 2)) {
        try {
          const jsonStr = jsonLd.replace(/<[^>]+>/g, "");
          const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
          if (parsed.description) snippets.push(`Schema description: ${parsed.description}`);
          if (parsed.name) snippets.push(`Schema name: ${parsed.name}`);
          if (parsed.sameAs) snippets.push(`Schema social: ${JSON.stringify(parsed.sameAs)}`);
        } catch { /* ignore parse errors */ }
      }

      // Extract body text
      const bodyText = extractTextFromHtml(html);
      allTextParts.push(`=== PAGE: ${url} ===\n${bodyText.slice(0, 3000)}`);

      const currentWordCount = allTextParts.join(" ").split(/\s+/).length;
      console.log(`[webResearch] Crawled ${url}: ${bodyText.split(/\s+/).length} words (total: ${currentWordCount})`);

      // If we haven't hit the target yet, follow semantic links from the root page
      if (currentWordCount < TARGET_WORDS && crawledPages.length === 1) {
        const semanticLinks = extractSemanticLinks(html, url);
        for (const link of semanticLinks) {
          if (allTextParts.join(" ").split(/\s+/).length >= TARGET_WORDS) break;
          await crawlPage(link);
          await new Promise(resolve => setTimeout(resolve, 300)); // polite delay
        }
      }
    } catch (err) {
      console.warn(`[webResearch] Brand crawl failed for ${url}:`, (err as Error).message);
    }
  };

  await crawlPage(startUrl);

  // Playwright fallback: if HTTP returned very little content (< 100 words),
  // the site is likely an SPA or JS-rendered. Try headless browser.
  const httpWordCount = allTextParts.join(" ").split(/\s+/).filter(w => w.length > 0).length;
  if (httpWordCount < 100) {
    console.log(`[brandCrawl] HTTP returned ${httpWordCount} words, trying Playwright fallback`);
    try {
      const { getContext } = await import("./scraping/browserClient");
      const ctx = await getContext("desktop-chrome");
      const { page } = ctx;
      try {
        await page.goto(startUrl, { waitUntil: "networkidle", timeout: 20000 });
        const pwHtml = await page.content();
        const pwBodyText = extractTextFromHtml(pwHtml);
        const pwWordCount = pwBodyText.split(/\s+/).filter(w => w.length > 0).length;
        console.log(`[brandCrawl] Playwright returned ${pwWordCount} words`);

        if (pwWordCount > httpWordCount) {
          // Replace root page content with richer Playwright result
          allTextParts.length = 0;
          snippets.length = 0;
          crawledPages.length = 0;

          crawledPages.push(startUrl);
          allTextParts.push(`=== PAGE: ${startUrl} (playwright) ===\n${pwBodyText.slice(0, 3000)}`);

          // Re-extract metadata from Playwright-rendered HTML
          const metaDesc = pwHtml.match(/<meta\s+(?:name|property)="description"\s+content="([^"]+)"/i)?.[1] ?? "";
          const ogDesc = pwHtml.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)?.[1] ?? "";
          const kw = pwHtml.match(/<meta\s+name="keywords"\s+content="([^"]+)"/i)?.[1] ?? "";
          const title = pwHtml.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";

          if (metaDesc) snippets.push(`Page description (/): ${metaDesc}`);
          if (ogDesc && ogDesc !== metaDesc) snippets.push(`OG description: ${ogDesc}`);
          if (kw) snippets.push(`Keywords: ${kw}`);
          if (title) snippets.push(`Website title: ${title}`);

          const headings = pwHtml.match(/<h[123][^>]*>([^<]+)<\/h[123]>/gi) ?? [];
          for (const h of headings.slice(0, 10)) {
            const text = h.replace(/<[^>]+>/g, "").trim();
            if (text.length > 5) snippets.push(`Heading (/): ${text}`);
          }
        }
      } finally {
        await page.close().catch(() => {});
      }
    } catch (err) {
      console.warn(`[brandCrawl] Playwright fallback failed:`, (err as Error).message);
    }
  }

  const allText = allTextParts.join("\n\n");
  const wordCount = allText.split(/\s+/).length;
  console.log(`[webResearch] Brand crawl complete: ${crawledPages.length} pages, ${wordCount} words`);

  return { allText, snippets, crawledPages, wordCount };
}

// ─── Brand Research ───────────────────────────────────────────────────────────

// ─── Metadata Extraction Helper ────────────────────────────────────────────────

/**
 * Extract metadata keywords from website HTML/text.
 * Looks for meta tags, Open Graph, and JSON-LD structured data.
 */
function extractMetadataKeywords(websiteText: string): string[] {
  const keywords: Set<string> = new Set();

  // Extract from meta keywords tag
  const metaKeywordsMatch = websiteText.match(/<meta\s+name=["']keywords["'']\s+content=["'']([^"']+)["'']>/i);
  if (metaKeywordsMatch) {
    metaKeywordsMatch[1].split(',').forEach(k => {
      const trimmed = k.trim().toLowerCase();
      if (trimmed.length > 2 && trimmed.length < 50) keywords.add(trimmed);
    });
  }

  // Extract from Open Graph description and title
  const ogDescMatch = websiteText.match(/<meta\s+property=["']og:description["'']\s+content=["'']([^"']+)["'']>/i);
  if (ogDescMatch) {
    ogDescMatch[1].split(/\s+/).slice(0, 15).forEach(word => {
      const clean = word.toLowerCase().replace(/[^a-z0-9\s]/g, '');
      if (clean.length > 2 && clean.length < 30) keywords.add(clean);
    });
  }

  // Extract from schema.org description
  const schemaMatch = websiteText.match(/"description"\s*:\s*"([^"]+)"/i);
  if (schemaMatch) {
    schemaMatch[1].split(/\s+/).slice(0, 15).forEach(word => {
      const clean = word.toLowerCase().replace(/[^a-z0-9\s]/g, '');
      if (clean.length > 2 && clean.length < 30) keywords.add(clean);
    });
  }

  return Array.from(keywords).slice(0, 25);
}

/**
 * BRAND SYMBOL DECODING, AS ITS OWN UNIT (S5 Part 2 — the derive split).
 *
 * Lifted VERBATIM out of `researchBrand`: same 80-character floor, same
 * metadata-keyword extraction, same sentiment mapping, same non-fatal catch.
 * Nothing about what it computes changed — only that it is now callable on its
 * own, which is what lets a derive PHASE run it instead of the collection step.
 *
 * Non-fatal by design, and that is load-bearing: a brand whose decoder fails
 * still produces evidence, just without the symbols block. Making this throw
 * would turn a degraded brand analysis into no brand analysis.
 */
export async function deriveBrandSymbols(input: {
  brandName: string;
  websiteText: string;
  reviewText: string;
  audienceMentionData: AudienceMentionData | null;
}): Promise<BrandDecodedSymbols | null> {
  const { brandName, websiteText, reviewText, audienceMentionData } = input;
  // Minimum viable text: need at least 80 chars combined to run the decoder meaningfully
  const combinedTextLength = websiteText.length + reviewText.length;
  try {
    if (combinedTextLength >= 80) {
      // Extract metadata keywords from website text (meta tags, Open Graph, JSON-LD)
      const metadataKeywords = extractMetadataKeywords(websiteText);

      // Mention keywords and sentiment from TikTok audience mention analysis
      let mentionKeywords: string[] | undefined;
      let mentionSentiment: "positive" | "mixed" | "negative" | undefined;

      if (audienceMentionData) {
        // Extract hashtags from mention data
        mentionKeywords = audienceMentionData.mentionHashtags || [];
        // Map sentiment signal to the expected type
        if (audienceMentionData.sentimentSignal === "positive") {
          mentionSentiment = "positive";
        } else if (audienceMentionData.sentimentSignal === "negative") {
          mentionSentiment = "negative";
        } else {
          mentionSentiment = "mixed";
        }
      }

      return await decodeBrandSymbols({
        brandName,
        websiteText,
        reviewText,
        metadataKeywords,
        mentionKeywords,
        mentionSentiment,
      });
    }
    console.warn(`[webResearch] Brand Symbol Decoder skipped — insufficient text (${combinedTextLength} chars) for ${brandName}`);
  } catch (err) {
    console.warn("[webResearch] Brand Symbol Decoder failed (non-fatal):", err);
  }
  return null;
}

export async function researchBrand(brandNameOrUrl: string, googleMapsUrl?: string): Promise<BrandResearchResult> {
  const isUrl = brandNameOrUrl.startsWith("http");
  const brandName = isUrl
    ? brandNameOrUrl.replace(/https?:\/\/(www\.)?/, "").split("/")[0]
    : brandNameOrUrl;

  let snippets: string[] = [];
  let description = "";
  let semanticWordCount = 0;
  let crawledPages: string[] = [];

  if (isUrl) {
    try {
      // Phase 1.5: Recursive semantic crawl targeting 2,000+ words
      const crawlStart = Date.now();
      const crawlResult = await crawlBrandWebsite(brandNameOrUrl);
      snippets = crawlResult.snippets;
      // Use full crawled text as description for richer AI analysis
      description = crawlResult.allText.slice(0, 6000);
      semanticWordCount = crawlResult.wordCount;
      crawledPages = crawlResult.crawledPages;
      console.log(`[webResearch] Brand ${brandName}: crawled ${crawledPages.length} pages, ${semanticWordCount} words`);
      // Log scrape event
      try {
        await insertScrapeEvent({
          scrapeMethod: "website_crawl",
          urlRequested: brandNameOrUrl,
          httpStatus: semanticWordCount > 0 ? 200 : 204,
          responseSizeBytes: crawlResult.allText.length,
          durationMs: Date.now() - crawlStart,
        });
      } catch { /* non-fatal */ }
    } catch (err) {
      console.warn("[webResearch] Brand website crawl failed:", err);
    }
  }

  // Fallback: If crawl was insufficient or no URL provided, use Google Search API first
  if (!isUrl || semanticWordCount < 500) {
    try {
      const searchStart = Date.now();
      const googleResponse = await searchWeb(`${brandName} company about mission values`) as unknown as Record<string, unknown>;
      const results = (googleResponse?.results as unknown[]) ?? [];
      for (const result of results.slice(0, 3)) {
        const item = result as Record<string, unknown>;
        const title = (item?.title as string) ?? "";
        const snippet = (item?.snippet as string) ?? "";
        if (title) snippets.push(`Google: ${title}`);
        if (snippet) snippets.push(`${snippet}`);
      }
      if (!description && snippets.length > 0) {
        description = snippets.join(" | ").slice(0, 2000);
      }
      console.log(`[webResearch] Brand ${brandName}: supplemented with Google Search results`);
      // Log scrape event
      try {
        await insertScrapeEvent({
          scrapeMethod: "google_search",
          urlRequested: `Google Search: ${brandName}`,
          httpStatus: results.length > 0 ? 200 : 204,
          durationMs: Date.now() - searchStart,
        });
      } catch { /* non-fatal */ }
    } catch (err) {
      console.warn("[webResearch] Brand Google search failed (non-fatal):", err);
    }
  }

  // Secondary fallback: YouTube search if still insufficient
  if (!isUrl || (snippets.length < 3 && semanticWordCount < 300)) {
    try {
      const ytResponse = await searchYouTube(`${brandName} brand about`, { hl: "en", gl: "US" }) as unknown as Record<string, unknown>;
      const contents = (ytResponse?.contents as unknown[]) ?? [];
      for (const item of contents.slice(0, 5)) {
        const videoData = ((item as Record<string, unknown>)?.video as Record<string, unknown>);
        if (videoData) {
          const title = (videoData?.title as string) ?? "";
          const desc = (videoData?.descriptionSnippet as string) ?? "";
          if (title) snippets.push(`YouTube: ${title}`);
          if (desc) snippets.push(`${desc}`);
        }
      }
      if (!description && snippets.length > 0) {
        description = snippets.join(" | ").slice(0, 1000);
      }
    } catch (err) {
      console.warn("[webResearch] Brand YouTube search failed (non-fatal):", err);
    }
  }

  // Fetch audience perception data from Yelp and Google Maps (non-fatal)
  let reviewResult = {
    sources: [] as import("./reviewResearch").ReviewSource[],
    combinedReviewText: "",
    overallRating: null as number | null,
    totalReviews: 0,
    audiencePerceptionBlock: "",
  };
  try {
    reviewResult = await fetchBrandReviews(brandName, isUrl ? brandNameOrUrl : "", googleMapsUrl);
  } catch (err) {
    console.warn("[webResearch] Review fetch failed (non-fatal):", err);
  }

  // Extract per-platform data
  const yelpSource = reviewResult.sources.find(s => s.platform === "Yelp") ?? null;
  const googleSource = reviewResult.sources.find(s => s.platform === "Google Maps") ?? null;

  const yelpRating = yelpSource?.rating ?? null;
  const yelpReviewCount = yelpSource?.reviewCount ?? null;
  const yelpReviewExcerpts = yelpSource?.reviews
    .map(r => `[${r.rating}\u2605] ${r.author}: "${r.text.slice(0, 300)}"`)
    .join("\n\n") ?? "";
  const googleRating = googleSource?.rating ?? null;
  const googleReviewCount = googleSource?.reviewCount ?? null;
  const googleReviewExcerpts = googleSource?.reviews
    .map(r => `[${r.rating}\u2605] ${r.author}: "${r.text.slice(0, 300)}"`)
    .join("\n\n") ?? "";

  const brandBaseInputs = {
    brandName,
    websiteUrl: isUrl ? brandNameOrUrl : null,
    description,
    snippets,
    audiencePerceptionBlock: reviewResult.audiencePerceptionBlock || null,
  };
  const evidenceSummary = buildBrandBaseEvidence(brandBaseInputs);

  // Phase 6: Fetch audience mention intelligence from TikTok (non-fatal)
  let audienceMentionData: AudienceMentionData | null = null;
  try {
    audienceMentionData = await fetchBrandMentionData(brandName);
    if (audienceMentionData) {
      console.log(`[webResearch] Brand ${brandName}: fetched ${audienceMentionData.totalMentions} TikTok mentions from ${audienceMentionData.uniqueAuthors} creators, sentiment: ${audienceMentionData.sentimentSignal}`);
    }
  } catch (err) {
    console.warn("[webResearch] Audience mention fetch failed (non-fatal):", err);
  }

  // Run Brand Symbol Decoder on website text + review text (non-fatal)
  // websiteText corpus: always include all available text sources (description, snippets, Yelp excerpts, Google excerpts)
  // This ensures the decoder runs even when the direct HTML fetch is blocked by Cloudflare or other protection
  let brandDecodedSymbols: BrandDecodedSymbols | null = null;
  const websiteTextParts = [
    description,
    ...snippets,
  ].filter(Boolean);

  // If direct website fetch yielded very little text (<150 chars), supplement with review excerpts in the website corpus
  // so the decoder has enough signal to work with
  const directWebTextLength = websiteTextParts.join(" ").length;
  if (directWebTextLength < 150) {
    // Add Yelp and Google snippets as supplementary brand text
    if (yelpReviewExcerpts) websiteTextParts.push(`Yelp customer reviews: ${yelpReviewExcerpts.slice(0, 800)}`);
    if (googleReviewExcerpts) websiteTextParts.push(`Google Maps customer reviews: ${googleReviewExcerpts.slice(0, 800)}`);
    console.log(`[webResearch] Direct web text too short (${directWebTextLength} chars) — using review text as website corpus fallback for Symbol Decoder`);
  }

  const websiteText = websiteTextParts.join("\n");
  const reviewText = reviewResult.combinedReviewText;

  brandDecodedSymbols = await deriveBrandSymbols({
    brandName, websiteText, reviewText, audienceMentionData,
  });

  // Inject decoded symbols block into evidence summary for AI extraction
  /**
   * The blocks are now handed UNPREFIXED to the shared assembly (S5, Part 1).
   * Byte-identical by construction: this used to be `"\n\n" + block` when the
   * block existed and `""` when it did not, which is precisely the rule
   * `assembleBrandEvidence` applies. What changes is WHERE the concatenation
   * lives — so that moving decodeBrandSymbols into a derive phase cannot
   * reorder it.
   */
  const evidenceParts: BrandEvidenceParts = {
    base: evidenceSummary,
    decodedSymbolsBlock: brandDecodedSymbols
      ? formatBrandDecodedSymbolsBlock(brandDecodedSymbols)
      : null,
    mentionEvidenceBlock: audienceMentionData
      ? formatAudienceMentionEvidenceBlock(audienceMentionData)
      : null,
  };

  const evidenceSummaryWithSymbols = assembleBrandEvidence(evidenceParts);

  // Actualize Goffman gap signal: compare brand-authored vocabulary vs audience vocabulary
  if (audienceMentionData && brandDecodedSymbols) {
    const brandVocab = new Set([
      ...brandDecodedSymbols.rawKeywords.map(k => k.toLowerCase()),
      ...brandDecodedSymbols.symbolicVocabulary.map(v => v.toLowerCase()),
      ...brandDecodedSymbols.themeLabels.map(t => t.toLowerCase()),
    ]);
    const audienceVocab = new Set([
      ...audienceMentionData.mentionHashtags.map(h => h.toLowerCase().replace(/^#/, "")),
      ...audienceMentionData.audienceIdentityClaims.map(c => c.toLowerCase()),
      ...audienceMentionData.audienceStatusSignals.map(s => s.toLowerCase()),
    ]);
    if (brandVocab.size > 0 && audienceVocab.size > 0) {
      let overlap = 0;
      const brandVocabArr = Array.from(brandVocab);
      for (const word of brandVocabArr) {
        if (audienceVocab.has(word)) overlap++;
      }
      const overlapRatio = overlap / Math.min(brandVocab.size, audienceVocab.size);
      if (overlapRatio >= 0.3) {
        audienceMentionData.goffmanGapSignal = "Consistent";
      } else if (overlapRatio >= 0.1) {
        audienceMentionData.goffmanGapSignal = "Minor Gap";
      } else {
        audienceMentionData.goffmanGapSignal = "Significant Gap";
      }
      console.log(`[webResearch] Goffman gap: brand vocab ${brandVocab.size}, audience vocab ${audienceVocab.size}, overlap ${overlap} (${(overlapRatio * 100).toFixed(1)}%) → ${audienceMentionData.goffmanGapSignal}`);
    }
  }

  // Compute data confidence level for brand
  // P1-4: Factor review data into confidence — reviews provide genuine audience perception evidence
  const reviewEvidenceBoost = reviewResult.totalReviews >= 30 ? 1000 :
    reviewResult.totalReviews >= 10 ? 500 : 0;
  const evidenceScore = semanticWordCount + reviewEvidenceBoost;
  const brandDataConfidenceLevel: BrandResearchResult["dataConfidenceLevel"] =
    evidenceScore >= 2000 ? "high" :
      evidenceScore >= 500 ? "medium" :
        "low";

  // ── P0-1: Minimum evidence guard ──
  // Prevent fully hallucinated brand profiles when all evidence sources fail.
  // This is the brand pipeline equivalent of the creator pipeline's transcript threshold.
  const hasInsufficientWebsite = semanticWordCount < 100;
  const hasNoReviews = reviewResult.totalReviews === 0;
  const hasNoMentions = !audienceMentionData || audienceMentionData.totalMentions === 0;
  const hasNoSnippets = snippets.length < 3;

  if (hasInsufficientWebsite && hasNoReviews && hasNoMentions && hasNoSnippets) {
    console.error(`[webResearch] Brand ${brandName}: INSUFFICIENT EVIDENCE — website: ${semanticWordCount} words, reviews: ${reviewResult.totalReviews}, mentions: ${audienceMentionData?.totalMentions ?? 0}, snippets: ${snippets.length}`);
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Insufficient data to analyze this brand. No website content, reviews, or social mentions could be found. Please verify the brand URL is accessible and try again.",
    });
  }

  // Build tiktokMetadata object for performance signals
  const tiktokMetadata = audienceMentionData ? {
    mentionHashtags: audienceMentionData.mentionHashtags || [],
    mentionCaptions: audienceMentionData.mentionCaptions || [],
    mentionMusicTitles: audienceMentionData.mentionMusicTitles || [],
    mentionSentiment: audienceMentionData.sentimentSignal,
    totalMentions: audienceMentionData.totalMentions,
    avgWeightedEngagement: audienceMentionData.avgWeightedEngagement,
    uniqueAuthors: audienceMentionData.uniqueAuthors,
  } : null;

  return {
    brandName,
    websiteUrl: isUrl ? brandNameOrUrl : "",
    description,
    searchSnippets: snippets,
    evidenceSummary: evidenceSummaryWithSymbols,
    evidenceParts,
    brandBaseInputs,
    yelpRating,
    yelpReviewCount,
    yelpReviewExcerpts,
    googleRating,
    googleReviewCount,
    googleReviewExcerpts,
    combinedReviewText: reviewResult.combinedReviewText,
    overallRating: reviewResult.overallRating,
    totalReviews: reviewResult.totalReviews,
    brandDecodedSymbols,
    brandRawKeywords: brandDecodedSymbols?.rawKeywords ?? [],
    brandThemeLabels: brandDecodedSymbols?.themeLabels ?? [],
    brandSymbolicVocabulary: brandDecodedSymbols?.symbolicVocabulary ?? [],
    semanticWordCount,
    crawledPages,
    dataConfidenceLevel: brandDataConfidenceLevel,
    audienceMentionData,
    tiktokMetadata,
  };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * DEAD CODE, and the "Multi" platform is RETIRED IN PRACTICE.
 *
 * Nothing calls this. S3b made the queue the single entry point, so the live
 * path is creatorCampaign → runCollection; `analysisQueue.test.ts` asserts that
 * routers.ts never calls this function.
 *
 * Its "Multi" branch merged TikTok WITH YouTube. With YouTube disabled that
 * branch has one working leg left, so it would return a TikTok result labelled
 * `platform: "Multi"` — a worse TikTok analysis under a misleading name. Multi
 * is therefore not meaningful and must not be revived as-is: `creator.submit`
 * has never accepted it, and no caller can reach it.
 *
 * Kept, not deleted, for the same reason as the YouTube scrapers — see
 * docs/YOUTUBE_DISABLED.md.
 */
export async function researchCreator(
  handleOrUrl: string,
  platform: string
): Promise<CreatorResearchResult> {
  const handle = extractHandle(handleOrUrl);

  if (platform === "YouTube" || handleOrUrl.includes("youtube.com")) {
    return researchYouTubeCreator(handle);
  }

  if (platform === "Instagram" || handleOrUrl.includes("instagram.com")) {
    return researchInstagramCreator(handle);
  }

  if (platform === "Multi") {
    // Run both and merge — TikTok as primary
    const [tiktokResult, youtubeResult] = await Promise.allSettled([
      researchTikTokCreator(handle),
      researchYouTubeCreator(handle),
    ]);

    const tiktok = tiktokResult.status === "fulfilled" ? tiktokResult.value : null;
    const youtube = youtubeResult.status === "fulfilled" ? youtubeResult.value : null;

    if (!tiktok && !youtube) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Not enough public content found for @${handle} on either TikTok or YouTube. Please verify the handle is correct.`,
      });
    }
    if (!tiktok) return youtube!;
    if (!youtube) return tiktok;

    // Merge: combine all data, transcripts from both platforms
    const mergedTitles = Array.from(new Set([...tiktok.recentVideoTitles, ...youtube.recentVideoTitles])).slice(0, 30);
    const mergedHashtags = Array.from(new Set([...tiktok.topHashtags, ...youtube.topHashtags])).slice(0, 20);
    const mergedKeywords = Array.from(new Set([...tiktok.rawKeywords, ...youtube.rawKeywords])).slice(0, 40);
    const mergedThemes = Array.from(new Set([...tiktok.contentThemeLabels, ...youtube.contentThemeLabels])).slice(0, 5);
    const mergedTranscripts = [...tiktok.transcripts, ...youtube.transcripts];
    const mergedExcerpts = [tiktok.transcriptExcerpts, youtube.transcriptExcerpts].filter(Boolean).join("\n\n---\n\n");

    const merged: CreatorResearchResult = {
      handle,
      platform: "Multi",
      displayName: tiktok.displayName !== handle ? tiktok.displayName : youtube.displayName,
      bio: tiktok.bio || youtube.bio,
      followerCount: Math.max(tiktok.followerCount, youtube.followerCount),
      videoCount: tiktok.videoCount + youtube.videoCount,
      totalLikes: tiktok.totalLikes,
      totalViews: tiktok.totalViews + youtube.totalViews,
      avgViews: Math.max(tiktok.avgViews, youtube.avgViews),
      engagementRate: Math.max(tiktok.engagementRate, youtube.engagementRate),
      location: tiktok.location || youtube.location,
      profileUrl: tiktok.profileUrl,
      recentVideoTitles: mergedTitles,
      topHashtags: mergedHashtags,
      rawKeywords: mergedKeywords,
      contentThemeLabels: mergedThemes,
      contentThemes: Array.from(new Set([...tiktok.contentThemes, ...youtube.contentThemes])).slice(0, 5),
      transcripts: mergedTranscripts,
      transcriptCount: mergedTranscripts.length,
      transcriptExcerpts: mergedExcerpts,
      evidenceSummary: `${tiktok.evidenceSummary}\n\n--- YOUTUBE EVIDENCE ---\n${youtube.evidenceSummary}`,
      // Preserve fields that were previously dropped in the Multi merge. TikTok is
      // primary; fall back to YouTube. Field-merge only — no scoring/extraction change.
      followingCount: tiktok.followingCount ?? youtube.followingCount,
      decodedSymbols: tiktok.decodedSymbols ?? youtube.decodedSymbols,
      longitudinalSample: tiktok.longitudinalSample ?? youtube.longitudinalSample,
      culturalVelocity: tiktok.culturalVelocity ?? youtube.culturalVelocity,
      dataConfidenceLevel: tiktok.dataConfidenceLevel ?? youtube.dataConfidenceLevel,
      sociologicalFieldsComputed: tiktok.sociologicalFieldsComputed ?? youtube.sociologicalFieldsComputed,
      discoveredVideoPool: [
        ...(tiktok.discoveredVideoPool ?? []),
        ...(youtube.discoveredVideoPool ?? []),
      ],
    };
    return merged;
  }

  // Default: TikTok
  return researchTikTokCreator(handle);
}

/**
 * Exported helper: fetch transcript for a single TikTok video by URL.
 * Used by the supplemental video ingestion feature.
 * Tries captions first (re-fetching fresh page HTML to get current subtitle URLs).
 * Returns null if no captions are available — Whisper is not used here because
 * TikTok playAddr URLs require authentication and expire quickly.
 */
export async function fetchSingleTikTokTranscript(
  videoUrl: string,
  videoId: string,
  caption: string
): Promise<TranscriptEntry | null> {
  // Extract handle from URL (e.g. https://www.tiktok.com/@kaylee.nhi/video/123)
  const handleMatch = videoUrl.match(/tiktok\.com\/@([^/]+)/);
  const handle = handleMatch ? handleMatch[1] : "unknown";

  // Re-fetch the video page to get fresh subtitle URLs (playAddr/subtitleInfos expire)
  // This is more reliable than using cached URLs from the initial analysis
  try {
    const html = await fetchHtml(videoUrl, { extraHeaders: { Referer: "https://www.tiktok.com/" } });
    const rehydrationMatch = html.match(
      /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (rehydrationMatch) {
      const pageData = JSON.parse(rehydrationMatch[1]) as Record<string, unknown>;
      const defaultScope = (pageData?.["__DEFAULT_SCOPE__"] as Record<string, unknown>) ?? {};
      const videoDetail = (defaultScope?.["webapp.video-detail"] as Record<string, unknown>) ?? {};
      const itemStruct = (videoDetail?.itemInfo as Record<string, unknown>)?.itemStruct as Record<string, unknown> ?? {};
      const videoObj = (itemStruct?.video as Record<string, unknown>) ?? {};
      const subtitleInfos = (videoObj?.subtitleInfos as Array<Record<string, unknown>>) ?? [];

      if (subtitleInfos.length > 0) {
        // Fresh subtitles found — fetch them
        const engSub = subtitleInfos.find(
          (s) => (s?.LanguageCodeName as string)?.startsWith("eng")
        ) ?? subtitleInfos[0];
        const subtitleUrl = engSub?.Url as string;

        if (subtitleUrl) {
          const { default: axios } = await import("axios");
          const subResponse = await axios.get(subtitleUrl, {
            headers: {
              "Referer": "https://www.tiktok.com/",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            timeout: 10000,
            responseType: "text",
          });
          const vttText = subResponse.data as string;
          const transcript = parseWebVTT(vttText);
          if (transcript && transcript.length >= 10) {
            const wordCount = transcript.split(/\s+/).length;
            console.log(`[webResearch] ✅ Fresh subtitle transcript for supplemental video ${videoId}: ${wordCount} words`);
            return { videoId, videoUrl, caption, transcript, wordCount, transcriptSource: TRANSCRIPT_SOURCE.subtitle };
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[webResearch] Fresh page fetch failed for supplemental video ${videoId}:`, (err as Error).message);
  }

  // Caption fallback: store the video caption as a minimal transcript
  if (caption && caption.trim().length >= 10) {
    const wordCount = caption.trim().split(/\s+/).length;
    console.log(`[webResearch] Supplemental video ${videoId}: caption fallback | ${wordCount} words`);
    return { videoId, videoUrl, caption, transcript: caption.trim(), wordCount, transcriptSource: TRANSCRIPT_SOURCE.postCaption };
  }

  console.log(`[webResearch] Supplemental video ${videoId}: no captions available`);
  return null;
}
