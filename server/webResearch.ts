/**
 * Web Research Layer
 * Gathers real, evidence-based data about a creator or brand BEFORE passing
 * anything to the LLM for cultural extraction. This prevents hallucination by
 * grounding every profile in actual public content.
 *
 * Supported platforms:
 * - TikTok: TikTok Data API (user info + popular posts) + HTML scrape for video descriptions
 * - YouTube: YouTube Data API (channel details + channel videos) — full stats available
 * - Multi: runs both TikTok and YouTube and merges results
 *
 * For brands: website HTML fetch + YouTube search for brand context
 */

import { callDataApi } from "./_core/dataApi";
import { invokeLLM } from "./_core/llm";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  engagementRate: number; // percentage 0–100
  location: string;
  profileUrl: string;
  recentVideoTitles: string[];
  topHashtags: string[];
  rawKeywords: string[];          // All extracted keywords (hashtags + title words)
  contentThemeLabels: string[];   // LLM-translated named themes (3–5)
  contentThemes: string[];        // Legacy rule-based themes (kept for evidence summary)
  evidenceSummary: string;        // Plain-text evidence block passed to LLM
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

/**
 * Extract meaningful keywords from video titles and descriptions.
 * Removes stop words, short tokens, and platform-generic terms.
 */
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
  ]);

  const wordCounts: Record<string, number> = {};
  for (const text of texts) {
    // Remove hashtags (handled separately), URLs, and special chars
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

/**
 * Use the LLM to translate raw keywords + hashtags into 3–5 named content themes.
 * Falls back to rule-based themes if LLM fails.
 */
async function translateKeywordsToThemes(
  keywords: string[],
  hashtags: string[],
  videoTitles: string[],
  bio: string
): Promise<string[]> {
  if (keywords.length === 0 && hashtags.length === 0) {
    return ["General Content Creator"];
  }

  try {
    const prompt = `You are a content analyst. Given the following keywords, hashtags, and video titles from a social media creator, identify 3–5 specific named content themes that best describe what this creator makes.

Keywords (most frequent): ${keywords.slice(0, 25).join(", ")}
Top hashtags: ${hashtags.slice(0, 15).join(", ")}
Sample video titles: ${videoTitles.slice(0, 10).join(" | ")}
Creator bio: ${bio}

Rules:
- Be specific (e.g., "Halal Food Reviews" not just "Food")
- Use 2–4 word theme names
- Return exactly 3–5 themes
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
    console.warn("[webResearch] LLM theme translation failed, using rule-based fallback:", err);
  }

  // Rule-based fallback
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

// ─── HTTP Fetch Helper ────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string> {
  const { default: axios } = await import("axios");
  const response = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
    timeout: 12000,
  });
  return response.data as string;
}

// ─── Number Formatter ─────────────────────────────────────────────────────────

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── TikTok Research ──────────────────────────────────────────────────────────

/**
 * Run multiple TikTok keyword searches for a creator to collect their actual videos.
 * This is the primary video-collection method since get_user_popular_posts returns
 * empty for small/mid-size creators.
 *
 * Strategy:
 * 1. Search "[handle]" — returns their own videos directly
 * 2. Search "[handle] [niche keywords]" — reinforces niche signal
 * 3. Collect ALL results (not just own-author matches) since the search is targeted
 *    enough that results are typically the creator's content
 */
async function collectTikTokVideosViaSearch(
  handle: string,
  bio: string
): Promise<{ titles: string[]; hashtags: string[]; viewCounts: number[]; musicTitles: string[]; avgViews: number }> {
  const titles: string[] = [];
  const hashtags: string[] = [];
  const viewCounts: number[] = [];
  const musicTitles: string[] = [];
  const seen = new Set<string>();

  // Build search queries — always run all 4 to maximize content coverage
  // We do NOT limit based on bio keywords because the bio may not reflect the content
  const bioLower = bio.toLowerCase();
  const cityMatch = bioLower.match(/toronto|nyc|new york|london|los angeles|la|miami|chicago|dubai|paris|montreal|vancouver|sydney|melbourne/);
  const cityQuery = cityMatch ? `${handle} ${cityMatch[0]}` : `${handle} lifestyle`;

  // Fixed 4-query set: always runs all 4 regardless of bio content
  const queries = [
    handle,                      // Primary: returns the creator's own videos directly
    `${handle} food`,            // Food/restaurant content
    `${handle} travel`,          // Travel/lifestyle content
    cityQuery,                   // City-specific or lifestyle fallback
  ];

  for (const q of queries) {
    try {
      const result = await callDataApi("TikTok/search_tiktok_video_general", {
        query: { keyword: q },
      }) as Record<string, unknown>;

      const items = (result?.item_list as unknown[]) ?? [];
      for (const item of items) {
        const v = item as Record<string, unknown>;
        const desc = (v?.desc as string) ?? "";

        // CRITICAL FIX: TikTok API uses 'stats' not 'statistics'
        const statsObj = (v?.stats as Record<string, unknown>) ?? (v?.statistics as Record<string, unknown>) ?? {};
        const views = Number(statsObj?.playCount ?? statsObj?.play_count ?? 0);

        // Extract hashtags from challenges array (most reliable source)
        const challenges = (v?.challenges as Array<Record<string, unknown>>) ?? [];
        for (const c of challenges) {
          const tagName = (c?.title as string) ?? (c?.name as string) ?? "";
          if (tagName) hashtags.push(`#${tagName}`);
        }

        // Extract hashtags from textExtra
        const textExtra = (v?.textExtra as Array<Record<string, unknown>>) ?? (v?.text_extra as Array<Record<string, unknown>>) ?? [];
        for (const tag of textExtra) {
          const tagName = (tag?.hashtagName as string) ?? (tag?.hashtag_name as string) ?? "";
          if (tagName) hashtags.push(`#${tagName}`);
        }

        // Extract music/audio title — key signal for personality/comedy creators
        const music = (v?.music as Record<string, unknown>) ?? {};
        const musicTitle = (music?.title as string) ?? "";
        const musicAuthor = (music?.authorName as string) ?? "";
        if (musicTitle && !musicTitle.startsWith("original sound") && musicTitle.length > 3) {
          // Named songs reveal content mood/genre
          if (!musicTitles.includes(musicTitle)) musicTitles.push(musicTitle);
        }
        // Original sounds by the creator themselves are a strong signal
        if (musicTitle.startsWith("original sound") && musicAuthor === handle) {
          if (!musicTitles.includes(`[original audio by @${handle}]`)) {
            musicTitles.push(`[original audio by @${handle}]`);
          }
        }

        if (views > 0) viewCounts.push(views);

        // Only add non-empty descriptions to titles
        if (desc && !seen.has(desc)) {
          seen.add(desc);
          titles.push(desc);
          // Extract inline hashtags from description
          const inlineTags = desc.match(/#([a-zA-Z0-9_]+)/g) ?? [];
          hashtags.push(...inlineTags);
        }
      }
    } catch (err) {
      console.warn(`[webResearch] TikTok search failed for query "${q}":`, err);
    }
  }

  const avgViews = viewCounts.length > 0
    ? Math.round(viewCounts.reduce((a, b) => a + b, 0) / viewCounts.length)
    : 0;

  return { titles, hashtags, viewCounts, musicTitles, avgViews };
}

async function researchTikTokCreator(handleOrUrl: string): Promise<CreatorResearchResult> {
  const handle = extractHandle(handleOrUrl);

  let secUid = "";
  let displayName = handle;
  let bio = "";
  let followerCount = 0;
  let videoCount = 0;
  let totalLikes = 0;
  let location = "";
  const videoTitles: string[] = [];

  // Step 1: TikTok Data API — user info
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

    const locationPatterns = [
      /\b(Toronto|New York|NYC|Los Angeles|LA|London|Dubai|Paris|Chicago|Miami|Houston|Atlanta|Montreal|Vancouver|Sydney|Melbourne|Calgary|Ottawa|Edmonton|Winnipeg|Quebec|Halifax|Cleveland|Brooklyn|Nashville|Austin|Seattle|Denver|Boston|Philadelphia)\b/i,
    ];
    for (const pattern of locationPatterns) {
      const match = bio.match(pattern);
      if (match) { location = match[1]; break; }
    }
  } catch (err) {
    console.warn("[webResearch] TikTok user info failed:", err);
  }

  // Step 2: Multi-query TikTok search — PRIMARY video collection method
  // get_user_popular_posts returns empty for small/mid creators, so we use
  // targeted keyword searches which reliably return the creator's own content.
  let totalViews = 0;
  const videoViewCounts: number[] = [];
  const searchHashtags: string[] = [];

  const searchResults = await collectTikTokVideosViaSearch(handle, bio);
  videoTitles.push(...searchResults.titles);
  searchHashtags.push(...searchResults.hashtags);
  videoViewCounts.push(...searchResults.viewCounts);
  totalViews = searchResults.viewCounts.reduce((a, b) => a + b, 0);
  const musicSignals: string[] = searchResults.musicTitles ?? [];

  // Step 3: TikTok HTML scrape — supplementary source for additional video captions
  // This extracts video descriptions embedded in the page JSON, which may include
  // videos not returned by the search API.
  try {
    const html = await fetchHtml(`https://www.tiktok.com/@${handle}`);

    // Extract from __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON
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
          if (desc && !videoTitles.includes(desc)) videoTitles.push(desc);
          const textExtra = (v?.textExtra as Array<Record<string, unknown>>) ?? [];
          for (const tag of textExtra) {
            const tagName = (tag?.hashtagName as string) ?? "";
            if (tagName) searchHashtags.push(`#${tagName}`);
          }
        }
      } catch { /* JSON parse failed, continue */ }
    }

    // Fallback: extract desc fields from raw HTML
    if (videoTitles.length < 5) {
      const descMatches = html.match(/"desc":"([^"]{10,200})"/g) ?? [];
      for (const m of descMatches) {
        const desc = m.replace(/^"desc":"/, "").replace(/"$/, "").trim();
        if (desc && !desc.includes("Followers") && !desc.includes("Watch awesome") && !videoTitles.includes(desc)) {
          videoTitles.push(desc);
        }
      }
    }

    if (!bio) {
      const sigMatch = html.match(/"signature":"([^"]+)"/);
      if (sigMatch) bio = sigMatch[1].replace(/\\n/g, " ").replace(/\\u[0-9a-fA-F]{4}/g, "").trim();
    }
  } catch (err) {
    console.warn("[webResearch] TikTok HTML scrape failed:", err);
  }

  // Step 4: Popular posts via Data API (works for large creators only)
  // Keep as a supplementary source — adds view counts and extra titles for big accounts
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
        if (desc.trim() && !videoTitles.includes(desc.trim())) videoTitles.push(desc.trim());
        if (views > 0) { videoViewCounts.push(views); totalViews += views; }
      }
    } catch (err) {
      console.warn("[webResearch] TikTok popular posts failed (expected for small creators):", err);
    }
  }

  // Step 5: YouTube search ONLY as last-resort fallback for large verified creators
  // DISABLED for small creators (< 50k followers) to prevent content contamination.
  // For large creators, YouTube search reliably returns their own content.
  if (videoTitles.length < 5 && followerCount >= 50000) {
    try {
      const ytResponse = await callDataApi("Youtube/search", {
        query: { q: `${handle} tiktok`, hl: "en", gl: "US" },
      }) as Record<string, unknown>;
      const contents = (ytResponse?.contents as unknown[]) ?? [];
      for (const item of contents.slice(0, 10)) {
        const videoData = ((item as Record<string, unknown>)?.video as Record<string, unknown>);
        if (videoData) {
          const title = (videoData?.title as string) ?? "";
          if (title) videoTitles.push(title);
        }
      }
    } catch (err) {
      console.warn("[webResearch] TikTok YouTube fallback search failed:", err);
    }
  }

  // Compute derived stats
  const avgViews = videoViewCounts.length > 0
    ? Math.round(videoViewCounts.reduce((a, b) => a + b, 0) / videoViewCounts.length)
    : 0;
  const engagementRate = followerCount > 0 && avgViews > 0
    ? Math.min(100, Math.round((avgViews / followerCount) * 100 * 10) / 10)
    : 0;

  const uniqueVideoTitles = Array.from(new Set(videoTitles)).slice(0, 30);
  // Merge hashtags from search results + extracted from titles
  const allHashtagSources = [...searchHashtags, ...uniqueVideoTitles, bio];
  const topHashtags = extractHashtags(allHashtagSources);
  const rawKeywords = extractKeywords([...uniqueVideoTitles, bio]);
  const contentThemeLabels = await translateKeywordsToThemes(rawKeywords, topHashtags, uniqueVideoTitles, bio);
  const contentThemes = inferContentThemes(uniqueVideoTitles, topHashtags, bio);

  // Extract location from all text if not found in bio
  if (!location) {
    const allText = [bio, ...uniqueVideoTitles].join(" ");
    const locationMatch = allText.match(/\b(Toronto|New York|NYC|Los Angeles|LA|London|Dubai|Paris|Chicago|Miami|Houston|Atlanta|Montreal|Vancouver|Sydney|Melbourne|Cleveland|Brooklyn|Nashville|Austin|Seattle|Denver|Boston|Philadelphia)\b/i);
    if (locationMatch) location = locationMatch[1];
  }

  const evidenceSummary = buildCreatorEvidenceSummary({
    handle, platform: "TikTok", displayName, bio, followerCount, videoCount,
    totalLikes, totalViews, avgViews, engagementRate, location,
    videoTitles: uniqueVideoTitles, topHashtags, rawKeywords, contentThemeLabels, contentThemes,
    musicSignals,
  });

  return {
    handle, platform: "TikTok", displayName, bio, followerCount, videoCount,
    totalLikes, totalViews, avgViews, engagementRate, location,
    profileUrl: `https://www.tiktok.com/@${handle}`,
    recentVideoTitles: uniqueVideoTitles, topHashtags, rawKeywords,
    contentThemeLabels, contentThemes, evidenceSummary,
  };
}

// Detect if this is a personality/comedy creator based on available signals
function detectCreatorType(videoTitles: string[], musicSignals: string[], bio: string, followerCount: number, avgViews: number): string {
  const allText = [...videoTitles, bio].join(" ").toLowerCase();
  const hasNicheKeywords = [
    "food","restaurant","review","recipe","travel","fitness","fashion","makeup",
    "tutorial","how to","tech","gaming","business","finance","education","news"
  ].some(kw => allText.includes(kw));

  // Personality signal: many empty captions + original sounds + high views
  const emptyRatio = videoTitles.length === 0 ? 1 : (videoTitles.filter(t => t.trim().length < 5).length / videoTitles.length);
  const hasOriginalSounds = musicSignals.some(m => m.includes("original audio"));
  const isViral = avgViews > 500_000;

  if (!hasNicheKeywords && (emptyRatio > 0.5 || hasOriginalSounds) && (isViral || followerCount > 500_000)) {
    return "PERSONALITY / COMEDY CREATOR";
  }
  if (allText.includes("comedy") || allText.includes("comedian") || allText.includes("funny") || allText.includes("skit")) {
    return "COMEDY CREATOR";
  }
  if (allText.includes("food") || allText.includes("restaurant") || allText.includes("eat")) {
    return "FOOD CREATOR";
  }
  if (allText.includes("travel") || allText.includes("explore") || allText.includes("trip")) {
    return "TRAVEL CREATOR";
  }
  return "GENERAL CONTENT CREATOR";
}

// ─── YouTube Research ─────────────────────────────────────────────────────────

async function researchYouTubeCreator(handleOrUrl: string): Promise<CreatorResearchResult> {
  const handle = extractHandle(handleOrUrl);

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

  // Step 1: YouTube channel search to find the channel
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
        if (desc) { bio = desc; videoTitles.push(desc); }
        break; // Take the first match
      }
    }
  } catch (err) {
    console.warn("[webResearch] YouTube channel search failed:", err);
  }

  // Step 2: Get full channel details (stats, keywords, description, country)
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

        // Channel keywords are gold — they're what the creator self-tags
        const kws = (details.keywords as string[]) ?? [];
        channelKeywords = kws.slice(0, 20);
        if (channelKeywords.length > 0) videoTitles.push(...channelKeywords);
      }
    } catch (err) {
      console.warn("[webResearch] YouTube channel details failed:", err);
    }

    // Step 3: Get channel videos for titles and per-video view counts
    try {
      const videosResponse = await callDataApi("Youtube/get_channel_videos", {
        query: { channelId, hl: "en", gl: "US" },
      }) as Record<string, unknown>;

      const contents = (videosResponse?.contents as unknown[]) ?? [];
      for (const item of contents.slice(0, 20)) {
        const videoData = ((item as Record<string, unknown>)?.video as Record<string, unknown>);
        if (videoData) {
          const title = (videoData?.title as string) ?? "";
          const videoStats = (videoData?.stats as Record<string, unknown>) ?? {};
          const views = Number(videoStats?.views ?? 0);
          if (title) videoTitles.push(title);
          if (views > 0) videoViewCounts.push(views);
        }
      }
    } catch (err) {
      console.warn("[webResearch] YouTube channel videos failed:", err);
    }
  }

  // Step 4: Fallback — YouTube video search if no channel found
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
          const desc = (videoData?.descriptionSnippet as string) ?? "";
          if (title) videoTitles.push(title);
          if (desc) videoTitles.push(desc);
        }
      }
    } catch (err) {
      console.warn("[webResearch] YouTube video search fallback failed:", err);
    }
  }

  // Compute derived stats
  const avgViews = videoViewCounts.length > 0
    ? Math.round(videoViewCounts.reduce((a, b) => a + b, 0) / videoViewCounts.length)
    : totalViews > 0 && videoCount > 0 ? Math.round(totalViews / videoCount) : 0;
  const engagementRate = followerCount > 0 && avgViews > 0
    ? Math.min(100, Math.round((avgViews / followerCount) * 100 * 10) / 10)
    : 0;

  const uniqueVideoTitles = Array.from(new Set(videoTitles)).slice(0, 25);
  const topHashtags = extractHashtags([...uniqueVideoTitles, bio]);
  const rawKeywords = Array.from(new Set([...channelKeywords, ...extractKeywords([...uniqueVideoTitles, bio])])).slice(0, 40);
  const contentThemeLabels = await translateKeywordsToThemes(rawKeywords, topHashtags, uniqueVideoTitles, bio);
  const contentThemes = inferContentThemes(uniqueVideoTitles, topHashtags, bio);

  const profileUrl = channelId
    ? `https://www.youtube.com/channel/${channelId}`
    : `https://www.youtube.com/@${handle}`;

  const evidenceSummary = buildCreatorEvidenceSummary({
    handle, platform: "YouTube", displayName, bio, followerCount, videoCount,
    totalLikes: 0, totalViews, avgViews, engagementRate, location,
    videoTitles: uniqueVideoTitles, topHashtags, rawKeywords, contentThemeLabels, contentThemes,
  });

  return {
    handle, platform: "YouTube", displayName, bio, followerCount, videoCount,
    totalLikes: 0, totalViews, avgViews, engagementRate, location,
    profileUrl, recentVideoTitles: uniqueVideoTitles, topHashtags, rawKeywords,
    contentThemeLabels, contentThemes, evidenceSummary,
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

  // Fetch brand website if URL provided
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

  // YouTube search for brand context (works for both URL and name-only inputs)
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

// ─── Evidence Summary Builder ─────────────────────────────────────────────────

function buildCreatorEvidenceSummary(data: {
  handle: string; platform: string; displayName: string; bio: string;
  followerCount: number; videoCount: number; totalLikes: number;
  totalViews: number; avgViews: number; engagementRate: number;
  location: string; videoTitles: string[]; topHashtags: string[];
  rawKeywords: string[]; contentThemeLabels: string[]; contentThemes: string[];
  musicSignals?: string[];
}): string {
  const {
    handle, platform, displayName, bio, followerCount, videoCount, totalLikes,
    totalViews, avgViews, engagementRate, location, videoTitles, topHashtags,
    rawKeywords, contentThemeLabels, contentThemes, musicSignals = [],
  } = data;

  const creatorType = detectCreatorType(videoTitles, musicSignals, bio, followerCount, avgViews);

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

CONTENT THEMES (LLM-translated from actual content):
${contentThemeLabels.map((t) => `  • ${t}`).join("\n")}

RULE-BASED THEMES (cross-reference):
${contentThemes.map((t) => `  • ${t}`).join("\n")}

TOP KEYWORDS (from video titles/descriptions):
${rawKeywords.slice(0, 20).join(", ")}

TOP HASHTAGS:
${topHashtags.slice(0, 15).join(", ")}

DETECTED CREATOR TYPE: ${creatorType}
${creatorType.includes("PERSONALITY") || creatorType.includes("COMEDY") ? `
⚠️  PERSONALITY CREATOR NOTE: This creator uses minimal captions. Their identity comes from
    their PRESENCE, STYLE, and AUDIENCE RELATIONSHIP — not from descriptive post titles.
    Use follower count, avg views, bio tone, and music choices to infer their archetype.
    Do NOT default to a niche topic just because captions are sparse.
` : ""}
ACTUAL VIDEO TITLES / DESCRIPTIONS (${videoTitles.length} posts sampled):
${videoTitles.length > 0 ? videoTitles.slice(0, 20).map((t, i) => `  ${i + 1}. ${t}`).join("\n") : "  [No descriptive captions found — this creator uses minimal text in their posts]"}

MUSIC / AUDIO SIGNALS (${musicSignals.length} tracks — reveals content mood and style):
${musicSignals.length > 0 ? musicSignals.slice(0, 10).map((m) => `  • ${m}`).join("\n") : "  [No named audio tracks extracted]"}

CRITICAL ANALYSIS INSTRUCTIONS:
⚠️  CONTENT IS PRIMARY — BIO IS SECONDARY AND MUST BE CHALLENGED

The creator's bio/signature is a SELF-REPORTED label. People often describe themselves by
their personal identity ("father", "mom", "entrepreneur") rather than their content niche.
You MUST analyze what they actually CREATE, not what they say about themselves.

RULE 1: If the video titles show a clear content niche (e.g., food reviews, comedy, music),
         that niche IS the creator's professional identity — regardless of what the bio says.

RULE 2: The bio should only influence the analysis if it MATCHES the video content evidence.
         If the bio says "father" but all videos are about food — this creator is a FOOD CREATOR.

RULE 3: Archetype, niche, and values must be derived from the VIDEO TITLES and HASHTAGS,
         not from the bio. The bio is context, not identity.

RULE 4: If you see 10+ food-related video titles, the creator's primary identity is food.
         Do NOT classify them as "family" or "lifestyle" just because the bio mentions family.

Analyze the ACTUAL CONTENT EVIDENCE above and derive the cultural profile from it.
`.trim();
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
    // Run both and merge — use TikTok as primary, supplement with YouTube
    const [tiktokResult, youtubeResult] = await Promise.allSettled([
      researchTikTokCreator(handle),
      researchYouTubeCreator(handle),
    ]);

    const tiktok = tiktokResult.status === "fulfilled" ? tiktokResult.value : null;
    const youtube = youtubeResult.status === "fulfilled" ? youtubeResult.value : null;

    if (!tiktok && !youtube) return researchTikTokCreator(handle); // both failed, try again
    if (!tiktok) return youtube!;
    if (!youtube) return tiktok;

    // Merge: combine video titles, keywords, hashtags; take best stats
    const mergedTitles = Array.from(new Set([...tiktok.recentVideoTitles, ...youtube.recentVideoTitles])).slice(0, 30);
    const mergedHashtags = Array.from(new Set([...tiktok.topHashtags, ...youtube.topHashtags])).slice(0, 20);
    const mergedKeywords = Array.from(new Set([...tiktok.rawKeywords, ...youtube.rawKeywords])).slice(0, 40);
    const mergedThemes = Array.from(new Set([...tiktok.contentThemeLabels, ...youtube.contentThemeLabels])).slice(0, 5);

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
      evidenceSummary: `${tiktok.evidenceSummary}\n\n--- YOUTUBE EVIDENCE ---\n${youtube.evidenceSummary}`,
    };
    return merged;
  }

  // Default: TikTok
  return researchTikTokCreator(handle);
}
