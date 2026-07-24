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

import { fetchHtml, requestGovernor, recordScrapeEvent } from "./scraping/httpClient";
import { getContext, retireContext } from "./scraping/browserClient";
import pLimit from "p-limit";
import { scrapeTikTokProfile } from "./scraping/tiktok/profileScraper";
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
import { insertScrapeEvent } from "./db";
import { TRANSCRIPT_SOURCE, isSpeechTranscript } from "@shared/transcriptSource";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TranscriptEntry {
  videoId: string;
  videoUrl: string;
  caption: string;       // The video's text caption / title
  transcript: string;    // Full spoken transcript (plain text)
  wordCount: number;
  bucket?: "recent" | "mid" | "anchor"; // 6-3-3 temporal bucket
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
  // Supplemental video pool — all discovered video URLs with engagement stats
  discoveredVideoPool?: Array<{
    id: string; url: string; caption: string; createTime: number;
    views: number; likes: number; comments: number; saves: number; shares: number;
    musicOriginal: boolean; musicTitle?: string; musicArtist?: string;
    durationSec: number;
  }>;
}

export interface BrandResearchResult {
  brandName: string;
  websiteUrl: string;
  description: string;
  searchSnippets: string[];
  evidenceSummary: string;
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

function extractHashtags(texts: string[]): string[] {
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
      if (!stopWords.has(word)) {
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

/**
 * Parse a WEBVTT subtitle file into plain text.
 * Removes timestamps, cue IDs, and the WEBVTT header.
 * Deduplicates consecutive identical lines (common in TikTok WEBVTT).
 */
function parseWebVTT(vtt: string): string {
  const lines = vtt.split("\n");
  const textLines: string[] = [];
  let lastLine = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Skip: empty, WEBVTT header, timestamp lines (00:00:00.000 --> 00:00:02.000)
    if (!line) continue;
    if (line.startsWith("WEBVTT")) continue;
    if (/^\d{2}:\d{2}/.test(line) && line.includes("-->")) continue;
    // Skip pure numeric cue IDs
    if (/^\d+$/.test(line)) continue;
    // Skip HTML-like tags that sometimes appear
    if (line.startsWith("<") && line.endsWith(">")) continue;

    // Deduplicate consecutive identical lines
    if (line !== lastLine) {
      textLines.push(line);
      lastLine = line;
    }
  }

  return textLines.join(" ").replace(/\s+/g, " ").trim();
}

// ─── TikTok Transcript Fetcher — Multi-Path System ────────────────────────────

/**
 * Multi-path transcript extraction for a single TikTok video.
 *
 * Path A: HTTP WEBVTT — fast path, fetch video page via HTTP, extract subtitleInfos
 * Path B+C: Playwright combined — single browser navigation, extract subtitleInfos
 *           via page.evaluate() AND intercept subtitle XHR requests simultaneously
 * Path E: Caption fallback — store the video caption as a minimal transcript
 *
 * Path D (Whisper via Playwright video URL) is deferred to Pass 2.
 */
async function fetchVideoTranscriptMultiPath(
  handle: string,
  videoId: string,
  caption: string,
  bucket: "recent" | "mid" | "anchor" = "recent",
  createTime?: number,
  metadata?: { musicTitle?: string; musicOriginal?: boolean; duetEnabled?: boolean; stitchEnabled?: boolean; durationMs?: number; collaborations?: string[] },
  /** Shared Playwright context — reused across the batch to avoid one browser tab per video */
  sharedCtx?: { context: Awaited<ReturnType<typeof getContext>>["context"]; page?: null },
): Promise<TranscriptEntry | null> {
  const videoUrl = `https://www.tiktok.com/@${handle}/video/${videoId}`;

  function enrichEntry(entry: TranscriptEntry): TranscriptEntry {
    if (metadata?.musicTitle) entry.musicMetadata = { soundName: metadata.musicTitle, isOriginal: metadata.musicOriginal };
    if (metadata?.duetEnabled || metadata?.stitchEnabled) entry.remixMetadata = { duetCount: 0, stitchCount: 0 };
    if (metadata?.durationMs) entry.videoDuration = Math.round(metadata.durationMs / 1000);
    if (metadata?.collaborations?.length) entry.collaborations = metadata.collaborations;
    return entry;
  }

  // ── PATH A: HTTP WEBVTT (fast path) ─────────────────────────────────────────
  try {
    const html = await fetchHtml(videoUrl, { extraHeaders: { Referer: "https://www.tiktok.com/" } });
    const rehydrationMatch = html.match(
      /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (rehydrationMatch) {
      const pageData = JSON.parse(rehydrationMatch[1]) as Record<string, unknown>;
      const defaultScope = (pageData?.["__DEFAULT_SCOPE__"] as Record<string, unknown>) ?? {};
      const videoDetail = (defaultScope?.["webapp.video-detail"] as Record<string, unknown>) ?? {};
      const itemStruct = (videoDetail?.itemInfo as Record<string, unknown>)?.itemStruct as Record<string, unknown> ?? {};
      const videoObj = (itemStruct?.video as Record<string, unknown>) ?? {};
      const subtitleInfos = (videoObj?.subtitleInfos as Array<Record<string, unknown>>) ?? [];

      console.log(`[transcript] ${videoId}: path-A attempted, subtitleInfos count: ${subtitleInfos.length}`);

      if (subtitleInfos.length > 0) {
        const transcript = await downloadAndParseSubtitle(subtitleInfos);
        if (transcript) {
          console.log(`[transcript] ${videoId}: path-A succeeded | ${transcript.wordCount} words`);
          return enrichEntry({ ...transcript, videoId, videoUrl, caption, bucket, createTime, transcriptSource: TRANSCRIPT_SOURCE.subtitle });
        }
      }
    } else {
      console.log(`[transcript] ${videoId}: path-A no rehydration data`);
    }
  } catch (err) {
    console.warn(`[transcript] ${videoId}: path-A failed: ${(err as Error).message}`);
  }

  // ── PATH B+C: Playwright combined (subtitle extraction + XHR interception) ──
  try {
    await requestGovernor("tiktok");

    // Get a page from the shared context or create new
    const ctx = sharedCtx ?? await getContext("desktop-chrome");
    const page = await ctx.context.newPage();

    try {
      // Set up XHR interception for subtitle files BEFORE navigating
      let capturedSubtitleText: string | null = null;
      let subtitleCaptured = false;

      await page.route(/\.(vtt|webvtt)(\?|$)|subtitle|subtitles/i, async (route) => {
        try {
          const url = route.request().url();
          // Only intercept from TikTok CDN domains
          if (url.includes("tiktokcdn.com") || url.includes("tiktokv.com") || url.includes("musical.ly") || url.includes("byteicdn.com") || url.includes("ibytedtos.com")) {
            const response = await route.fetch();
            const body = await response.text();
            if (body && (body.includes("WEBVTT") || body.includes("-->")) && body.length > 20) {
              capturedSubtitleText = body;
              subtitleCaptured = true;
              console.log(`[transcript] ${videoId}: path-C XHR intercepted subtitle (${body.length} bytes)`);
            }
            await route.fulfill({ response });
          } else {
            await route.continue();
          }
        } catch {
          await route.continue().catch(() => { });
        }
      });

      // Navigate to the video page
      await page.goto(videoUrl, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {
        // networkidle may time out — page can still be usable
      });

      // Wait a moment for any subtitle XHR to complete
      await page.waitForTimeout(2000);

      // PATH B: Extract subtitleInfos via page.evaluate()
      const subtitleUrls = await page.evaluate(() => {
        try {
          // Try reading from window object first
          const win = window as any;
          let rehydrationData = win.__UNIVERSAL_DATA_FOR_REHYDRATION__;

          // Fallback: parse from script tag
          if (!rehydrationData) {
            const scriptEl = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
            if (scriptEl?.textContent) {
              rehydrationData = JSON.parse(scriptEl.textContent);
            }
          }

          if (!rehydrationData) return [];

          const scope = rehydrationData?.__DEFAULT_SCOPE__ ?? {};
          const videoDetail = scope?.["webapp.video-detail"] ?? {};
          const itemStruct = videoDetail?.itemInfo?.itemStruct ?? {};
          const video = itemStruct?.video ?? {};
          const subtitleInfos = video?.subtitleInfos ?? [];

          if (!Array.isArray(subtitleInfos) || subtitleInfos.length === 0) return [];

          // Return URLs, preferring English
          return subtitleInfos.map((s: any) => ({
            url: s?.Url ?? s?.url ?? "",
            lang: s?.LanguageCodeName ?? s?.languageCodeName ?? "",
            format: s?.Format ?? s?.format ?? "",
          }));
        } catch {
          return [];
        }
      }) as Array<{ url: string; lang: string; format: string }>;

      console.log(`[transcript] ${videoId}: path-B page.evaluate() found ${subtitleUrls.length} subtitles`);

      // Try to download WEBVTT from the URLs found by page.evaluate()
      if (subtitleUrls.length > 0) {
        // Prefer English
        const engSub = subtitleUrls.find(s => s.lang.startsWith("eng")) ?? subtitleUrls[0];
        if (engSub.url) {
          const transcript = await downloadWebVTT(engSub.url);
          if (transcript) {
            console.log(`[transcript] ${videoId}: path-B succeeded | ${transcript.wordCount} words`);
            await page.close().catch(() => { });
            return enrichEntry({ ...transcript, videoId, videoUrl, caption, bucket, createTime, transcriptSource: TRANSCRIPT_SOURCE.subtitle });
          }
        }
      }

      // PATH C: Check if XHR interception captured a subtitle file
      // Wait a bit more for any late subtitle XHR
      if (!subtitleCaptured) {
        await page.waitForTimeout(2000);
      }

      if (capturedSubtitleText) {
        const transcript = parseWebVTT(capturedSubtitleText);
        if (transcript && transcript.length >= 10) {
          const wordCount = transcript.split(/\s+/).length;
          console.log(`[transcript] ${videoId}: path-C succeeded | ${wordCount} words`);
          await page.close().catch(() => { });
          return enrichEntry({ videoId, videoUrl, caption, transcript, wordCount, bucket, createTime, transcriptSource: TRANSCRIPT_SOURCE.subtitle });
        }
      }

      console.log(`[transcript] ${videoId}: path-BC failed, no subtitles available`);
      await page.close().catch(() => { });
    } catch (innerErr) {
      console.warn(`[transcript] ${videoId}: path-BC inner error: ${(innerErr as Error).message}`);
      await page.close().catch(() => { });
    }
  } catch (err) {
    console.warn(`[transcript] ${videoId}: path-BC failed: ${(err as Error).message}`);
  }

  // ── PATH E: Caption fallback — only use if caption has real content ──────────
  // Require >= 8 real words (not hashtags/mentions) to prevent thin data pollution
  if (caption && caption.trim().length >= 10) {
    const words = caption.trim().split(/\s+/);
    const hashtagCount = words.filter(w => w.startsWith('#') || w.startsWith('@')).length;
    const realWordCount = words.length - hashtagCount;

    if (realWordCount >= 8) {
      console.log(`[transcript] ${videoId}: path-E caption fallback | ${realWordCount} real words (${hashtagCount} hashtags filtered)`);
      return enrichEntry({ videoId, videoUrl, caption, transcript: caption.trim(), wordCount: words.length, bucket, createTime, transcriptSource: TRANSCRIPT_SOURCE.postCaption });
    } else {
      console.log(`[transcript] ${videoId}: path-E rejected — caption too thin: ${realWordCount} real words, ${hashtagCount} hashtags`);
    }
  }

  console.log(`[transcript] ${videoId}: all paths exhausted (caption: ${caption?.length ?? 0} chars)`);
  return null;
}

/**
 * Download and parse a WEBVTT subtitle from a list of subtitleInfos.
 * Prefers English; falls back to first available.
 */
async function downloadAndParseSubtitle(
  subtitleInfos: Array<Record<string, unknown>>,
): Promise<{ transcript: string; wordCount: number } | null> {
  // Prefer English subtitle; fall back to first available
  const engSub = subtitleInfos.find(
    (s) => (s?.LanguageCodeName as string)?.startsWith("eng"),
  ) ?? subtitleInfos[0];

  const subtitleUrl = engSub?.Url as string;
  if (!subtitleUrl) return null;

  const transcript = await downloadWebVTT(subtitleUrl);
  return transcript;
}

/**
 * Download a WEBVTT file and parse to plain text.
 */
async function downloadWebVTT(url: string): Promise<{ transcript: string; wordCount: number } | null> {
  const dlStart = Date.now();
  try {
    const { default: axios } = await import("axios");
    const subResponse = await axios.get(url, {
      headers: {
        "Referer": "https://www.tiktok.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 10000,
      responseType: "text",
    });

    const vttText = subResponse.data as string;
    const transcript = parseWebVTT(vttText);

    // Session 7 telemetry: subtitle downloads bypass fetchHtml (axios) — record
    // each attempt. Enum has no subtitle-specific method; tiktok_desktop_http
    // is the closest honest label (plain HTTP GET); the URL discloses the target.
    recordScrapeEvent({
      platform: "tiktok", scrapeMethod: "tiktok_desktop_http", urlRequested: url,
      httpStatus: subResponse.status, responseSizeBytes: vttText?.length,
      durationMs: Date.now() - dlStart,
      failureReason: !transcript || transcript.length < 10 ? "WEBVTT downloaded but parsed to empty/too-short transcript" : undefined,
    });

    if (!transcript || transcript.length < 10) return null;

    const wordCount = transcript.split(/\s+/).length;
    return { transcript, wordCount };
  } catch (err) {
    console.warn(`[transcript] WEBVTT download failed: ${(err as Error).message}`);
    recordScrapeEvent({
      platform: "tiktok", scrapeMethod: "tiktok_desktop_http", urlRequested: url,
      httpStatus: (err as { response?: { status?: number } }).response?.status,
      failureReason: (err as Error).message.slice(0, 500),
      durationMs: Date.now() - dlStart,
    });
    return null;
  }
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
async function fetchTikTokVideosFromAPI(
  handle: string
): Promise<Array<{
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
}>> {
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
    // Combined profile scrape gets user info + video list via XHR interception
    const profileResult = await scrapeTikTokProfile(handle);

    const userInfoData = profileResult.userInfo?.userInfo ?? {} as Record<string, unknown>;
    const user = userInfoData?.user ?? {} as Record<string, unknown>;
    const secUid = user?.secUid ?? "";

    if (!secUid) {
      console.log(`[webResearch] @${handle}: could not get secUid from user info`);
      return items;
    }

    // Get video list from the combined profile scrape
    const itemList = profileResult.posts?.data?.itemList ?? [];

    console.log(`[webResearch] @${handle}: API fetch found ${itemList.length} videos`);

    for (const item of itemList) {
      const videoId = item.id ?? "";
      if (!videoId) continue;

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
        durationMs: Number(item.video?.duration ?? 0),
      });
    }
  } catch (err) {
    console.warn(`[webResearch] @${handle}: API fetch failed:`, (err as Error).message);
  }

  return items;
}

async function fetchTikTokTranscripts(handle: string): Promise<{
  transcripts: TranscriptEntry[];
  videoTitles: string[];
  hashtags: string[];
  viewCounts: number[];
  musicTitles: string[];
  engagementSignals: EngagementSignals;
  quotaExhausted: boolean;
  longitudinalSample: LongitudinalSample;
  discoveredVideoPool: Array<{
    id: string; url: string; caption: string; createTime: number;
    views: number; likes: number; comments: number; saves: number; shares: number;
    musicOriginal: boolean; musicTitle?: string; musicArtist?: string;
    durationSec: number;
  }>;
}> {
  const normalizedHandle = normalizeHandle(handle);
  const transcripts: TranscriptEntry[] = [];
  const videoTitles: string[] = [];
  const hashtags: string[] = [];
  const viewCounts: number[] = [];
  const musicTitles: string[] = [];
  const seen = new Set<string>();
  let searchQuotaExhausted = false;

  const isQuotaErr = (err: unknown) => {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return msg.includes("usage exhausted") || msg.includes("quota") || msg.includes("rate limit") || msg.includes("too many requests");
  };

  // Collect video IDs: PRIMARY SOURCE is HTML scrape, FALLBACK is search API
  // Each item carries the full engagement snapshot needed for temporal analysis
  interface VideoItem {
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
  const videoItems: VideoItem[] = [];

  // ─── PRIMARY SOURCE: TikTok API (get_user_post_list) ────────────────────────
  const apiVideos = await fetchTikTokVideosFromAPI(handle);
  for (const v of apiVideos) {
    if (!seen.has(v.id)) {
      seen.add(v.id);
      videoItems.push(v);
      if (v.views > 0) viewCounts.push(v.views);
      if (v.caption) videoTitles.push(v.caption);
    }
  }

  console.log(`[webResearch] @${handle}: API fetch yielded ${apiVideos.length} videos`);

  // ─── SUPPLEMENTAL SOURCE: Multi-query TikTok search (always runs to maximise pool) ──
  // Uses dot-stripped handle variant to work around TikTok search tokenisation
  {
    const noDot = handle.replace(/\./g, "");
    const queries = [
      handle,          // kaylee.nhi
      `@${handle}`,    // @kaylee.nhi
      noDot,           // kayleenhi
      `@${noDot}`,     // @kayleenhi
    ];

    for (const q of queries) {
      try {
        const result = await searchTikTokVideos(q) as unknown as Record<string, unknown>;

        const items = (result?.item_list as unknown[]) ?? [];
        console.log(`[webResearch] TikTok search "${q}" (fallback): ${items.length} results`);

        for (const item of items) {
          const v = item as Record<string, unknown>;

          // AUTHOR GUARD: only keep videos from the target creator
          const author = (v?.author as Record<string, unknown>) ?? {};
          const authorId = ((author?.uniqueId as string) ?? (author?.unique_id as string) ?? "").toLowerCase();
          const authorNorm = normalizeHandle(authorId);

          const isMatch =
            authorNorm === normalizedHandle ||
            authorNorm.includes(normalizedHandle) ||
            normalizedHandle.includes(authorNorm);

          if (!isMatch && authorId !== "") {
            continue; // Different creator — skip
          }

          const videoId = (v?.id as string) ?? ((v?.video as Record<string, unknown>)?.id as string) ?? "";
          if (!videoId || seen.has(videoId)) continue;
          seen.add(videoId);

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
            if (!musicTitles.includes(musicTitle)) musicTitles.push(musicTitle);
          }
          if (musicTitle.startsWith("original sound") && normalizeHandle(musicAuthor) === normalizedHandle) {
            if (!musicTitles.includes(`[original audio by @${handle}]`)) {
              musicTitles.push(`[original audio by @${handle}]`);
            }
          }

          // Interaction flags
          const duetEnabled = Boolean(v?.duetEnabled ?? v?.duet_enabled ?? false);
          const stitchEnabled = Boolean(v?.stitchEnabled ?? v?.stitch_enabled ?? false);
          const isAd = Boolean(v?.isAd ?? v?.is_ad ?? false);
          const videoObj = (v?.video as Record<string, unknown>) ?? {};
          const durationMs = Number(videoObj?.duration ?? 0);

          // Collect hashtags from challenges and textExtra
          const challenges = (v?.challenges as Array<Record<string, unknown>>) ?? [];
          for (const c of challenges) {
            const tagName = (c?.title as string) ?? (c?.name as string) ?? "";
            if (tagName) hashtags.push(`#${tagName}`);
          }
          const textExtra = (v?.textExtra as Array<Record<string, unknown>>) ?? (v?.text_extra as Array<Record<string, unknown>>) ?? [];
          for (const tag of textExtra) {
            const tagName = (tag?.hashtagName as string) ?? (tag?.hashtag_name as string) ?? "";
            if (tagName) hashtags.push(`#${tagName}`);
          }
          if (desc) {
            const inlineTags = desc.match(/#([a-zA-Z0-9_]+)/g) ?? [];
            hashtags.push(...inlineTags);
          }

          if (views > 0) viewCounts.push(views);
          if (desc) videoTitles.push(desc);

          videoItems.push({
            id: videoId, caption: desc, views, likes, comments, saves, shares,
            createTime, musicOriginal, musicTitle, musicArtist: musicAuthor,
            duetEnabled, stitchEnabled, isAd, durationMs,
          });
        }
      } catch (err) {
        if (isQuotaErr(err)) searchQuotaExhausted = true;
        console.warn(`[webResearch] TikTok search "${q}" (supplemental) failed:`, err);
      }
    }
  }

  const apiVideoCount = apiVideos.length;
  const supplementalVideoCount = videoItems.length - apiVideoCount;
  console.log(`[webResearch] @${handle}: supplemental search returned ${supplementalVideoCount} matching videos. Total pool: ${videoItems.length} (API: ${apiVideoCount}, search: ${supplementalVideoCount})`);

  if (videoItems.length < 4) {
    console.warn(`[webResearch] @${handle}: ⚠️ BELOW MINIMUM THRESHOLD — only ${videoItems.length} videos collected. Analysis quality will be degraded.`);
  }

  console.log(`[webResearch] @${handle}: ${videoItems.length} total videos collected — applying 6-3-3 stratified sampling`);

  // ─── 6-3-3 Stratified Sampling ─────────────────────────────────────────────
  // Sort all collected videos by createTime descending (newest first)
  const nowSec2 = Math.floor(Date.now() / 1000);
  const nineMonthsSec = 270 * 24 * 3600;  // ~9 months
  const eighteenMonthsSec = 540 * 24 * 3600; // ~18 months

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
  const midBucket: typeof videoItems = [];
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
  const anchorBucket: typeof videoItems = [];
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
  const sampledVideos: Array<{ item: typeof videoItems[0]; bucket: "recent" | "mid" | "anchor" }> = [];
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

  // Fetch transcripts for the 12 sampled videos using p-limit concurrency
  const transcriptLimit = pLimit(3);
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
        }, sharedCtx ? { context: sharedCtx.context } : undefined);
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
    }));

  return { transcripts, videoTitles, hashtags, viewCounts, musicTitles, engagementSignals, quotaExhausted: searchQuotaExhausted, longitudinalSample, discoveredVideoPool };
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
async function fetchYouTubeTranscripts(handle: string): Promise<{
  transcripts: TranscriptEntry[];
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
  quotaExhausted: boolean;
}> {
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
  const transcripts: TranscriptEntry[] = [];

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
    const videoIds: Array<{ id: string; title: string }> = [];
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

    // Step 4: Fetch transcripts for videos
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

  console.log(`[webResearch] YouTube @${handle}: ${transcripts.length} transcripts, ${videoTitles.length} video titles`);

  return {
    transcripts, channelId, displayName, bio, followerCount, videoCount,
    totalViews, location, channelKeywords, videoTitles, videoViewCounts,
    quotaExhausted: ytQuotaExhausted,
  };
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

function buildCreatorEvidenceSummary(data: {
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

async function researchTikTokCreator(handleOrUrl: string): Promise<CreatorResearchResult> {
  const handle = extractHandle(handleOrUrl);

  let secUid = "";
  let displayName = handle;
  let bio = "";
  let followerCount = 0;
  let followingCount = 0;
  let videoCount = 0;
  let totalLikes = 0;
  let location = "";
  let quotaExhausted = false;
  const viewCounts: number[] = [];

  // Helper: detect quota exhaustion errors
  const isQuotaError = (err: unknown): boolean => {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return msg.includes("usage exhausted") || msg.includes("quota") || msg.includes("rate limit") || msg.includes("too many requests");
  };

  // Step 1: Combined profile scrape (user info + video list via XHR interception)
  const htmlTitles: string[] = [];
  const popularTitles: string[] = [];
  try {
    const profileResult = await scrapeTikTokProfile(handle);

    const userInfoData = profileResult.userInfo?.userInfo ?? {} as Record<string, unknown>;
    const user = userInfoData?.user ?? {} as Record<string, unknown>;
    const stats = userInfoData?.stats ?? {} as Record<string, unknown>;

    secUid = user?.secUid ?? "";
    displayName = user?.nickname ?? handle;
    bio = user?.signature ?? "";
    followerCount = Number(stats?.followerCount ?? 0);
    followingCount = Number(stats?.followingCount ?? 0);
    videoCount = Number(stats?.videoCount ?? 0);
    totalLikes = Number(stats?.heartCount ?? 0);

    const locationMatch = bio.match(/\b(Toronto|New York|NYC|Los Angeles|LA|London|Dubai|Paris|Chicago|Miami|Houston|Atlanta|Montreal|Vancouver|Sydney|Melbourne|Calgary|Ottawa|Edmonton|Winnipeg|Quebec|Halifax|Cleveland|Brooklyn|Nashville|Austin|Seattle|Denver|Boston|Philadelphia)\b/i);
    if (locationMatch) location = locationMatch[1];

    // Extract video titles and view counts from the combined post list
    const itemList = profileResult.posts?.data?.itemList ?? [];
    for (const item of itemList) {
      const desc = item.desc ?? "";
      const views = Number(item.stats?.playCount ?? 0);
      if (desc.trim()) htmlTitles.push(desc.trim());
      if (views > 0) viewCounts.push(views);
    }

    console.log(`[webResearch] @${handle}: scrapeTikTokProfile returned followerCount=${followerCount}, videos=${itemList.length}`);
  } catch (err) {
    if (isQuotaError(err)) quotaExhausted = true;
    console.warn("[webResearch] TikTok profile scrape failed:", err);
  }

  // Step 2: Fetch transcripts (primary pipeline) + collect video titles/hashtags
  const transcriptData = await fetchTikTokTranscripts(handle);
  const { transcripts, videoTitles: searchTitles, hashtags: searchHashtags, viewCounts: transcriptViewCounts, musicTitles, engagementSignals, quotaExhausted: searchQuotaExhausted, longitudinalSample, discoveredVideoPool } = transcriptData;
  if (searchQuotaExhausted) quotaExhausted = true;
  // Merge transcript view counts into main viewCounts array
  for (const vc of transcriptViewCounts) {
    if (vc > 0 && !viewCounts.includes(vc)) viewCounts.push(vc);
  }

  // NO YouTube fallback — removed entirely to prevent hallucination

  // Merge all video titles
  const allTitles = Array.from(new Set([...searchTitles, ...htmlTitles, ...popularTitles])).slice(0, 30);

  // Check if we have meaningful content data (bio alone is not enough)
  const hasContentData = transcripts.length > 0 || allTitles.length > 0;
  const hasAnyData = hasContentData || followerCount > 0 || bio.length > 0;

  // Log extracted stats for debugging
  if (followerCount > 0) {
    console.log(`[webResearch] @${handle}: followerCount=${followerCount}, videoCount=${videoCount}, totalLikes=${totalLikes}`);
  } else {
    console.warn(`[webResearch] @${handle}: WARNING - followerCount is still 0 after all extraction attempts`);
  }

  // If quota was exhausted AND we have no content (transcripts or titles), hard-block.
  // Bio alone is insufficient — it produces hallucinated profiles.
  if (quotaExhausted && !hasContentData) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `The TikTok data API is temporarily rate-limited from recent activity. No video content could be retrieved for @${handle}. Please wait 2–5 minutes and try again.`,
    });
  }

  // If quota was exhausted but we have content data (titles/transcripts), continue with what we have
  if (quotaExhausted) {
    console.warn(`[webResearch] @${handle}: quota exhausted but proceeding with content data (${allTitles.length} titles, ${transcripts.length} transcripts)`);
  }

  // Hard error when truly nothing is available
  if (!hasAnyData) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No public content found for @${handle}. TikTok does not expose this creator's profile through the available APIs. Please verify the handle is correct and that the account is public.`,
    });
  }

  // ── Minimum data threshold — prevent LLM from hallucinating on thin data ──
  // If we have fewer than 2 real transcripts AND fewer than 4 video titles,
  // the data is too thin for a reliable cultural analysis.
  // "real" = speech-derived (subtitle/audio); the post-caption fallback is
  // excluded — identical set to the historical `!== "caption"` gate. This does
  // NOT change what counts as evidence (Jason's ruling), only how the source is
  // classified. See @shared/transcriptSource.
  const realTranscripts = transcripts.filter(t => isSpeechTranscript(t.transcriptSource));
  const totalVideoPool = discoveredVideoPool?.length ?? 0;
  console.log(`[webResearch] @${handle}: data quality check — ${realTranscripts.length} real transcripts, ${transcripts.length} total transcripts, ${allTitles.length} titles, ${totalVideoPool} discovered videos`);

  if (realTranscripts.length < 2 && allTitles.length < 4) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Insufficient data for @${handle}: ${totalVideoPool} videos discovered, ${realTranscripts.length} real transcripts, ${allTitles.length} video titles. The scraper could not collect enough content for a reliable analysis. This creator may have limited public content or TikTok may be blocking access. Try again or try a creator with more public content.`,
    });
  }

  // Compute stats
  const totalViews = viewCounts.reduce((a, b) => a + b, 0);
  const avgViews = viewCounts.length > 0
    ? Math.round(viewCounts.reduce((a, b) => a + b, 0) / viewCounts.length)
    : 0;
  // FIXED engagement rate: use (likes + comments) / plays, not views/followers
  // This is the true interaction rate and will never exceed 100%
  const engagementRate = engagementSignals.avgLikeRate > 0
    ? Math.round((engagementSignals.avgLikeRate + engagementSignals.avgCommentRate) * 100 * 100) / 100
    : (followerCount > 0 && avgViews > 0
      ? Math.min(100, Math.round((avgViews / followerCount) * 100 * 10) / 10)
      : 0);

  const allHashtagSources = [...searchHashtags, ...allTitles, bio];
  const topHashtags = extractHashtags(allHashtagSources);

  // Include transcript text in keyword extraction for richer signal
  const transcriptTexts = transcripts.map(t => t.transcript);
  const rawKeywords = extractKeywords([...allTitles, bio, ...transcriptTexts]);

  // Use full transcript text for richer AI analysis (up to 6000 chars combined)
  const combinedTranscriptText = transcriptTexts.join(" ").slice(0, 6000);
  const contentThemeLabels = await translateKeywordsToThemes(rawKeywords, topHashtags, allTitles, bio, combinedTranscriptText);
  const contentThemes = inferContentThemes(allTitles, topHashtags, bio);

  if (!location) {
    const allText = [bio, ...allTitles, combinedTranscriptText].join(" ");
    const locationMatch = allText.match(/\b(Toronto|New York|NYC|Los Angeles|LA|London|Dubai|Paris|Chicago|Miami|Houston|Atlanta|Montreal|Vancouver|Sydney|Melbourne|Cleveland|Brooklyn|Nashville|Austin|Seattle|Denver|Boston|Philadelphia)\b/i);
    if (locationMatch) location = locationMatch[1];
  }

  // Build transcript excerpts for DB storage — store ALL transcripts in full (no truncation)
  // This maximises the language data available for scoring and cultural analysis
  const transcriptExcerpts = transcripts
    .map(t => `[${t.caption.slice(0, 60) || "video"}]: ${t.transcript}`)
    .join("\n\n");

  // Run Symbol Decoder — pre-process all creator-authored text into cultural signals
  const tikTokDecodedSymbols = await decodeCreatorSymbols({
    handle,
    bio,
    videoTitles: allTitles,
    hashtags: topHashtags,
    transcriptExcerpts: transcripts.map(t => t.transcript),
  });
  const tikTokDecodedSymbolsBlock = tikTokDecodedSymbols ? formatDecodedSymbolsBlock(tikTokDecodedSymbols) : "";

  const evidenceSummary = buildCreatorEvidenceSummary({
    handle, platform: "TikTok", displayName, bio, followerCount, videoCount,
    totalLikes, totalViews, avgViews, engagementRate, location,
    videoTitles: allTitles, topHashtags, rawKeywords, contentThemeLabels, contentThemes,
    musicSignals: musicTitles, transcripts, engagementSignals,
    decodedSymbolsBlock: tikTokDecodedSymbolsBlock,
  });

  // Compute data confidence level
  const dataConfidenceLevel: CreatorResearchResult["dataConfidenceLevel"] =
    transcripts.length >= 6 ? "high" :
      transcripts.length >= 3 ? "medium" :
        "low";

  return {
    handle, platform: "TikTok", displayName, bio, followerCount, followingCount, videoCount,
    totalLikes, totalViews, avgViews, engagementRate, location,
    profileUrl: `https://www.tiktok.com/@${handle}`,
    recentVideoTitles: allTitles, topHashtags, rawKeywords,
    contentThemeLabels, contentThemes,
    transcripts, transcriptCount: transcripts.length, transcriptExcerpts,
    decodedSymbols: tikTokDecodedSymbols as Record<string, unknown> | null,
    evidenceSummary,
    longitudinalSample,
    culturalVelocity: longitudinalSample?.culturalVelocity,
    dataConfidenceLevel,
    // Session 8: computed iff the engagement-signals block was built (sampled videos).
    sociologicalFieldsComputed: engagementSignals.totalSampled > 0,
    discoveredVideoPool,
  };
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
  const contentThemeLabels = await translateKeywordsToThemes(rawKeywords, allHashtags, videoTitles, profile.biography, combinedTranscriptText);
  const contentThemes = inferContentThemes(videoTitles, allHashtags, profile.biography);

  // Step 7: Location detection
  let location = "";
  const locationText = [profile.biography, ...videoTitles, combinedTranscriptText].join(" ");
  const locationMatch = locationText.match(/\b(Toronto|New York|NYC|Los Angeles|LA|London|Dubai|Paris|Chicago|Miami|Houston|Atlanta|Montreal|Vancouver|Sydney|Melbourne|Cleveland|Brooklyn|Nashville|Austin|Seattle|Denver|Boston|Philadelphia)\b/i);
  if (locationMatch) location = locationMatch[1];

  // Step 8: Build transcript excerpts
  const transcriptExcerpts = transcripts
    .map(t => `[${t.caption.slice(0, 60) || "reel"}]: ${t.transcript}`)
    .join("\n\n");

  // Step 9: Symbol decoder
  const decodedSymbols = await decodeCreatorSymbols({
    handle,
    bio: profile.biography,
    videoTitles,
    hashtags: allHashtags,
    transcriptExcerpts: transcriptTexts,
  });
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
  const contentThemeLabels = await translateKeywordsToThemes(rawKeywords, topHashtags, uniqueVideoTitles, bio, combinedTranscriptText);
  const contentThemes = inferContentThemes(uniqueVideoTitles, topHashtags, bio);

  const profileUrl = channelId
    ? `https://www.youtube.com/channel/${channelId}`
    : `https://www.youtube.com/@${handle}`;

  // Store ALL transcripts in full (no truncation) for maximum language data
  const transcriptExcerpts = transcripts
    .map(t => `[${t.caption.slice(0, 60) || "video"}]: ${t.transcript}`)
    .join("\n\n");

  // Run Symbol Decoder — pre-process all creator-authored text into cultural signals
  const ytDecodedSymbols = await decodeCreatorSymbols({
    handle,
    bio,
    videoTitles: uniqueVideoTitles,
    hashtags: topHashtags,
    transcriptExcerpts: transcripts.map(t => t.transcript),
  });
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
async function crawlBrandWebsite(startUrl: string): Promise<{
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

  const evidenceSummary = [
    "BRAND RESEARCH EVIDENCE",
    "=======================",
    `Brand Name: ${brandName}`,
    `Website: ${isUrl ? brandNameOrUrl : "Not provided"}`,
    description ? `Website Content:\n${description}` : "",
    snippets.length > 0 ? `\nKey Snippets:\n${snippets.slice(0, 8).join("\n")}` : "",
    reviewResult.audiencePerceptionBlock ? `\n\n${reviewResult.audiencePerceptionBlock}` : "",
    "",
    "INSTRUCTIONS FOR ANALYSIS:",
    "Based on the above evidence, extract the brand's cultural profile. If the website content is limited,",
    "use your knowledge of this brand/business name to supplement, but clearly ground your analysis in",
    "what the evidence shows. Do NOT invent a brand identity that contradicts the evidence.",
    "Pay special attention to the AUDIENCE PERCEPTION section — review language reveals how customers",
    "actually decode the brand, which may differ from the brand's self-presentation.",
  ].filter(Boolean).join("\n").trim();

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

      brandDecodedSymbols = await decodeBrandSymbols({
        brandName,
        websiteText,
        reviewText,
        metadataKeywords,
        mentionKeywords,
        mentionSentiment,
      });
    } else {
      console.warn(`[webResearch] Brand Symbol Decoder skipped — insufficient text (${combinedTextLength} chars) for ${brandName}`);
    }
  } catch (err) {
    console.warn("[webResearch] Brand Symbol Decoder failed (non-fatal):", err);
  }

  // Inject decoded symbols block into evidence summary for AI extraction
  const decodedSymbolsBlock = brandDecodedSymbols
    ? `\n\n${formatBrandDecodedSymbolsBlock(brandDecodedSymbols)}`
    : "";

  // Inject audience mention intelligence block (PRIMARY evidence for audience perception)
  const mentionEvidenceBlock = audienceMentionData
    ? `\n\n${formatAudienceMentionEvidenceBlock(audienceMentionData)}`
    : "";

  const evidenceSummaryWithSymbols = evidenceSummary + decodedSymbolsBlock + mentionEvidenceBlock;

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
