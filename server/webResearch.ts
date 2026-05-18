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

import { callDataApi } from "./_core/dataApi";
import { invokeLLM } from "./_core/llm";
import { TRPCError } from "@trpc/server";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TranscriptEntry {
  videoId: string;
  videoUrl: string;
  caption: string;       // The video's text caption / title
  transcript: string;    // Full spoken transcript (plain text)
  wordCount: number;
}

export interface CreatorResearchResult {
  handle: string;
  platform: string;
  displayName: string;
  bio: string;
  followerCount: number;
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
  transcripts: TranscriptEntry[];  // NEW: actual spoken transcripts
  transcriptCount: number;         // NEW: number of transcripts successfully fetched
  transcriptExcerpts: string;      // NEW: combined excerpt text for DB storage
  evidenceSummary: string;         // Plain-text evidence block passed to LLM
}

export interface BrandResearchResult {
  brandName: string;
  websiteUrl: string;
  description: string;
  searchSnippets: string[];
  evidenceSummary: string;
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
    "the","a","an","and","or","but","in","on","at","to","for","of","with","by",
    "from","up","about","into","through","during","is","are","was","were","be",
    "been","being","have","has","had","do","does","did","will","would","could",
    "should","may","might","shall","can","i","my","me","we","our","you","your",
    "he","she","it","they","them","this","that","these","those","what","which",
    "who","how","when","where","why","all","each","every","both","few","more",
    "most","other","some","such","no","not","only","same","so","than","too",
    "very","just","also","new","get","got","let","like","make","know","think",
    "see","look","come","go","take","give","use","find","want","need","day",
    "time","year","way","part","place","case","week","company","number","group",
    "problem","fact","video","watch","subscribe","follow","link","bio","check",
    "click","here","now","today","back","first","last","next","own","old","big",
    "high","long","great","little","good","bad","best","right","left","real",
    "full","free","live","show","tell","feel","try","turn","ask","seem","leave",
    "call","keep","put","set","run","move","play","pay","hear","help","talk",
    "start","always","never","ever","still","already","again","once","often",
    "yeah","okay","like","just","really","actually","gonna","wanna","gotta",
    "um","uh","so","well","right","know","mean","think","said","went","came",
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

async function fetchHtml(url: string, extraHeaders?: Record<string, string>): Promise<string> {
  const { default: axios } = await import("axios");
  const response = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...extraHeaders,
    },
    timeout: 15000,
  });
  return response.data as string;
}

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

// ─── TikTok Transcript Fetcher ────────────────────────────────────────────────

/**
 * Fetch the WEBVTT transcript from a single TikTok video page.
 * Returns null if no subtitle is available.
 */
async function fetchTikTokVideoTranscript(
  handle: string,
  videoId: string,
  caption: string
): Promise<TranscriptEntry | null> {
  const videoUrl = `https://www.tiktok.com/@${handle}/video/${videoId}`;

  try {
    const html = await fetchHtml(videoUrl, { Referer: "https://www.tiktok.com/" });

    const rehydrationMatch = html.match(
      /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!rehydrationMatch) {
      console.log(`[webResearch] No rehydration data for video ${videoId}`);
      return null;
    }

    const pageData = JSON.parse(rehydrationMatch[1]) as Record<string, unknown>;
    const defaultScope = (pageData?.["__DEFAULT_SCOPE__"] as Record<string, unknown>) ?? {};
    const videoDetail = (defaultScope?.["webapp.video-detail"] as Record<string, unknown>) ?? {};
    const itemStruct = (videoDetail?.itemInfo as Record<string, unknown>)?.itemStruct as Record<string, unknown> ?? {};
    const videoObj = (itemStruct?.video as Record<string, unknown>) ?? {};
    const subtitleInfos = (videoObj?.subtitleInfos as Array<Record<string, unknown>>) ?? [];

    if (subtitleInfos.length === 0) {
      console.log(`[webResearch] No subtitles for video ${videoId} (${caption.slice(0, 40)})`);
      return null;
    }

    // Prefer English subtitle; fall back to first available
    const engSub = subtitleInfos.find(
      (s) => (s?.LanguageCodeName as string)?.startsWith("eng")
    ) ?? subtitleInfos[0];

    const subtitleUrl = engSub?.Url as string;
    if (!subtitleUrl) return null;

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

    if (!transcript || transcript.length < 10) return null;

    const wordCount = transcript.split(/\s+/).length;
    console.log(`[webResearch] ✅ Transcript for video ${videoId}: ${wordCount} words`);

    return { videoId, videoUrl, caption, transcript, wordCount };
  } catch (err) {
    console.warn(`[webResearch] Transcript fetch failed for video ${videoId}:`, (err as Error).message);
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
async function fetchTikTokTranscripts(handle: string): Promise<{
  transcripts: TranscriptEntry[];
  videoTitles: string[];
  hashtags: string[];
  viewCounts: number[];
  musicTitles: string[];
}> {
  const normalizedHandle = normalizeHandle(handle);
  const transcripts: TranscriptEntry[] = [];
  const videoTitles: string[] = [];
  const hashtags: string[] = [];
  const viewCounts: number[] = [];
  const musicTitles: string[] = [];
  const seen = new Set<string>();

  // Collect video IDs from TikTok search — author-filtered
  const videoItems: Array<{ id: string; caption: string; views: number }> = [];

  // Run two targeted searches: handle alone + handle with a broad keyword
  const queries = [handle, `@${handle}`];

  for (const q of queries) {
    try {
      const result = await callDataApi("TikTok/search_tiktok_video_general", {
        query: { keyword: q, count: "20" },  // count MUST be a STRING
      }) as Record<string, unknown>;

      const items = (result?.item_list as unknown[]) ?? [];
      console.log(`[webResearch] TikTok search "${q}": ${items.length} results`);

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

        // Collect music signals
        const music = (v?.music as Record<string, unknown>) ?? {};
        const musicTitle = (music?.title as string) ?? "";
        const musicAuthor = (music?.authorName as string) ?? "";
        if (musicTitle && !musicTitle.startsWith("original sound") && musicTitle.length > 3) {
          if (!musicTitles.includes(musicTitle)) musicTitles.push(musicTitle);
        }
        if (musicTitle.startsWith("original sound") && normalizeHandle(musicAuthor) === normalizedHandle) {
          if (!musicTitles.includes(`[original audio by @${handle}]`)) {
            musicTitles.push(`[original audio by @${handle}]`);
          }
        }

        if (views > 0) viewCounts.push(views);
        if (desc) videoTitles.push(desc);

        videoItems.push({ id: videoId, caption: desc, views });
      }
    } catch (err) {
      console.warn(`[webResearch] TikTok search "${q}" failed:`, err);
    }
  }

  console.log(`[webResearch] @${handle}: ${videoItems.length} confirmed videos to fetch transcripts for`);

  // Fetch transcripts — process up to 10 videos concurrently in batches of 3
  // to avoid rate limiting while still being fast
  const batchSize = 3;
  for (let i = 0; i < Math.min(videoItems.length, 10); i += batchSize) {
    const batch = videoItems.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((v) => fetchTikTokVideoTranscript(handle, v.id, v.caption))
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        transcripts.push(r.value);
      }
    }
    // Small delay between batches to be polite
    if (i + batchSize < videoItems.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(`[webResearch] @${handle}: ${transcripts.length} transcripts fetched out of ${videoItems.length} videos`);

  return { transcripts, videoTitles, hashtags, viewCounts, musicTitles };
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
    const captionResponse = await axios.get(baseUrl, {
      headers: {
        "Referer": "https://www.youtube.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 10000,
      responseType: "text",
    });

    const captionXml = captionResponse.data as string;
    const transcript = parseYouTubeCaptionXml(captionXml);

    if (!transcript || transcript.length < 10) return null;

    const wordCount = transcript.split(/\s+/).length;
    console.log(`[webResearch] ✅ YouTube transcript for ${videoId}: ${wordCount} words`);

    return { videoId, videoUrl, caption: title, transcript, wordCount };
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
}> {
  let channelId = "";
  let displayName = handle;
  let bio = "";
  let followerCount = 0;
  let videoCount = 0;
  let totalViews = 0;
  let location = "";
  let channelKeywords: string[] = [];
  const videoTitles: string[] = [];
  const videoViewCounts: number[] = [];
  const transcripts: TranscriptEntry[] = [];

  // Step 1: Find channel
  try {
    const searchResponse = await callDataApi("Youtube/search", {
      query: { q: handle, type: "channel", hl: "en", gl: "US" },
    }) as Record<string, unknown>;

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
    console.warn("[webResearch] YouTube channel search failed:", err);
  }

  // Step 2: Get channel details
  if (channelId) {
    try {
      const details = await callDataApi("Youtube/get_channel_details", {
        query: { id: channelId },
      }) as Record<string, unknown>;

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
      console.warn("[webResearch] YouTube channel details failed:", err);
    }

    // Step 3: Get channel videos
    const videoIds: Array<{ id: string; title: string }> = [];
    try {
      const videosResponse = await callDataApi("Youtube/get_channel_videos", {
        query: { channelId, hl: "en", gl: "US" },
      }) as Record<string, unknown>;

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
      const videoSearch = await callDataApi("Youtube/search", {
        query: { q: `${handle} youtube`, hl: "en", gl: "US" },
      }) as Record<string, unknown>;
      const contents = (videoSearch?.contents as unknown[]) ?? [];
      for (const item of contents.slice(0, 10)) {
        const videoData = ((item as Record<string, unknown>)?.video as Record<string, unknown>);
        if (videoData) {
          const title = (videoData?.title as string) ?? "";
          if (title) videoTitles.push(title);
        }
      }
    } catch (err) {
      console.warn("[webResearch] YouTube video search fallback failed:", err);
    }
  }

  console.log(`[webResearch] YouTube @${handle}: ${transcripts.length} transcripts, ${videoTitles.length} video titles`);

  return {
    transcripts, channelId, displayName, bio, followerCount, videoCount,
    totalViews, location, channelKeywords, videoTitles, videoViewCounts,
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
    "food","restaurant","review","recipe","travel","fitness","fashion","makeup",
    "tutorial","how to","tech","gaming","business","finance","education","news"
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
}): string {
  const {
    handle, platform, displayName, bio, followerCount, videoCount, totalLikes,
    totalViews, avgViews, engagementRate, location, videoTitles, topHashtags,
    rawKeywords, contentThemeLabels, contentThemes, musicSignals = [],
    transcripts = [],
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

DETECTED CREATOR TYPE: ${creatorType}
${creatorType.includes("PERSONALITY") || creatorType.includes("COMEDY") ? `
⚠️  PERSONALITY CREATOR NOTE: This creator uses minimal captions. Their identity comes from
    their PRESENCE, STYLE, and AUDIENCE RELATIONSHIP — not from descriptive post titles.
    Use follower count, avg views, bio tone, music choices, and any transcript content to infer archetype.
` : ""}

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
  let videoCount = 0;
  let totalLikes = 0;
  let location = "";

  // Step 1: TikTok user info (profile metadata)
  try {
    const userResponse = await callDataApi("TikTok/get_user_info", {
      query: { uniqueId: handle },
    }) as Record<string, unknown>;

    const userInfoData = (userResponse?.userInfo as Record<string, unknown>) ?? {};
    const user = (userInfoData?.user as Record<string, unknown>) ?? {};
    const stats = (userInfoData?.stats as Record<string, unknown>) ?? {};

    secUid = (user?.secUid as string) ?? "";
    displayName = (user?.nickname as string) ?? handle;
    bio = (user?.signature as string) ?? "";
    followerCount = Number(stats?.followerCount ?? 0);
    videoCount = Number(stats?.videoCount ?? 0);
    totalLikes = Number(stats?.heartCount ?? 0);

    const locationMatch = bio.match(/\b(Toronto|New York|NYC|Los Angeles|LA|London|Dubai|Paris|Chicago|Miami|Houston|Atlanta|Montreal|Vancouver|Sydney|Melbourne|Calgary|Ottawa|Edmonton|Winnipeg|Quebec|Halifax|Cleveland|Brooklyn|Nashville|Austin|Seattle|Denver|Boston|Philadelphia)\b/i);
    if (locationMatch) location = locationMatch[1];
  } catch (err) {
    console.warn("[webResearch] TikTok user info failed:", err);
  }

  // Step 2: Fetch transcripts (primary pipeline) + collect video titles/hashtags
  const transcriptData = await fetchTikTokTranscripts(handle);
  const { transcripts, videoTitles: searchTitles, hashtags: searchHashtags, viewCounts, musicTitles } = transcriptData;

  // Step 3: HTML scrape for additional video titles (profile page)
  const htmlTitles: string[] = [];
  try {
    const html = await fetchHtml(`https://www.tiktok.com/@${handle}`);
    const jsonMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (jsonMatch) {
      try {
        const pageData = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
        const defaultScope = (pageData?.["__DEFAULT_SCOPE__"] as Record<string, unknown>) ?? {};
        const userDetail = (defaultScope?.["webapp.user-detail"] as Record<string, unknown>) ?? {};
        const itemList = (userDetail?.itemList as unknown[]) ?? [];
        for (const item of itemList) {
          const v = item as Record<string, unknown>;
          const desc = (v?.desc as string) ?? "";
          if (desc && !searchTitles.includes(desc)) htmlTitles.push(desc);
        }
      } catch { /* JSON parse failed */ }
    }

    if (!bio) {
      const sigMatch = html.match(/"signature":"([^"]+)"/);
      if (sigMatch) bio = sigMatch[1].replace(/\\n/g, " ").replace(/\\u[0-9a-fA-F]{4}/g, "").trim();
    }
  } catch (err) {
    console.warn("[webResearch] TikTok HTML scrape failed:", err);
  }

  // Step 4: Popular posts (large creators only)
  const popularTitles: string[] = [];
  if (secUid) {
    try {
      const postsResponse = await callDataApi("TikTok/get_user_popular_posts", {
        query: { secUid, count: "20" },
      }) as Record<string, unknown>;

      const dataBlock = (postsResponse?.data as Record<string, unknown>) ?? postsResponse;
      const itemList = (dataBlock?.itemList as unknown[]) ?? [];
      for (const item of itemList) {
        const desc = ((item as Record<string, unknown>)?.desc as string) ?? "";
        const stats = ((item as Record<string, unknown>)?.stats as Record<string, unknown>) ?? {};
        const views = Number(stats?.playCount ?? 0);
        if (desc.trim()) popularTitles.push(desc.trim());
        if (views > 0) viewCounts.push(views);
      }
    } catch (err) {
      console.warn("[webResearch] TikTok popular posts failed (expected for small creators):", err);
    }
  }

  // NO YouTube fallback — removed entirely to prevent hallucination

  // Merge all video titles
  const allTitles = Array.from(new Set([...searchTitles, ...htmlTitles, ...popularTitles])).slice(0, 30);

  // Check if we have enough data — hard error if insufficient
  const hasEnoughData = transcripts.length >= 3 || allTitles.length >= 3;
  if (!hasEnoughData) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Not enough public content found for @${handle}. TikTok does not expose this creator's videos through the available APIs. Please verify the handle is correct, or try a creator with more public content.`,
    });
  }

  // Compute stats
  const totalViews = viewCounts.reduce((a, b) => a + b, 0);
  const avgViews = viewCounts.length > 0
    ? Math.round(viewCounts.reduce((a, b) => a + b, 0) / viewCounts.length)
    : 0;
  const engagementRate = followerCount > 0 && avgViews > 0
    ? Math.min(100, Math.round((avgViews / followerCount) * 100 * 10) / 10)
    : 0;

  const allHashtagSources = [...searchHashtags, ...allTitles, bio];
  const topHashtags = extractHashtags(allHashtagSources);

  // Include transcript text in keyword extraction for richer signal
  const transcriptTexts = transcripts.map(t => t.transcript);
  const rawKeywords = extractKeywords([...allTitles, bio, ...transcriptTexts]);

  const combinedTranscriptText = transcriptTexts.join(" ").slice(0, 1000);
  const contentThemeLabels = await translateKeywordsToThemes(rawKeywords, topHashtags, allTitles, bio, combinedTranscriptText);
  const contentThemes = inferContentThemes(allTitles, topHashtags, bio);

  if (!location) {
    const allText = [bio, ...allTitles, combinedTranscriptText].join(" ");
    const locationMatch = allText.match(/\b(Toronto|New York|NYC|Los Angeles|LA|London|Dubai|Paris|Chicago|Miami|Houston|Atlanta|Montreal|Vancouver|Sydney|Melbourne|Cleveland|Brooklyn|Nashville|Austin|Seattle|Denver|Boston|Philadelphia)\b/i);
    if (locationMatch) location = locationMatch[1];
  }

  // Build transcript excerpts for DB storage
  const transcriptExcerpts = transcripts
    .slice(0, 3)
    .map(t => `[${t.caption.slice(0, 40) || "video"}]: ${t.transcript.slice(0, 200)}`)
    .join("\n\n");

  const evidenceSummary = buildCreatorEvidenceSummary({
    handle, platform: "TikTok", displayName, bio, followerCount, videoCount,
    totalLikes, totalViews, avgViews, engagementRate, location,
    videoTitles: allTitles, topHashtags, rawKeywords, contentThemeLabels, contentThemes,
    musicSignals: musicTitles, transcripts,
  });

  return {
    handle, platform: "TikTok", displayName, bio, followerCount, videoCount,
    totalLikes, totalViews, avgViews, engagementRate, location,
    profileUrl: `https://www.tiktok.com/@${handle}`,
    recentVideoTitles: allTitles, topHashtags, rawKeywords,
    contentThemeLabels, contentThemes,
    transcripts, transcriptCount: transcripts.length, transcriptExcerpts,
    evidenceSummary,
  };
}

// ─── YouTube Creator Research ─────────────────────────────────────────────────

async function researchYouTubeCreator(handleOrUrl: string): Promise<CreatorResearchResult> {
  const handle = extractHandle(handleOrUrl);

  const ytData = await fetchYouTubeTranscripts(handle);
  const {
    transcripts, channelId, displayName, bio, followerCount, videoCount,
    totalViews, location, channelKeywords, videoTitles, videoViewCounts,
  } = ytData;

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
  const combinedTranscriptText = transcriptTexts.join(" ").slice(0, 1000);
  const contentThemeLabels = await translateKeywordsToThemes(rawKeywords, topHashtags, uniqueVideoTitles, bio, combinedTranscriptText);
  const contentThemes = inferContentThemes(uniqueVideoTitles, topHashtags, bio);

  const profileUrl = channelId
    ? `https://www.youtube.com/channel/${channelId}`
    : `https://www.youtube.com/@${handle}`;

  const transcriptExcerpts = transcripts
    .slice(0, 3)
    .map(t => `[${t.caption.slice(0, 40) || "video"}]: ${t.transcript.slice(0, 200)}`)
    .join("\n\n");

  const evidenceSummary = buildCreatorEvidenceSummary({
    handle, platform: "YouTube", displayName, bio, followerCount, videoCount,
    totalLikes: 0, totalViews, avgViews, engagementRate, location,
    videoTitles: uniqueVideoTitles, topHashtags, rawKeywords, contentThemeLabels, contentThemes,
    transcripts,
  });

  return {
    handle, platform: "YouTube", displayName, bio, followerCount, videoCount,
    totalLikes: 0, totalViews, avgViews, engagementRate, location,
    profileUrl, recentVideoTitles: uniqueVideoTitles, topHashtags, rawKeywords,
    contentThemeLabels, contentThemes,
    transcripts, transcriptCount: transcripts.length, transcriptExcerpts,
    evidenceSummary,
  };
}

// ─── Brand Research ───────────────────────────────────────────────────────────

export async function researchBrand(brandNameOrUrl: string): Promise<BrandResearchResult> {
  const isUrl = brandNameOrUrl.startsWith("http");
  const brandName = isUrl
    ? brandNameOrUrl.replace(/https?:\/\/(www\.)?/, "").split("/")[0]
    : brandNameOrUrl;

  const snippets: string[] = [];
  let description = "";

  if (isUrl) {
    try {
      const html = await fetchHtml(brandNameOrUrl);
      const metaDesc = html.match(/<meta\s+(?:name|property)="description"\s+content="([^"]+)"/i)?.[1] ?? "";
      if (metaDesc) snippets.push(`Website description: ${metaDesc}`);
      const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
      if (title) snippets.push(`Website title: ${title}`);
      const headings = html.match(/<h[12][^>]*>([^<]+)<\/h[12]>/gi) ?? [];
      for (const h of headings.slice(0, 5)) {
        const text = h.replace(/<[^>]+>/g, "").trim();
        if (text.length > 5) snippets.push(`Heading: ${text}`);
      }
      const aboutMatch = html.match(/(?:about|mission|vision|values)[^<]{0,50}<[^>]+>([^<]{30,300})/gi) ?? [];
      for (const m of aboutMatch.slice(0, 3)) {
        const text = m.replace(/<[^>]+>/g, "").trim();
        if (text.length > 20) snippets.push(`About: ${text}`);
      }
      description = snippets.join(" | ").slice(0, 1000);
    } catch (err) {
      console.warn("[webResearch] Brand website fetch failed:", err);
    }
  }

  if (!isUrl || snippets.length < 2) {
    try {
      const ytResponse = await callDataApi("Youtube/search", {
        query: { q: `${brandName} brand about`, hl: "en", gl: "US" },
      }) as Record<string, unknown>;
      const contents = (ytResponse?.contents as unknown[]) ?? [];
      for (const item of contents.slice(0, 5)) {
        const videoData = ((item as Record<string, unknown>)?.video as Record<string, unknown>);
        if (videoData) {
          const title = (videoData?.title as string) ?? "";
          const desc = (videoData?.descriptionSnippet as string) ?? "";
          if (title) snippets.push(`YouTube result: ${title}`);
          if (desc) snippets.push(`YouTube description: ${desc}`);
        }
      }
      if (!description && snippets.length > 0) {
        description = snippets.join(" | ").slice(0, 1000);
      }
    } catch (err) {
      console.warn("[webResearch] Brand YouTube search failed:", err);
    }
  }

  const evidenceSummary = `
BRAND RESEARCH EVIDENCE
=======================
Brand Name: ${brandName}
Website: ${isUrl ? brandNameOrUrl : "Not provided"}
${description ? `Website Content:\n${description}` : ""}
${snippets.length > 0 ? `\nKey Snippets:\n${snippets.slice(0, 8).join("\n")}` : ""}

INSTRUCTIONS FOR ANALYSIS:
Based on the above evidence, extract the brand's cultural profile. If the website content is limited,
use your knowledge of this brand/business name to supplement, but clearly ground your analysis in
what the evidence shows. Do NOT invent a brand identity that contradicts the evidence.
`.trim();

  return { brandName, websiteUrl: isUrl ? brandNameOrUrl : "", description, searchSnippets: snippets, evidenceSummary };
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
    };
    return merged;
  }

  // Default: TikTok
  return researchTikTokCreator(handle);
}
