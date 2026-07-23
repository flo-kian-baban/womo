# WOMO — Pipeline & Science Reference

**Authoritative explanation of what we scrape, what we feed the AI, what the AI returns, and how the scoring engine consumes it.** Produced by a read-only investigation on **2026-07-23** at commit **`2754a8d`**; live database introspected read-only via the Supabase MCP (project `smvflfoxnkghkiuamkmi`).

**Convention:** every claim is **[FACT]** (read directly in code at the cited `file:line`, or returned by a live read-only query) or **[INFERENCE]** (interpretation from facts). Line numbers refer to commit `2754a8d`. This document is the basis for designing an editable/re-runnable layer — see §5.

---

## 0. PRIORITY QUESTION — Can the LLM access anything beyond the prompt?

### Verdict

**[FACT] The model is strictly bounded to prompt content. No tool, function-calling, web-search, grounding, or retrieval capability is configured or passed anywhere in the system.** Every piece of "knowledge" in an extraction comes from (a) the evidence text we interpolate into the prompt, or (b) the model's pretrained weights. There is no mechanism by which any LLM call can fetch external information at inference time.

### Proof

**One LLM gateway.** All chat-completion traffic goes through a single function, `invokeLLM()` (`server/_core/llm.ts:276`), which POSTs to Google's OpenAI-compatibility endpoint:

- **Endpoint** — `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` (`llm.ts:222-223`). [FACT]
- **Model** — hardcoded `"gemini-2.5-flash"` (`llm.ts:295`). [FACT]
- **Tools are conditional and never supplied.** The payload only ever gains a `tools` field when the caller passes one: `if (tools && tools.length > 0) { payload.tools = tools; }` (`llm.ts:340-342`), and `tool_choice` likewise (`llm.ts:345-350`). **A grep of every caller file (`aiExtraction.ts`, `symbolDecoder.ts`, `brandSymbolDecoder.ts`, `brandTikTokAnalysis.ts`, `brandInstagramAnalysis.ts`, `webResearch.ts`, `routers.ts`) finds zero occurrences of `tools`, `toolChoice`, or `tool_choice` in any `invokeLLM` invocation.** [FACT]
- **No grounding.** The strings `grounding`, `google_search`, and `googleSearch` appear nowhere in `server/` outside of the unrelated `scrape_method` enum value `"google_search"` (a scrape-event label, `db.ts:237`). Google's search-grounding feature would have to be requested explicitly in the payload; it never is. [FACT]
- **Payload contents** — exactly: `model`, `messages`, optional `tools`/`tool_choice` (never triggered), `max_tokens` (`llm.ts:353`), optional `temperature` (`llm.ts:354-356`), optional `response_format` (`llm.ts:358-367`). Nothing else. [FACT]

**One audio-transcription side channel.** `server/_core/voiceTranscription.ts` makes two direct fetches:
- OpenAI Whisper: `https://api.openai.com/v1/audio/transcriptions`, `model=whisper-1`, `response_format=verbose_json`, multipart file + text prompt (`voiceTranscription.ts:154-182`). No tools exist in this API. [FACT]
- Gemini audio fallback: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` with `contents` = inline base64 audio + a transcription instruction, `generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }` (`voiceTranscription.ts:364-384`). No `tools` field in the payload. [FACT]

**Which path runs is key-dependent:** if `OPENAI_API_KEY` is absent and `GEMINI_API_KEY` present, Gemini audio is used (`voiceTranscription.ts:116-118`). [FACT]

### Determinism-relevant settings per call site

| # | Purpose (`purpose` label) | Caller | temperature | max_tokens | response_format |
|---|---|---|---|---|---|
| 1 | `creator_profile_extraction` | `aiExtraction.ts:183` | **0** (`:189` — the ONLY call site that sets one) | default 32 768 | strict json_schema |
| 2 | `brand_profile_extraction` | `aiExtraction.ts:505` | unset → API default | default 32 768 | strict json_schema |
| 3 | `fit_narrative_generation` | `aiExtraction.ts:637` | unset | default 32 768 | strict json_schema |
| 4 | `creator_symbol_decoding` | `symbolDecoder.ts:129` | unset | default 32 768 | strict json_schema |
| 5 | `brand_symbol_decoding` | `brandSymbolDecoder.ts:206` | unset | default 32 768 | strict json_schema |
| 6 | `content_theme_extraction` | `webResearch.ts:245` | unset | default 32 768 | strict json_schema |
| 7 | `brand_mention_analysis` | `brandTikTokAnalysis.ts:366` | unset | default 32 768 | strict json_schema |
| 8 | `brand_channel_analysis` | `brandTikTokAnalysis.ts:620` | unset | default 32 768 | strict json_schema |
| 9 | `brand_instagram_voice_analysis` | `brandInstagramAnalysis.ts:196` | unset | default 32 768 | strict json_schema |
| 10 | `myth_tension_analysis` | `routers.ts:1673` | unset | default 32 768 | strict json_schema |
| 11 | `cultural_synergy_analysis` | `routers.ts:1837` | unset | default 32 768 | strict json_schema |
| 12 | `cultural_borrowing_analysis` | `routers.ts:1950` | unset | default 32 768 | **none** (free text) |
| — | Whisper transcription | `voiceTranscription.ts:175` | n/a (API) | n/a | verbose_json |
| — | Gemini audio transcription | `voiceTranscription.ts:386` | **0.1**, maxOutputTokens 4096 | — | free text |

[FACT] `max_tokens` default: `payload.max_tokens = params.maxTokens ?? params.max_tokens ?? 32768` (`llm.ts:353`). [FACT] "unset temperature" means the payload carries no temperature field at all (`llm.ts:354-356`); the effective value is whatever Google's server-side default for `gemini-2.5-flash` is — **not pinned by our code**, so 11 of 12 chat calls are not run at deterministic settings. [INFERENCE] Re-running any of those calls on identical evidence can produce different output; only creator extraction (temperature 0) approaches determinism, and even that is not guaranteed bit-identical.

Retry/timeout behavior (all calls): 429 retried at 5s/15s/30s, per-attempt 60s abort (`llm.ts:333-397`); success and failure both logged to `llm_invocations` with tokens/duration/error (`llm.ts:297-331`).

---

## 1. SCRAPE INVENTORY

### 1.1 TikTok (creator path) — `researchTikTokCreator` (`webResearch.ts:1660`)

**Profile fetch — multi-path (`scraping/tiktok/profileScraper.ts`).** Phase 1 fetches user info over HTTP; Phase 2 **always** runs Playwright for video collection (`profileScraper.ts:329-378`):
- Path A desktop HTTP — **skipped entirely** ("FIX 3.4", `profileScraper.ts:334-336`). [FACT]
- Path B mobile web: `fetchHtml("https://m.tiktok.com/@handle")` with mobile UA (`:126-148`).
- Path C Playwright desktop: session-warm on tiktok.com, navigate profile, wait for `#__UNIVERSAL_DATA_FOR_REHYDRATION__`, then 6 scroll steps over ~12 s to trigger `item_list` XHRs, which are intercepted and accumulated (`:161-271`). **Primary video source.** [FACT]
- Path D Google cache: `webcache.googleusercontent.com` (`:275-291`), last resort.

**Variables extracted (profile):** from rehydration JSON / XHR `user/detail` / regex fallback (`:396-421`, `:480-535`, `:650-684`):

| Variable | Source | Required? | When absent |
|---|---|---|---|
| `secUid`, `id`, `uniqueId`, `nickname` (→displayName), `signature` (→bio), `verified` | `__DEFAULT_SCOPE__["webapp.user-detail"].userInfo.user` or XHR `/api/user/detail/`; regex fallback on raw HTML (`:658-666`) | optional | defaults: handle as name, empty bio; `secUid` absence aborts API video fetch (`webResearch.ts:684-686`) |
| `followerCount`, `followingCount`, `heartCount` (→totalLikes), `videoCount` | `.stats` same sources | optional | 0; engagement tier undefined; follower-based engagement fallback unavailable |
| `location` | regex over bio, later titles+transcripts, against a hardcoded city list (`webResearch.ts:1698`, `:1802-1806`) | optional | empty string |

**Variables extracted (per video):** from XHR `item_list` / rehydration `itemList` / search API (`profileScraper.ts:596-648`, `webResearch.ts:800-874`): `id`, `desc` (caption), `createTime`, `stats.playCount/diggCount/commentCount/collectCount/shareCount`, `music.title/authorName/original`, `video.duration`, `author.uniqueId` (author guard), `duetEnabled`, `stitchEnabled`, `isAd`, `challenges[].title` + `textExtra[].hashtagName` (hashtags). [FACT]

**Supplemental search** always runs with 4 query variants (handle, @handle, dot-stripped ×2) via `searchTikTokVideos` (Playwright search page, `scraping/tiktok/searchScraper.ts:112`), author-filtered by normalized-handle match (`webResearch.ts:803-814`). [FACT]

**Derived (computed, not scraped):** engagement signals over ALL collected videos — avgCommentRate, avgSaveRate, avgShareRate, avgLikeRate, originalAudioRate, remixEnablementRate, adTagRate, avgDurationSeconds, temporal buckets recent/mid/older (`webResearch.ts:1039-1092`); `engagementRate` = (avgLikeRate+avgCommentRate)×100, fallback avgViews/followers (`:1782-1788`); hashtag/keyword frequency extraction with a large stop-word list (`:160-211`); rule-based content themes from a keyword→theme map (`:282-307`); cultural velocity from top-20-word overlap between recent vs historic transcripts, ≥10/20 shared = "Focusing" (`:1104-1123`). [FACT]

**Hard gates:** quota-exhausted with no content → `TOO_MANY_REQUESTS` (`:1743-1748`); nothing at all → `NOT_FOUND` (`:1756-1761`); `< 2` real transcripts AND `< 4` titles → `PRECONDITION_FAILED` "insufficient data" (`:1770-1775`). "Real transcripts" excludes caption-fallback entries (`:1766`). [FACT]

### 1.2 The video/transcript pipeline and the 6-3-3 sample

**Discovery:** API-scraped videos + search-supplemented videos are pooled and deduplicated (`webResearch.ts:769-884`); `< 4` videos logs a degradation warning but continues (`:886-888`).

**6-3-3 stratified sampling (`webResearch.ts:892-994`):** sort by `createTime` desc; **recent** = 6 newest; **mid** = 3 evenly-spaced picks from the 6–18-month window; **anchor** = 3 evenly-spaced picks from the >18-month window; if mid/anchor come up short they are **filled forward from the oldest available videos** not already used (`:939-977`) — so a young account's "anchor" bucket may contain videos that are not actually 18 months old. [FACT] Completeness: ≥12 fetched = "full", ≥6 = "partial", else "insufficient" (`:1099-1102`).

**Transcript attempt per sampled video (`fetchVideoTranscriptMultiPath`, `webResearch.ts:365-552`)** — concurrency 3, shared Playwright context:
- **Path A:** HTTP-fetch the video page (`fetchHtml`), parse rehydration JSON → `video.subtitleInfos[].Url` (prefer `eng*`), download WEBVTT **via axios** and parse to plain text (`:386-413`, `:576-599`). Source label `"captions"`.
- **Path B+C:** Playwright: navigate the video page with a subtitle-XHR route interceptor; B = `page.evaluate` reads `subtitleInfos` and downloads; C = intercepted `.vtt` body parsed directly (`:415-533`). Labels `"playwright-webvtt"` / `"playwright-xhr"`.
- **Path E:** caption fallback — the caption text itself becomes the "transcript" **only if it has ≥ 8 non-hashtag words** (`:535-548`). Label `"caption"`.
- **Whisper is NOT used on the TikTok path.** The header comment states "Path D (Whisper via Playwright video URL) is deferred to Pass 2" (`webResearch.ts:363`); no code calls `transcribeAudio` for TikTok. [FACT]

**"No transcript" mechanically means:** all of A/B/C found no `subtitleInfos` (creator never enabled/generated captions, or TikTok withheld them) or the WEBVTT download failed, AND the caption had < 8 real words — the function returns `null` and the video contributes only metadata (`:550-551`). The observation's `transcript_count` and derived confidence (≥6 high / ≥3 medium / else low, `routers.ts` transcript_count enrichment) reflect this. [FACT]

### 1.3 Instagram (creator path) — `researchInstagramCreator` (`webResearch.ts:1855`)

**Profile fetch — multi-path (`scraping/instagram/profileScraper.ts`):** Path A Playwright mobile-web with XHR capture (`web_profile_info` + feed via `context.request`, `:22-306`); Path A2 Playwright desktop (`:308-435`); Path B Picuki (`:437-553`); oEmbed last resort (`:648-660`); results merged with per-source confidence (`:556-677`). Fields per `scraping/instagram/types.ts:9-37`: profile — `username, full_name, biography, follower_count, following_count, media_count, category, external_url, is_business_account, is_verified`; per post — `id, shortcode, timestamp, caption, like_count, comment_count, view_count, media_type, video_duration, video_url`. [FACT]

**Transcripts:** up to 6 video/reel posts; the video file is downloaded **via Playwright `context.request`** (inherits cookies), then sent to `transcribeAudio` (`webResearch.ts:1900-2003`) — **Whisper if `OPENAI_API_KEY` is set, else Gemini audio** (§0). Accepted if ≥10 chars. The transcript source stored into the discovered pool is the literal string `"gemini-2.5-flash"` (`webResearch.ts:2097`). [FACT]

**Absence behavior:** no profile data AND no posts → `NOT_FOUND` (`:1871-1876`); otherwise degrade (no thin-data PRECONDITION gate exists on the Instagram path, unlike TikTok). [FACT]

### 1.4 YouTube (creator path) — `researchYouTubeCreator` (`webResearch.ts:2140`)

Channel search → channel details → video list, all via HTML scraping helpers (`scraping/youtube/searchScraper.ts:56`, `channelScraper.ts:62,193` — `fetchHtml` based). Variables: `channelId, title, descriptionSnippet/description` (bio ≤500 chars), `country` (location), `stats.subscribers/videos/views`, `keywords[]` (≤20), per-video `title, videoId, stats.views`. Transcripts: fetch each watch page, parse `ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks[]` (prefer `en`), download caption XML via axios, strip tags (`:1187-1260`). ≤10 videos in batches of 3. Degrades gracefully below 3 transcripts (comment `webResearch.ts:22-23`); quota-with-no-content → `TOO_MANY_REQUESTS`, nothing → `NOT_FOUND` (`:2154-2166`). `totalLikes` is always 0 for YouTube (`:2205,2212`). [FACT]

### 1.5 Brand website — `crawlBrandWebsite` (`webResearch.ts:2291-2421`)

Root page via `fetchHtml`, then up to 8 same-origin links whose path matches semantic patterns (`about|story|mission|values|culture|blog|journal|manifesto|philosophy|vision|team|who-we-are|products|services|solutions|features|why-us|our-story`, `:2246-2250`), until 2 000 words. Extracted: meta/OG description, `keywords` meta, title/OG title, h1–h3 headings (≤10/page), JSON-LD `description/name/sameAs`, body text (≤3 000 chars/page). If HTTP yields < 100 words → Playwright render fallback (`:2366-2414`). Description passed onward = first 6 000 chars (`:2482`). Fallbacks when crawl thin: Google search snippets via `searchWeb` (`scraping/brand/searchFallback.ts:36,89` — scrapes Google/Bing result pages, not an API), then YouTube search (`:2532-2552`). Minimum-evidence guard: <100 words AND 0 reviews AND 0 mentions AND <3 snippets → `PRECONDITION_FAILED` (`:2727-2738`). [FACT]

### 1.6 Google Places / Maps — `reviewResearch.ts`

- **URL path (no API):** HTTP-fetch the Maps URL, parse `APP_INITIALIZATION_STATE` protobuf for place name + feature id — **rating and reviews cannot be obtained this way** (comment `:186-190`, code `:191-270`). [FACT]
- **API path:** Google Places textsearch (`query`, name-similarity-validated against top 3 via normalized Levenshtein < 0.4, `:576-589`, `:477-481`) then `place/details` with 4 `reviews_sort` orders (~5 reviews each, deduped, ≤50) — fields `author_name, rating, text, time, formatted_address` (`:597-658`). Requires `GOOGLE_MAPS_API_KEY` (`_core/map.ts:29,64`). [FACT]
- Absence: source simply missing from the evidence; review fields null on `brand_observations`.

### 1.7 Yelp — `scrapeYelpReviews` (`reviewResearch.ts:304-451`)

Playwright: search page → first non-sponsored `/biz/` link → business page; DOM extraction of h1 name, star rating from `aria-label`, review count from body text regex, ≤15 review cards (paragraph text > 20 chars, star per card). DataDome block detection aborts (`:315-324, 352-357`); business-name similarity check prevents wrong-business contamination (`:428-431`). [FACT]

### 1.8 Brand TikTok channel + audience mentions — `brandTikTokAnalysis.ts`

- **Track A (channel, only when URL provided):** user info via `scrapeTikTokUserInfo`; owned videos via search `@handle` filtered to author==handle; per-video engagement aggregation → `engagementRate`, `averageViews`; transcripts for ≤6 videos via `fetchSingleTikTokTranscript` (captions-only re-fetch, `webResearch.ts:2869-2932`); post frequency bucketed by video count (`:724-728`); temporal buckets + word-overlap cultural velocity (`:731-784`). [FACT]
- **Track B (mentions, always for brands):** 4 searches (`name`, `name haul`, `name review`, `name finds`), dedup, exclude brand's own handle; per video: caption, hashtags (textExtra+challenges), music title/artist, author handle, likes/comments/shares/saves/plays, createdAt; temporal weight 1.5/1.0/0.5; weighted engagement; top-15 hashtags (`:161-292`). [FACT]

### 1.9 Brand Instagram — `brandInstagramAnalysis.ts`

Profile + posts via the same Instagram scraper; engagement from likes+comments vs followers; one LLM voice-analysis call (§2.9). [FACT]

### 1.10 Why a run can have content_items and decoded_signals but ZERO scrape_events (open bug — diagnosis only)

**[FACT — live DB]** Exactly one observation currently carries a `run_id` (an Instagram creator run on 2026-07-23). It has **12 content_items, 8 decoded_signals, 3 run-tagged llm_invocations — and 0 scrape_events with its run_id**. Across the table's 347+ rows, only 7 `scrape_method` values have ever been logged: `tiktok_desktop_http, instagram_oembed, youtube_html, google_maps_api, google_search, website_crawl, manual_entry`. **None of the Playwright methods (`tiktok_playwright`, `instagram_playwright`, `tiktok_search_*`, `tiktok_mobile_http`, `whisper_transcription`) has ever produced a row.**

**Diagnosis — scrape-event writing is conditional on transport and URL shape, and most real scraping bypasses both conditions:**

1. **Only `fetchHtml()` auto-logs.** `insertScrapeEvent` is called from exactly three places: `httpClient.ts` `logScrapeSuccess`/`logScrapeFailure` (inside `fetchHtml`, `httpClient.ts:326-380`), `webResearch.ts` brand-crawl and google-search events (`:2488, 2520`), and `reviewResearch.ts` Google-Maps events (`:696, 728`). **No scraper module calls it directly.** [FACT]
2. **Playwright traffic is invisible.** All `page.goto`, `context.request`, and XHR-interception fetches — the *primary* path for TikTok video collection (`profileScraper.ts:344-346` "ALWAYS run Playwright"), the entire Instagram profile scraper, TikTok search, Yelp, and Instagram reel downloads — never pass through `fetchHtml`, so nothing is logged. [FACT]
3. **`fetchHtml` itself filters by URL.** `inferScrapeContext()` returns null (→ no log) for anything that isn't a TikTok profile/video page, an Instagram profile//p//oembed URL, or a YouTube URL (`httpClient.ts:270-292`) — explicitly skipping TikTok API/search/subtitle URLs. WEBVTT subtitle and YouTube caption downloads additionally use **axios** directly (`webResearch.ts:578, 1237`), bypassing logging twice over. Whisper/Gemini transcription calls log nothing. [FACT]
4. **Run-id tagging is NOT the cause for new runs** — `insertScrapeEvent` stamps the ambient `currentRunId()` (`db.ts`, womo_0006), and AsyncLocalStorage reaches the `fetchHtml` fire-and-forget logging. The Instagram run above logged zero events because its path (Playwright profile scrape + `context.request` reel downloads + Gemini transcription) contains **no `fetchHtml` call that matches a loggable URL** — not because tagging failed. [INFERENCE, strongly supported: the same run did tag its 3 llm_invocations.] For **pre-womo_0006** observations there is an additional, separate gap: events were linked only by `observation_id`, which httpClient never sets, so old diagnostics found nothing even when events existed. [FACT]

**Net:** the diagnostic panel's scrape section under-reports reality for any Playwright-heavy run — a TikTok run shows only its HTTP video-page fetches (Path A transcript attempts), and an Instagram run typically shows nothing. This is a coverage gap in telemetry, not evidence that no scraping occurred.

---

## 2. LLM EXTRACTION STRUCTURE

All calls share the gateway facts of §0 (model, endpoint, no tools, retry, logging). "Strict json_schema" means `response_format: { type: "json_schema", json_schema: { strict: true, schema } }` — the OpenAI-compat layer constrains output to the schema, which is why enum fields cannot come back out-of-vocabulary at the transport level.

### 2.1 Creator profile extraction — `extractCreatorProfile` (`aiExtraction.ts:40-247`)

**Purpose** `creator_profile_extraction` · **temperature 0** (`:189`) · strict json_schema `creator_profile`.

**System prompt (verbatim, `aiExtraction.ts:45-90`):**

```
You are a cultural anthropologist and media analyst specializing in creator marketing.
Your task is to analyze a social media creator and produce a structured cultural profile using the Connex Cultural Match Platform framework.

CRITICAL INSTRUCTION — TRANSCRIPT CONTENT IS THE HIGHEST PRIORITY SIGNAL:
You will receive evidence that may include SPOKEN TRANSCRIPTS from the creator's actual videos.
If transcripts are present in the evidence (marked as PRIMARY EVIDENCE), treat them as GROUND TRUTH.
Transcripts reveal what the creator literally says — their vocabulary, topics, personality, and values.
This is more reliable than any other signal.

HIERARCHY OF EVIDENCE (highest to lowest):
1. SPOKEN TRANSCRIPTS — what the creator literally says in their videos (most reliable)
2. COMPUTED ENGAGEMENT SIGNALS — data-driven metrics derived from raw API data (use these directly, do not re-derive)
3. TEMPORAL CONTENT ANALYSIS — time-bucketed video history (use for Drift Signal and Goffman)
4. VIDEO TITLES / CAPTIONS — what they post (reliable)
5. HASHTAGS / KEYWORDS — how they tag content (reliable)
6. BIO / SIGNATURE — self-reported personal label (least reliable, often misleading)

CRITICAL RULE — THE CREATOR'S NAME OR HANDLE MUST NEVER INFLUENCE ANY FIELD EXCEPT 'pronouns':
Do NOT use the creator's name, handle, or cultural/religious background implied by their name to infer archetype, niche, myth, values, or any other field.
A handle like 'alkhussein' does not mean the creator is a caregiver, spiritual, or religious — it is just a name.
A handle like 'foodgod' does not mean the creator is a food creator — look at the actual content.
The ONLY field that may use the display name as a signal is 'pronouns' (for gender inference).
Every other field MUST be derived exclusively from content evidence: transcripts, video titles, hashtags, and engagement data.

Examples of correct behavior:
- Transcripts show food reviews and restaurant visits → classify as FOOD CREATOR regardless of bio or name
- Bio says "father of 5" but transcripts are all food reviews → FOOD CREATOR, not family/parenting
- Bio says "entrepreneur" but transcripts are comedy skits → COMEDY CREATOR, not business
- Handle implies a cultural/religious identity → IGNORE for archetype; look at what they actually post
- Evidence shows comment rate 0.35% → parasocialBondStrength = 4.0 (use the computed label, do not guess)
- Evidence shows save rate 0.8% → audienceRelationshipType = "Mentor" (use the computed label)
- Evidence shows original audio 60% + high share rate → culturalCapital = "Produce"

NEVER let a personal bio, name, or handle override transcript or video content evidence.
The creator's professional identity is what they CREATE and SAY, not what they are called.
Be rigorous, specific, and grounded in the evidence. Use the exact terminology specified.

KEYWORD AND THEME EXTRACTION INSTRUCTION:
When identifying keywords and recurring themes, prioritize words and phrases that reveal:
- Beliefs and values (e.g. "halal", "authentic", "community", "self-made", "grind", "faith")
- Emotional drivers (e.g. "nostalgia", "pride", "belonging", "aspiration", "comfort")
- Identity claims (e.g. "immigrant", "diaspora", "first-gen", "Muslim", "Black-owned", "queer")
- Status markers (e.g. "exclusive", "underground", "mainstream", "viral", "local gem")
- Motivations (e.g. "inspire", "educate", "entertain", "connect", "represent")
- Social capital signals (e.g. "in-the-know", "early adopter", "community leader")
These are more anthropologically revealing than topic nouns alone.
```

**User prompt (verbatim, `aiExtraction.ts:96-181`; `${evidenceBlock}` and `${handleOrUrl}`/`${platform}` are the interpolations):**

```
Analyze the following social media creator and produce a complete Connex Cultural Match Platform cultural profile.${evidenceBlock}

Creator Handle: ${handleOrUrl}
Platform: ${platform}

Based on the evidence above, output a JSON object with EXACTLY these fields:

{
  "handle": "their @handle (without @)",
  "platform": "TikTok" | "YouTube" | "Multi",
  "displayName": "their display name",
  "archetype": ONE OF EXACTLY: "The Sage" | "The Hero" | "The Outlaw" | "The Explorer" | "The Magician" | "The Ruler" | "The Caregiver" | "The Lover" | "The Jester" | "The Innocent" | "The Everyman" | "The Creator".
    ARCHETYPE DECISION RULES - apply in strict priority order, pick the FIRST match:
    1. The Outlaw: creator challenges norms, confronts authority, speaks bluntly or controversially, rates or judges people/food directly in front of them, or positions as anti-establishment. CRITICAL: If transcripts show confrontational or provocative behavior - even if they also explore food or culture - classify as The Outlaw, NOT The Explorer.
    2. The Hero: overcomes adversity, documents achievement journey, motivates others through difficulty.
    3. The Explorer: discovers new places/cultures with curiosity and openness. Neutral/curious tone. Do NOT use if primary mode is confrontation or judgment.
    4. The Everyman: relatable, ordinary, seeks belonging. Self-deprecating humor, everyday life.
    5. The Jester: entertains through humor, comedy skits, pranks.
    6. The Sage: educates, explains, shares expertise. Tutorial or analysis content.
    7. The Lover: beauty, relationships, sensory experience, passion with emotional depth.
    8. The Caregiver: nurtures, supports, advocates for others.
    9. The Magician: transforms situations, reveals hidden truths, before/after content.
    10. The Ruler: commands authority, leads, demonstrates mastery.
    11. The Creator: builds, makes, crafts original work. DIY, art, design.
    12. The Innocent: projects optimism, purity, nostalgia. Wholesome content.,
  "recurringThemes": ["theme1", "theme2", "theme3"] (3-4 specific recurring content topics/formats — be anthropologically specific, e.g. "Halal Street Food Reviews" not "Food", "Diaspora Identity Storytelling" not "Culture"),
  "toneRegister": "2-3 words describing their emotional register and communication style",
  "parasocialBondStrength": number between 1.0 and 5.0.
    RULE: If the evidence includes a PARASOCIAL BOND STRENGTH label in COMPUTED ENGAGEMENT SIGNALS,
    extract the numeric value from that label (e.g. "4.0 — Strong bond" means use 4.0).
    Only estimate independently if no computed signal is present.
    Estimation rubric: 5.0=deep friend bond (comment rate >=0.5%), 4.0=strong engagement (>=0.25%),
    3.0=moderate/professional distance (>=0.10%), 2.0=weak/passive (>=0.05%), 1.0=transactional (<0.05%),
  "audienceRelationshipType": "Friend" | "Mentor" | "Authority".
    RULE: If the evidence includes an AUDIENCE RELATIONSHIP TYPE label in COMPUTED ENGAGEMENT SIGNALS,
    use that value directly. Only estimate if absent.
    Estimation rubric: Authority=save rate >=1.0%, Mentor=save rate >=0.4%, Friend=save rate <0.4%,
  "barthesMyth": "This creator makes it feel obvious that [complete the sentence with their core cultural myth — the unspoken belief their content naturalizes for their audience]",
  "culturalCapital": "Produce" | "Relay".
    RULE: If the evidence includes a CULTURAL CAPITAL label in COMPUTED ENGAGEMENT SIGNALS,
    use Produce if the label starts with PRODUCE, Relay if it starts with RELAY.
    Estimation rubric: Produce=creates original formats/audio/ideas, Relay=participates in existing trends,
  "goffmanStageConsistency": "Consistent" | "Minor Gap" | "Significant Gap".
    RULE: If the evidence includes a TEMPORAL CONTENT ANALYSIS section, compare the tone and topic
    of RECENT vs OLDER content. Consistent=same style throughout, Minor Gap=slight tone shift,
    Significant Gap=clear difference between public persona and older/unscripted content.
    Default to Consistent if only one time period has data or no temporal data is present,
  "driftSignal": "Zero Change" | "Minor Drift" | "Significant Drift" | "Full Pivot".
    RULE: If the evidence includes a TEMPORAL CONTENT ANALYSIS section, compare the NICHE/TOPIC of
    RECENT vs OLDER content. Zero Change=same niche throughout, Minor Drift=same niche with slight
    evolution, Significant Drift=clear topic shift, Full Pivot=completely different niche.
    Default to Zero Change if only one time period has data or no temporal data is present,
  "stuartHallDecoding": "Dominant" | "Negotiated" | "Oppositional" (how does their audience decode branded content? Dominant=accepts brand message at face value, Negotiated=accepts partially with own filter, Oppositional=audience rejects or subverts brand messaging),
  "nicheTopicNode": "specific niche name — be precise and anthropologically specific (e.g. 'halal street food reviews in the diaspora' not 'food content')",
  "undergroundDensity": true | false (is this niche still alive in tight non-mainstream communities?),
  "mainstreamBleed": true | false (is this niche crossing into mass media / mainstream awareness?),
  "remixRate": true | false.
    RULE: If the evidence includes a REMIX RATE / COMMUNITY OPENNESS label in COMPUTED ENGAGEMENT SIGNALS,
    set true if the label says HIGH, false if LOW or NONE. Only estimate if absent,
  "brandSaturation": true | false.
    RULE: If the evidence includes a BRAND SATURATION label in COMPUTED ENGAGEMENT SIGNALS,
    set true if the label says HIGH or MODERATE, false if NONE. Only estimate if absent,
  "rogersAdopterStage": "Innovators" | "Early Adopters" | "Early Majority" | "Late Majority" | "Laggards" (where does this NICHE sit on the Rogers adoption curve — not the creator's follower count),
  "creatorNichePosition": "Ahead" | "Consistent" | "Behind" (where does THIS CREATOR sit relative to where the niche is heading?),
  "lifecyclePhase": "Emergence" | "Growth" | "Maturity" | "Decline" (current lifecycle phase of the niche),
  "barthesNicheMeaning": "This niche used to mean [X] — it is now starting to mean [Y]." OR "No meaning shift detected — core belief remains stable.",
  "turnerLiminalPhase": "Pre-Liminal" | "Liminal" | "Post-Liminal Reintegration" (is this niche community in identity transition?),
  "pronouns": "she/her" | "he/him" | "they/them" | "not specified".
    RULE: Infer pronouns from all available evidence in this priority order:
    1. Explicit self-identification in bio or transcripts (e.g. 'she/her in bio', 'I am a woman', 'as a guy')
    2. Self-referential language in transcripts (e.g. 'as a girl', 'as a man', 'my boyfriend/girlfriend')
    3. Display name gender signals (e.g. female-coded names like Sai, Christina, Aisha)
    4. If no signal is available, use 'not specified'.
    NEVER default to 'he/him' — if uncertain, use 'not specified'.,
  "aiSummary": "A 2-3 sentence cultural analyst summary covering: (1) this creator's symbolic position and what cultural identity they represent, (2) the nature of their audience relationship and parasocial dynamic grounded in the engagement data, (3) their brand partnership potential and any cultural risks or sensitivities. Use the correct pronouns throughout."
}

CAMPAIGN TYPE SELECTION GUIDE — choose the most accurate fit:
- Heritage/Luxury: Premium/luxury goods brands with heritage positioning (fashion houses, fine jewellery, prestige spirits, luxury hotels). NOT for local restaurants or community businesses.
- Trend-First: Brands built on cultural momentum, drops, and virality (streetwear, fast fashion, trending CPG, limited-edition launches).
- Long-Term Ambassador: Brands seeking a sustained identity partnership over 6-12+ months (fitness brands, lifestyle brands, wellness, B2B services).
- Product Launch: Brands with a specific new product or service to announce (tech product, new menu item, app launch, seasonal collection).
- Community/Local: Local or neighbourhood-rooted businesses where the goal is driving foot traffic, local awareness, and community belonging (local restaurants, neighbourhood gyms, local retailers, regional service businesses). Use this for any brand that is primarily a local/physical business.
- Awareness/Consideration: Established brands seeking broader audience reach and category education without a specific launch (financial services, insurance, healthcare, nonprofits, B2B).

Be specific and evidence-based. Every field must be populated. Output only valid JSON.
```

*(The `CAMPAIGN TYPE SELECTION GUIDE` block appears in this creator prompt verbatim even though `campaignType` is not a creator output field — [FACT], `aiExtraction.ts:173-179`; [INFERENCE] it is vestigial copy shared with the brand prompt.)*

**Evidence interpolated** — `${evidenceBlock}` is either `"\n\nREAL SCRAPED EVIDENCE (use this as ground truth):\n" + evidenceSummary` or, when research produced nothing, the fallback `"Note: No scraped evidence available. Use your knowledge of this creator if they are publicly known, but be conservative and note uncertainty."` (`aiExtraction.ts:92-94`) — **the one place the prompt explicitly licenses pretrained knowledge**. The `evidenceSummary` is built by `buildCreatorEvidenceSummary` (`webResearch.ts:1449-1656`) and contains, with these truncation limits [all FACT]:
- Header: handle, platform, displayName, bio (full), location, follower/video/likes/views/avgViews/engagementRate stats, `DETECTED CREATOR TYPE` (rule-based).
- `COMPUTED ENGAGEMENT SIGNALS` block: like/comment/save/share rates, duration, and **pre-computed labels** for parasocial bond (rubric at `:1489-1494`), audience relationship (`:1497-1501`), cultural capital (`:1504-1510`), remix (`:1513-1517`), brand saturation (`:1520-1524`), each with "use this number, do not re-derive" instructions.
- `TEMPORAL CONTENT ANALYSIS`: ≤5 videos per bucket, caption 60 chars, plays/likes/comments/saves per row.
- `DECODED CULTURAL SIGNALS` block from the symbol decoder (§2.4).
- `PRIMARY EVIDENCE — SPOKEN TRANSCRIPTS`: **≤5 transcripts, 500 chars each** (`:1472-1476`) — i.e. even a full 12-video sample feeds the extractor at most ~2 500 transcript characters.
- Secondary evidence: LLM themes, rule themes, ≤20 keywords, ≤15 hashtags, ≤20 video titles, ≤10 music signals.
- A `DATA CONFIDENCE LEVEL` line and four numbered anti-hallucination rules (`:1639-1654`), including `RULE 3: … DO NOT invent themes not supported by the evidence.`

**Output schema:** 25 required fields; 12-archetype enum, all framework enums, booleans, numbers — enforced `strict: true` (`aiExtraction.ts:190-235`). **Parsing/failure:** `JSON.parse` of `choices[0].message.content`; no content → throw; `parasocialBondStrength` clamped to [1.0, 5.0] (`:238-246`). The caller retries the whole extraction once after 1 s, then fails the analysis (`routers.ts` creator.analyze retry block). No fabricated default profile exists on this path — failure is fatal to the run. [FACT]

### 2.2 Brand profile extraction — `extractBrandProfile` (`aiExtraction.ts:299-561`)

**Purpose** `brand_profile_extraction` · temperature unset · strict json_schema `brand_profile`.

**System prompt (verbatim, `aiExtraction.ts:384-416`):**

```
You are a brand strategist and cultural analyst specializing in creator marketing.
Your task is to analyze a brand or business and produce a structured cultural profile using the Connex Cultural Match Platform framework.
You will be provided with REAL, SCRAPED evidence from the brand's public website and web presence.
You MUST base your analysis on this evidence. Do NOT contradict the evidence.
If the evidence shows a local restaurant, analyze it as a local restaurant. If the evidence shows a luxury brand, analyze it as luxury.
Be rigorous, specific, and grounded in the provided evidence. Use the exact terminology specified.

BRAND ARCHETYPE CLASSIFICATION (Chapter 3 — F.I.T. Framework):
Before selecting a brandType, you MUST first classify the brand into one of three Brand Archetypes:
- TRUST: Built on credibility, safety, and reliability. Consumer must believe before they act. Examples: medical clinics, legal firms, financial advisors, insurance, children's products. Weight signature: α=0.5, β=0.1–0.2, γ=0.3–0.4.
- COMMUNITY: Built on belonging, identity, and shared values. Consumer identifies with the brand. Examples: local gyms, boutique retail, specialty cafés, wellness coaches, pet care. Weight signature: α=0.4–0.5, β=0.2–0.3, γ=0.3.
- MOMENTUM: Built on energy, relevance, and cultural presence. Consumer wants what is exciting right now. Examples: QSR chains, streetwear, makeup/color, craft beverages, seasonal campaigns. Weight signature: α=0.2–0.4, β=0.4–0.6, γ=0.2.
The brandArchetypeClassification field MUST be consistent with the brandType you select.

When the evidence includes an AUDIENCE PERCEPTION section with Yelp and/or Google Maps reviews:
- Treat review language as the most authentic signal of how the brand is DECODED by its audience (Stuart Hall)
- Look for the symbolic meaning customers assign to the brand (e.g. 'cultural anchor', 'status symbol', 'comfort food')
- Identify any Goffman Stage Gap: does the brand's self-presentation match how customers actually experience it?
- Note emotional drivers that bring customers to this brand (belonging, nostalgia, discovery, status)
- Detect any in-group vs. out-group decoding split in the reviews
- Flag cultural risks visible in negative reviews (inconsistency, unmet expectations, service gaps)
- Let review evidence directly inform: audienceTribe, barthesMyth, emotionalPromise, culturalTension, and aiSummary
- Use the Brand Archetype classification to validate your brandType selection: if reviews show high trust-dependency, lean Trust; if reviews show community belonging, lean Community; if reviews show trend-chasing, lean Momentum.

When the evidence includes a TIKTOK CHANNEL ANALYSIS section:
- Treat TikTok data as PRIMARY EVIDENCE for brand voice, tone, and cultural positioning
- TikTok reveals how the brand ACTUALLY communicates to its audience in real-time
- Use TikTok engagement metrics (followers, engagement rate, post frequency) to validate brandArchetypeClassification
- High engagement + daily posting + playful voice = likely MOMENTUM or COMMUNITY
- Low engagement + sporadic posting + formal voice = likely TRUST or COMMUNITY
- Let TikTok evidence directly inform: brandTone (use the extracted brand voice), emotionalPromise, audienceTribe, and culturalTension
- If TikTok shows content themes, use these to refine the brand's actual positioning vs. self-presentation
- Flag any Goffman Stage Gap: does the brand's website/self-presentation match how they actually show up on TikTok?
```

**User prompt (verbatim structure, `aiExtraction.ts:422-503`):** identical framing to the creator prompt — `Analyze the following brand…${evidenceBlock}\n\nBrand: ${brandNameOrUrl}` followed by the exact JSON field specification with per-field instruction blocks for: `brandName, category, archetype` (12-Jungian enum), `emotionalPromise` ("Our audience feels [complete this sentence]…"), `visualLanguage` (exactly 3 adjectives), `audienceTribe`, `culturalTension` ("…exists in the tension between [X] and [Y]"), `barthesMyth` ("This brand normalizes the belief that…"), `brandTone`, `brandArchetypeClassification` (Trust|Community|Momentum), **`brandType`: `ONE OF EXACTLY: ${JSON.stringify(brandTypeOptions)}`** — the full 107-entry brand-type list defined at `aiExtraction.ts:304-382` is interpolated inline here (`:439`), `campaignType` (6-value enum), then nine creator-parity sociological fields each with a definition, decision rubric, and evidence pointers (`brandCulturalCapital, brandGoffmanStageConsistency, brandDriftSignal, brandStuartHallDecoding, brandRogersAdopterStage, brandTurnerLiminalPhase, brandLifecyclePhase, brandBarthesNicheMeaning, brandAudienceDecodingSplit`, `:446-491`), a Trust/Community/Momentum↔brandType consistency instruction (`:493`), the campaign-type guide (`:495-501`), and `Be specific and evidence-based. Every field must be populated. Output only valid JSON.`

**Evidence interpolated:** the brand `evidenceSummary` (`webResearch.ts:2583-2598`) = brand name, website URL, crawled website text (≤6 000 chars), ≤8 snippets, the `AUDIENCE PERCEPTION` review block (≤50 reviews, 400 chars each, `reviewResearch.ts:772-809`), plus appended `BRAND DECODED CULTURAL SIGNALS` (§2.5) and `AUDIENCE MENTION INTELLIGENCE` (§2.7) blocks (`webResearch.ts:2672-2682`); the router then appends the Track-A TikTok channel block and Instagram channel block when present (`routers.ts` brand.analyze steps 1b/1b2). Grounding line inside the evidence: `"use your knowledge of this brand/business name to supplement, but clearly ground your analysis in what the evidence shows. Do NOT invent a brand identity that contradicts the evidence."` (`webResearch.ts:2593-2595`) — [FACT] the brand path **explicitly permits pretrained-knowledge supplementation** even when evidence exists, unlike the creator path.

**Schema note:** `archetype` and `brandType` are typed `{ type: "string" }` **without** an enum in the response schema (`aiExtraction.ts:521,529`) — the 12-archetype and 107-type constraints exist only as prompt text for this call. Downstream, `brandType` is validated against `BRAND_WEIGHT_TABLE` keys with substring-matching and a fallback of `"Retail — E-Commerce / DTC Product"` (`routers.ts` P1-2 block), and `archetype` is enum-validated at DB write (`db.ts validateEnum`) and defaults to complementary (7) in scoring if unknown (`fitEngine.ts:94`). **Failure:** JSON-parse errors are retried once (1 s delay) then the analysis fails (`routers.ts` P0-3 blocks). [FACT]

### 2.3 Fit narrative — `generateFITNarrative` (`aiExtraction.ts:596-677`)

**Purpose** `fit_narrative_generation` · temperature unset · strict json_schema `fit_narrative`. **System prompt (verbatim, `:597-610`):**

```
You are a plain-talking creator marketing strategist writing a match report for a business owner or junior marketer.
Your job is to explain whether this creator and brand are a good match in clear, simple language that anyone can understand.

IMPORTANT WRITING RULES:
- Write like you are explaining this to a smart business owner who has never studied marketing theory.
- NO academic jargon. Do NOT use: archetype, Barthes myth, Barthesian, symbolic capital, liminality, Bourdieu, Goffman, Stuart Hall, parasocial, semiotics, psychographic, decoding, signifier, or any similar academic term.
- Replace "archetype" with "personality type" or "the kind of person/brand they come across as".
- Replace "myth" or "Barthes myth" with "what they stand for" or "the story they tell".
- Replace "psychographic overlap" with "shared values" or "the same kind of people".
- Replace "cultural momentum" with "trending" or "what is popular right now".
- Replace "identity stability" with "how consistent they are" or "how reliable their content is".
- Write in short, direct sentences. No filler phrases. No hedging language.
- Use the creator's stated pronouns throughout. If pronouns are 'not specified', use 'they/them'. Never assume pronouns.
- The tone should feel like honest advice from someone who knows the industry well.
```

**User prompt (verbatim, `:612-635`):** interpolates only already-computed values — handle, brand name, archetypes, CAI score/status, alignment/pulse/stability raw scores, radar warnings, both Barthes myths, audience relationship, audience tribe, weight priority, pronouns — and requests `narrativeSummary` + six `alignmentNotes` sub-fields (JSON spec quoted in code). **No scraped evidence** reaches this call; it narrates the numbers. Failure: throws; caller `fit.calculate` treats narrative failure as fatal to the request (uncaught). [FACT]

### 2.4 Creator symbol decoder — `decodeCreatorSymbols` (`symbolDecoder.ts:47-228`)

**Purpose** `creator_symbol_decoding` · temperature unset · strict json_schema `decoded_symbols`. Runs **before** creator extraction; output is injected into the extraction evidence.

**Corpus interpolated (`:57-71`):** bio (full), ≤20 video titles, ≤20 hashtags, **≤5 transcripts at 300 chars each**.

**System prompt (verbatim, `:73-96`):**

```
You are a cultural semiotician and media anthropologist. Your job is to decode the symbolic language used by social media creators — not just what they talk about, but what their words reveal about their cultural identity, social position, and relationship with their audience.

You will receive all text authored by a creator: their bio, video titles, hashtags, and spoken transcript excerpts.

Your task is to identify four types of cultural signals embedded in this language:

1. IDENTITY CLAIMS — Phrases that assert who the creator is, who they represent, or what group they belong to.
   Examples: "the only halal guy in Toronto", "first-gen", "for the girls who...", "we don't do that here", "as a Muslim"
   These map to: Archetype, NicheTopicNode

2. STATUS SIGNALS — Phrases that position the creator as a taste authority, cultural gatekeeper, or insider.
   Examples: "you've never had shawarma until you've had this", "before it blows up", "the ones who know", "trust me on this one", "I found it first"
   These map to: CulturalCapital, RogersAdoptionStage, CreatorNichePosition

3. COMMUNITY REFERENCES — In-group language, shared assumptions, and parasocial address patterns that reveal the nature of the creator-audience bond.
   Examples: "you already know", "for us", "we get it", "I see you", "this one's for my people", "you deserve this"
   These map to: ParasocialBondStrength, AudienceRelationshipType, StuartHallDecoding

4. ASPIRATION DRIVERS — Phrases that promise the audience a feeling, transformation, or identity upgrade.
   Examples: "finally", "this changes everything", "the life you actually want", "you deserve better", "this is the one"
   These map to: BarthesMyth, StuartHallDecoding, AudienceRelationshipType

Be specific. Quote the actual phrase. Explain the cultural meaning. Be anthropologically precise.
If a signal category has no examples in the text, return an empty array — do not invent signals.
```

**User prompt (verbatim, `:98-126`):** `Decode the following creator's language…` + corpus + the exact output JSON spec (four arrays of `{phrase, meaning, informs}`, 0–6 items each, plus `symbolicSummary`) + rules ending `Only include signals that are genuinely present in the text — do not invent examples … The symbolicSummary must be specific and anthropologically grounded, not generic`.

**Failure:** any error → `return null`, pipeline continues without decoded signals (`:224-227`) — non-fatal, silent degradation of evidence quality. The formatted block injected into extraction ends with a mandatory-use instruction (`⚠️ INSTRUCTION: The decoded signals above are pre-analyzed cultural evidence. You MUST use them to inform the following fields: …`, `:258-266`). [FACT]

### 2.5 Brand symbol decoder — `decodeBrandSymbols` (`brandSymbolDecoder.ts:68-268`)

**Purpose** `brand_symbol_decoding` · temperature unset · strict json_schema `brand_decoded_symbols`. Corpus: website text **≤3 000 chars**, review text **≤2 000 chars**, metadata keywords, TikTok mention keywords + sentiment (`:86-110`); skipped entirely when combined text < 80 chars (`webResearch.ts:2636,2666`). System prompt (verbatim in code at `:112-153`) mirrors the creator decoder with five categories (adding `AUDIENCE LANGUAGE — … the Stuart Hall decoding layer`) plus flat extractions: `rawKeywords` (10–30), `themeLabels` (3–5), `symbolicVocabulary` (5–15), `symbolicSummary`; each signal is source-tagged `"brand"` or `"audience"`. User prompt (`:155-191`) gives the exact JSON spec and rules (`Only include signals genuinely present in the text — do not invent examples`). Failure → `null`, non-fatal (`:264-267`). [FACT]

### 2.6 Content-theme translation — `translateKeywordsToThemes` (`webResearch.ts:213-280`)

**Purpose** `content_theme_extraction` · strict json_schema `content_themes` (`{themes: string[]}`). Prompt (verbatim, `:229-243`):

```
You are a content analyst. Given the following data from a social media creator, identify 3–5 specific named content themes that best describe what this creator makes.

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

Example output: ["Halal Street Food Reviews", "Toronto Local Culture", "Family & Parenting", "Muslim Identity Content"]
```

(`transcriptSnippet` = 400 chars of combined transcript.) System message: `"You are a content analyst. Output only valid JSON arrays."` Failure → rule-based `inferContentThemes` fallback (`:279`), ultimate default `["General Content Creator"]`. [FACT]

### 2.7 Brand mention analysis — `fetchBrandMentionData` (`brandTikTokAnalysis.ts:306-418`)

**Purpose** `brand_mention_analysis` · strict json_schema. Runs only when ≥3 mention captions exist. Prompt (verbatim in code, `:312-364`): `You are a cultural anthropologist analyzing how audiences talk about the brand "${brandName}" on TikTok.` + ≤20 captions, ≤15 hashtags, ≤10 music titles, engagement context, then seven numbered extractions (sentiment with a conservative rule — `casual/neutral language is "mixed", not negative; Only classify as "negative" if there are clear complaints`; confidence thresholds 15+/5–14/<5 signals; identity claims; status signals; community refs; aspiration drivers; tone; 2–3-sentence summary) and the exact JSON spec. Failure → sentiment stays `insufficient_data`, arrays empty, pipeline continues (`:415-417`). [FACT]

### 2.8 Brand TikTok channel voice — `analyzeBrandTikTokChannel` (`brandTikTokAnalysis.ts:585-720`)

**Purpose** `brand_channel_analysis` · strict json_schema. Prompt (verbatim, `:585-618`): `Analyze this brand's TikTok channel to extract cultural and voice signals.` + handle, bio, ≤10 owned captions (which may include `[TRANSCRIPT] …500 chars` entries), then 11 numbered extractions (brand voice, themes, interaction style, summary, four signal categories as `{phrase, meaning}` pairs, rawKeywords 15–20, themeLabels 3–5, symbolicVocabulary 5–8) and the JSON spec. **No anti-invention rule is present in this prompt.** Failure → all channel-voice fields undefined, non-fatal (`:718-720`). [FACT]

### 2.9 Brand Instagram voice — `analyzeBrandInstagramChannel` (`brandInstagramAnalysis.ts:161-298`)

**Purpose** `brand_instagram_voice_analysis`. Prompt (verbatim, `:161-194`) is the Instagram twin of §2.8, gated on ≥2 captions or a bio; same schema; same non-fatal failure. [FACT]

### 2.10 Myth/tribe alignment scoring — `fit.calculate` (`routers.ts:1673`, prompt `:1678-1705`)

**Purpose** `myth_tension_analysis` · strict json_schema `myth_trib_scores` (`{mythAlignmentScore: number, tribMatchScore: number}`). **This is the only LLM call whose output is a direct numeric scoring input.** System prompt (verbatim):

```
You are a cultural semiotics analyst scoring the mythological alignment between a creator and a brand for an influencer marketing platform.

Creator Barthes Myth: "${creator.barthesMyth}"
Creator Tone Register: "${creator.toneRegister ?? "not specified"}"
Creator Audience Relationship: "${creator.audienceRelationshipType ?? ""}"
Creator Cultural Capital: "${creator.culturalCapital ?? ""}"
Creator Stuart Hall Decoding: "${creator.stuartHallDecoding ?? "Dominant"}"

Brand Barthes Myth: "${brand.barthesMyth}"
Brand Tone Register: "${(brand as Record<string, unknown>).brandTone ?? "not specified"}"
Brand Audience Tribe: "${brand.audienceTribe ?? ""}"
Brand Cultural Tension: "${brand.culturalTension ?? ""}"
Brand Archetype Classification: "${brand.brandArchetypeClassification ?? ""}"

${semanticContext}

SCORING RULES:
- If creator tone is anti-establishment, rebellious, or oppositional AND brand is institutional, corporate, or formal: mythAlignmentScore should be 1-3 (severe mismatch)
- If creator and brand share the same symbolic territory (both community-driven, both aspirational, both playful): mythAlignmentScore should be 7-10
- If creator's Stuart Hall Decoding is Oppositional: apply a -2 penalty to mythAlignmentScore
- tribMatchScore measures whether the creator's actual audience would authentically receive this brand — not just whether the brand wants that audience
- Use semantic keyword overlap as an additional signal: shared keywords between creator and brand vocabulary suggest stronger tribe match
- Consider brand audience mentions (TikTok): if audiences are talking about the brand in positive terms, boost tribMatchScore
- Score 1: mythAlignmentScore (0–10) — How closely do the creator's and brand's mythological narratives and tones align? Same symbolic territory = 10, completely opposed = 1.
- Score 2: tribMatchScore (0–10) — How well does the creator's audience relationship type match the brand's target tribe? Perfect match = 10, mismatch = 1.

Return ONLY valid JSON: {"mythAlignmentScore": <number>, "tribMatchScore": <number>}
```

(`semanticContext` = ≤10 creator keywords, ≤10 creator vocab terms, ≤10 brand keywords, ≤10 brand vocab terms, ≤10 mention hashtags, `routers.ts:1665-1671`.) User message: `"Score the alignment."`

**Parsing & fallbacks [FACT, scoring-critical]:** `mythAlignmentScore = Math.min(10, Math.max(0, Number(parsed.mythAlignmentScore) || 3))` (`routers.ts:1727-1728`) — note the `|| 3`: a returned `0` or NaN silently becomes **3**. On LLM failure both scores become null and the engine receives the **3.0 fallback** (`routers.ts:1779-1780`); since Session 5 this is marked in `scoreDegradation` (`:1735`) and a radar warning is injected, but the numeric behavior is unchanged (frozen). The call is **skipped entirely** when either side lacks `barthesMyth` — also 3.0 fallback, also flagged (`:1738`).

### 2.11 Synergy narrative + content directions — `fit.calculate` (`routers.ts:1837`, prompt `:1842-1887`)

**Purpose** `cultural_synergy_analysis` · strict json_schema `synergy_brief`. System prompt (verbatim in code): plain-talk strategist persona with the same jargon-ban list as §2.3, then `CREATOR PROFILE` (handle, archetype, myth, audience relationship, cultural capital, themes, ≤15 keywords, decoded-symbols JSON sliced to 400 chars), `BRAND PROFILE` (equivalent fields), `SHARED SIGNALS` (shared keywords/themes, overlap score), `SCORES` (CAI, PARR, A/P/S), and the request for `synergyNarrative` (120–200 words answering three set questions) + 3 `contentDirections` (`title` ≤6 words, `rationale`, `exampleAngle`). Failure → empty narrative/directions, non-fatal (`:1893-1595` catch). [FACT]

### 2.12 Cultural borrowing summary — `fit.calculate` (`routers.ts:1950`, prompt `:1955-1982`)

**Purpose** `cultural_borrowing_analysis` · **no response_format — free text** (the only unstructured chat call). Verbatim prompt: plain-talking cultural strategist writing 2–3 sentences on what the brand culturally *borrows* from the creator, interpolating archetypes, tone, parasocial bond, myths, follower count, sentiment, shared keywords, music overlap; `Write ONLY the 2-3 sentence paragraph. No headers. No lists. No quotes.` User message `"Write the cultural borrowing summary."` Failure → null, non-fatal. [FACT]

### 2.13 Transcription prompts

- Whisper: `"Transcribe the user's voice to text"` (+ language variant) (`voiceTranscription.ts:165-169`).
- Gemini audio: `"Transcribe ALL spoken words in this audio precisely. Output ONLY the raw transcript text with no labels, timestamps, or formatting. If there are no spoken words, respond with exactly: [NO_SPEECH]"` (`:376`). `[NO_SPEECH]` or <5 chars → treated as failure (`:404-406`); markdown stripped (`:409-413`). [FACT]

**Labeling bug [FACT]:** supplemental-video ingestion stores `transcriptSource: "whisper"` (`routers.ts:1113`) although `fetchSingleTikTokTranscript` only ever produces caption/WEBVTT transcripts (`webResearch.ts:2866-2868` — "Whisper is not used here") — the stored provenance label misstates the method.

---

## 3. HALLUCINATION SURFACE

Scope: LLM-produced fields that feed scoring (directly or via stored profile → `fit.calculate`). Assessment method: what evidence constrains the field (§2), whether the transport schema enforces the value set, and what happens on thin evidence.

### 3.1 Classification of scoring-relevant LLM outputs

**(a) Enum-constrained AND schema-enforced (cannot be out-of-vocabulary; CAN still be evidence-free):**
`archetype` (creator), `stuartHallDecoding`, `goffmanStageConsistency`, `driftSignal`, `rogersAdopterStage`, `turnerLiminalPhase`, `creatorNichePosition`, `culturalCapital`, `audienceRelationshipType`, `lifecyclePhase`, `pronouns` (creator schema, `aiExtraction.ts:199-222`); all nine brand-side sociological enums + `brandArchetypeClassification`, `campaignType` (brand schema, `:528-540`); mention `sentiment`/`sentimentConfidence` (`brandTikTokAnalysis.ts:383-384`). A second validation layer (`db.ts validateEnum`, `:132-143`) nulls anything invalid at write time. **The schema guarantees a legal value — it does not guarantee a grounded one.** On thin evidence the model must still emit one of the allowed values, and the engine maps unknown/null to neutral defaults (§4), so the stored value always *looks* like a real classification.

**(b) Free-text fields that feed scoring:** `barthesMyth` (both sides — the *input* to the myth/tribe scoring call §2.10), `toneRegister`, `audienceTribe`, `culturalTension`, `brandTone`, `nicheTopicNode`, `recurringThemes`, decoded-signal phrases/meanings, `rawKeywords`/`themeLabels`/`symbolicVocabulary` (brand decoder — these feed symbolic-overlap and the semantic context of §2.10). Unbounded; no validation beyond being strings. A confidently-worded myth sentence generated from 4 video titles is indistinguishable, structurally, from one grounded in 12 transcripts.

**(c) Numeric judgments:** `parasocialBondStrength` (clamped 1–5, otherwise unvalidated), `mythAlignmentScore` and `tribMatchScore` (clamped 0–10; `|| 3` coercion of 0/NaN, §2.10). `mythAlignmentScore`/`tribMatchScore` are the highest-leverage numeric LLM outputs in the system: they are 2 of the 3 inputs averaged into Alignment (§4.1), and Alignment carries α = 0.4–0.6 of the final score.

### 3.2 Field-by-field constraint assessment (scoring-relevant)

| Field | Evidence that constrains it | Could a plausible value emerge with ~no evidence? | Validation |
|---|---|---|---|
| creator `archetype` | transcripts/titles + 12-rule priority list + decoded identity claims | **Yes** — with 0 transcripts and few titles the rules still force a pick; prompt demands every field populated | schema enum + DB enum |
| `goffmanStageConsistency`, `driftSignal` | TEMPORAL CONTENT ANALYSIS block | Prompt mandates the *favourable* defaults ("Consistent"/"Zero Change") when temporal data is missing (`aiExtraction.ts:141,146-147`) — [FACT] a single-bucket creator is structurally scored as maximally stable (Goffman 10, Drift 9.5 → Stability raw 9.75 before blending, §4.3). [INFERENCE] This is the single largest thin-data score inflator. | schema enum |
| `stuartHallDecoding` | decoded community/aspiration signals; no computed signal exists | **Yes** — pure judgment; ±0.5/−1.0 alignment modifier and 0–10 PARR signal (weight .25) | schema enum |
| `rogersAdopterStage`, `turnerLiminalPhase`, `creatorNichePosition`, `lifecyclePhase` | "niche"-level judgments; no computed input in evidence | **Yes** — these are opinions about a *niche* the model itself named; Rogers+Turner are the whole Pulse base (§4.2) | schema enum |
| `parasocialBondStrength`, `audienceRelationshipType`, `culturalCapital`, `remixRate`, `brandSaturation` | **Strongly constrained** when COMPUTED ENGAGEMENT SIGNALS block exists — prompt orders verbatim reuse of computed labels | Only when the engagement block is absent (no videos collected) does the model estimate freely | number-clamp / schema enum; note none of these five feed CAI directly (bond/relationship/saturation feed performance signals & display) |
| `barthesMyth` (both) | transcripts/decoded aspiration drivers (creator); website/review text (brand) | **Yes** — a myth sentence is generable from a brand name alone; brand prompt explicitly licenses pretrained knowledge (§2.2) | none (free text) |
| `mythAlignmentScore`, `tribMatchScore` | Two myth sentences + tone/tribe strings + ≤50 keyword terms — i.e. **LLM output scored by another LLM call**; no raw evidence reaches this prompt | **Yes** — and when it fails or myths are missing, a fabricated-looking 3.0 default enters the engine (flagged in `scoreDegradation` since Session 5, but numerically identical) | clamp 0–10; `|| 3` coercion |
| brand `archetype`, `brandType` | prompt-only constraint — **no schema enum** (§2.2) | Out-of-list `brandType` happens in practice (the P1-2 fallback exists because of it); fallback silently substitutes a weight profile | router substring-match + fallback; DB enum for archetype |
| brand sociological 9-pack | website copy + reviews + mentions; several (Rogers, Turner, lifecycle, drift) are market-history judgments the evidence rarely contains | **Yes** — [INFERENCE] these are the least evidence-anchored inputs in the system, and Pulse/Stability blending gives them 40–50 % of those sub-scores when present (§4.2–4.3) | schema enum |
| mention `sentiment` | ≥3 audience captions required; conservative-classification rule; confidence tier gates the penalty multiplier | Partially — small caption sets yield low confidence, which scales the stability modifier to ±0.3× | schema enum |

### 3.3 Where a low-evidence run still yields a confident-looking result

[FACT-grounded synthesis] The pipeline's floor guards (TikTok: ≥2 real transcripts OR ≥4 titles; brand: the four-way P0-1 guard) block *empty* runs, but a run at the floor — e.g. 0 transcripts + 4 video titles, or a brand with 120 words of website text — still produces: a full 25-field creator profile with every enum populated (schema demands it), "Consistent/Zero Change" stability by prompt default, a myth sentence, a niche name, and downstream a CAI score with two decimal places. The only honest markers of thinness that survive to scoring are `dataConfidenceLevel` (stored, displayed, and passed through the engine **without affecting any number** — `fitEngine.ts:1013,1043` merely echoes it) and, post-Session-5/6, `persistence_status` + run diagnostics. **Nothing in the scoring path discounts a score for thin evidence.** [FACT: no code path scales A/P/S or CAI by confidence.]

Prompt-level anti-hallucination language exists and is quoted in §2 (creator RULE 1–4 block, decoder "do not invent signals", brand "Do NOT contradict the evidence") — but three prompts have **no** anti-invention rule at all (brand channel §2.8, Instagram voice §2.9, mention analysis §2.7 relies only on the conservative-sentiment rule), and two prompts explicitly *invite* pretrained knowledge (creator no-evidence fallback §2.1; brand supplementation line §2.2).

---

## 4. SCORING CONSUMPTION (explanation only — `fitEngine.ts` is FROZEN)

Entry: `fit.calculate` (`routers.ts`) loads both profiles from the DB, runs the myth/tribe LLM call (§2.10), then calls `runFullFITCalculation` (`fitEngine.ts:813-1049`). Router-side defaulting before the engine sees anything (`routers.ts:1769-1782`): creator archetype → `"The Everyman"`, Goffman → `"Consistent"`, drift → `"Zero Change"`, Hall → `"Dominant"`, Rogers → `"Early Majority"`, Turner → `"Pre-Liminal"`, niche position → `"Consistent"`, brand archetype → `"The Everyman"`, brandType → `"Retail — Local Boutique"`, myth/trib → `3.0`. [FACT]

### 4.1 Alignment (A)

- `archetypeMatchScore` from the 12×12 compatibility matrix (`fitEngine.ts:28-99`): same or "pairsWith" = **10**; "clashesWith" = **2.5**; else **7**; unknown brand archetype = 7.
- Effective Stuart Hall = bilateral blend of creator + brand decodings (`blendDecodingSignals`, `:709-715`): both Dominant → Dominant; either Oppositional → Oppositional; else Negotiated.
- `A_raw = clamp₀₁₀( (archetypeMatch + mythAlignment + tribMatch)/3 + decodingModifier )` where modifier = Dominant **+0.5**, Negotiated **0**, Oppositional **−1.0** (`:382-386, 405-413`).
- **Mention vocabulary boost:** overlap ratio between creator keywords/themes and audience mention hashtags/keywords × 5, capped **+1.5**, added to A (`:916-931`).

### 4.2 Pulse (P)

- Creator side: Rogers base (Innovators 5, Early Adopters 6, **Early Majority 7**, Late Majority 4, Laggards 2; unknown 5) + liminal adjustment (Pre-Liminal 0, Liminal +0.5, Post-Liminal +0.5) (`:355-361, 390-394, 423-441`).
- Brand-TikTok boosts (applied on the creator-side calculation): engagementRate/10 capped **+1.5**, post-frequency **+0.5** (daily) / **+0.3** (3-5x/week) (`:433-438`).
- If brand Rogers+Turner exist: `P = 0.6·creatorPulse + 0.4·brandPulse` (`:856-864`).

### 4.3 Stability (S)

- `(goffman + drift)/2` with Goffman Consistent 10 / Minor Gap 5 / Significant Gap 0 and Drift Zero Change 9.5 / Minor 7 / Significant 3 / Full Pivot 0 (`:365-378, 451-471`).
- Brand-TikTok boosts: follower log-boost `min(1.5, log10(followers)/6)` + engagement/20 capped **+0.5** (`:461-467`).
- If brand Goffman+Drift exist: `S = 0.5·creator + 0.5·brand` (`:877-885`).
- **Mention sentiment modifier:** negative **−3**, mixed **−1**, positive **+0.5**, each × confidence multiplier (high 1.0 / medium 0.6 / low 0.3), clamped 0–10 (`:897-912`).

### 4.4 Final score, weights, campaign modifiers

- `CAI = α·A + β·P + γ·S`, rounded to 2 dp; **≥7.5 Green Light, ≥6.0 Proceed with Caution, else Do Not Proceed**; and if `A < 6.0` a Green Light is demoted to Proceed with Caution (`:480-503`).
- α/β/γ come from `BRAND_WEIGHT_TABLE[brandType]` (107 entries, `:169-310`; e.g. Medical 0.6/0.2/0.2, most Community rows 0.5/0.3/0.2, Consumer Electronics 0.3/0.5/0.2), default `0.5/0.2/0.3` (`:312`).
- Campaign modifiers (`applyBrandCampaignModifier`, `:320-343`): Long-Term Ambassador β−0.1 (floor 0.1), γ+0.1 (cap 0.8); Product Launch β+0.1, γ−0.1; then renormalized to sum 1.0 with one-decimal rounding (γ takes the remainder). Heritage/Luxury and Trend-First apply **no** modifier (`:347-349`).
- **[FACT] Inside `runFullFITCalculation` the weights are re-derived as `getBrandWeights(input.brandType)` with NO campaignType argument (`:814`)** — the campaign-modified weights computed in the router (`getBrandWeights(brandType, campaignType)`, used for persistence/display) are *not* the weights the engine multiplies by. [INFERENCE] Campaign modifiers therefore affect stored/displayed weights but not the actual CAI arithmetic.
- The final returned score is the **adjusted** recalculation after the mention modifiers (`:934-939, 1031-1032`).

### 4.5 PARR, QoV, and known issues J-1 / J-2 in situ

- **PARR** (`calculatePARR`, `:653-695`): weighted sum ×10 of tribeOverlap (`tribMatchScore`, **0.30**), decodingAcceptance (creator-side Hall mapped 10/5/0, **0.25**), archetypeResonance (**0.20**), symbolicVocabularyOverlap (**0.15**), personaConsistency (creator Goffman 10/5/1, **0.10**); labels ≥80/≥60/≥40. Uses the **creator's raw** Hall/Goffman, not the bilateral blends, and the **pre-boost** trib score. Symbolic overlap = Jaccard of normalized creator vs brand keyword+theme sets, ×33.3 capped 10 (`:588-624`).
- **QoV** = `(caiScore/10) × (parrScore/100) × 100` (1 dp) — **computed from the PRE-adjustment `caiScore`** variable (`:993-994`), while the function returns `adjustedCaiScore` as the headline score (`:1031`). **This is J-2** (`fitEngine.golden.test.ts:14-16, 285-288`): whenever mention modifiers move the final score, QoV diverges from `returnedCAI×PARR`.
- **`alignmentNarrative`** (rule-based, `:996-1009`): `archetypeMatch = archetypeMatchScore >= 80 ? "strong" : >= 60 ? "moderate" : "weak"` — but `archetypeMatchScore` is on a **0–10** scale, so the comparison is against the wrong scale and the narrative *always* says "weak archetype alignment", even for a perfect 10. **This is J-1** (`fitEngine.golden.test.ts:10-12, 278-283`). Both are flagged for Jason; do not fix.
- **Radar warnings** (`:534-580`): Low Alignment (A<6), Archetype Tension (clash list), Identity Instability (Full Pivot or Significant Gap), Low Pulse (P<4), Trajectory Divergence (niche position "Behind"), Low Social Engagement (brand TikTok ER<0.5 %), Negative Audience Sentiment (negative + non-low confidence).
- **Five performance signals** (`performanceSignals.ts`) are computed alongside (0–100 each, with Verified/Estimated/Insufficient confidence) from stored profile fields and persist to `match_scores` — they are report metrics, not CAI inputs. [FACT]

Persistence: all sub-scores, weights, PARR breakdown, music overlap, and modifiers are written to `match_scores` (+ narratives/warnings/overlaps/directions child tables) in `fit.calculate`; a persist failure there is caught and non-fatal (the match is returned but unsaved).

---

## 5. RE-ENTRY POINT ANALYSIS (feasibility, not a build plan)

Two candidate re-entry points for re-running **without re-scraping**:

### 5.1 Re-run extraction from stored scraped evidence

**Is the raw LLM input persisted? No — not as such.** [FACT] `evidenceSummary` (the exact text sent to `extractCreatorProfile`/`extractBrandProfile`) is built in memory (`webResearch.ts:1824, 2583`) and never written anywhere: no column stores it (`drizzle/schema.ts` — no evidence field; `semantic_documents` would fit but has **no writer and 0 rows**), and `persistCreatorToV2`'s inputs drop it (`routers.ts` persist params carry `researchData`, not the summary). The same is true of the raw HTML/JSON scrape payloads (`scrape_events` stores sizes and statuses, never bodies).

**However, most of the evidence's *structured inputs* ARE persisted (creator path), so the summary is largely RECONSTRUCTABLE:**

| Evidence-summary component | Persisted? | Where |
|---|---|---|
| Transcripts (full text, per video, with source + word count) | ✅ | `content_items.transcript_text/…` |
| Video captions, createTime, views/likes/comments/shares/saves, duration, status | ✅ | `content_items` |
| Bio, follower/following counts, engagement rate, transcript count, confidence | ✅ | `observations` |
| Keywords / LLM themes / hashtags / recurring themes (ranked) | ✅ | `signal_values` (domains keyword/content_theme/hashtag/theme) |
| Decoded symbols (category/phrase/meaning/informs) + symbolic summary | ✅ | `decoded_signals` + `creator_observations.symbolic_summary` |
| Stats: totalLikes/videoCount/totalViews/avgViews/region | ✅ | `creator_observations` |
| Engagement-rate blocks (comment/save/share/like rates, temporal buckets) | ♻️ recomputable from `content_items` rows (per-video counts + createTime are stored) | — |
| Music titles/artists per video (creator run) | ⚠️ **partially lost** — the creator pool maps `musicTitle: ""`/`musicArtist: ""` before persistence (`webResearch.ts:1155-1156`); `isOriginalAudio` survives | `content_items` |
| duet/stitch enablement, `isAd` flags (→ remix rate, brand saturation labels) | ❌ **not persisted** — no columns exist | — |
| `longitudinalSampleJson` (6-3-3 bucket assignment) | ❌ dropped in persist (threaded into `researchData` but never written; `temporal_bucket` column exists on `content_items` but the creator persist path never sets it — [FACT] `routers.ts` contentRows omit it) | — |
| Rule-based `contentThemes`, `detectCreatorType` label | ♻️ recomputable (pure functions of stored text) | — |

**Verdict [INFERENCE]:** creator-side extraction re-run from storage is **feasible with high fidelity** — a reconstruction function could rebuild ~all of the evidence summary from `observations + creator_observations + content_items + signal_values + decoded_signals`, with three true gaps (music metadata, remix/ad flags, bucket labels) that affect only the CULTURAL CAPITAL/REMIX/BRAND SATURATION computed labels and temporal bucketing; those labels' *outputs* (culturalCapital, remixRate, brandSaturation) are stored on `creator_observations` and could be echoed instead. Note also that re-runs of 11/12 calls are non-deterministic (§0 temperatures).

**Brand path is materially worse:** the crawled website text (`description`/`allText`) is **discarded** — only review excerpts (`brand_observations.google/yelp_review_excerpts`), decoded-signal rows, signal_values, mention rows (`audience_mentions`, mention content items), and aggregates survive. The largest single evidence block for brand extraction (≤6 000 chars of site copy + snippets) cannot be reconstructed without re-crawling. [FACT: no column stores it; `semantic_word_count`/`crawled_pages_count` store only counts.] Channel-analysis metadata (`postFrequency`, `brandVoice`, temporal buckets, `avgWeightedEngagement`) is likewise unpersisted (`getBrandProfileById` returns `tiktokMetadata: null`, `db.ts`), which already degrades *re-scoring* (next section).

### 5.2 Re-run scoring from stored extracted fields

**Already effectively implemented.** [FACT] `fit.calculate` reads both profiles exclusively from the DB (`getCreatorProfileById`/`getBrandProfileById`) — it performs no scraping. Re-running a match is therefore a pure function of stored data **plus one LLM call** (myth/tribe, §2.10) and three narrative LLM calls.

What exists vs. what's missing for a faithful re-score:

- **Exists:** every engine input listed in §4 that comes from profile fields — archetypes, the nine framework enums per side, keywords/themes/vocab (via `signal_values`), mention aggregates + sentiment/confidence, brand TikTok follower/ER (`brand_observations.tiktok_*`), review ratings, music signals via `signal_values` music domains, weights (re-derivable from stored `brandType`).
- **Missing/degraded:** `brandTiktokPostFrequency` (never persisted → the +0.5/+0.3 pulse boost can never fire on a from-DB run — [FACT] `brand.tiktokMetadata` is hardcoded null in the read model, so `postFrequency` is always undefined at `routers.ts:1786`); creator music titles for music-overlap (read from `creator.transcripts[].musicMetadata`, which the flattened profile doesn't carry → creator side of music overlap is always empty on a from-DB run — [FACT] `routers.ts:1746-1750` reads `(creator).transcripts`, a field `getCreatorProfileById` does not return under that shape); the myth/tribe call's non-determinism (unset temperature) makes re-scores non-reproducible even on identical stored inputs.
- **Deterministic core:** everything in `fitEngine.ts` itself is pure and re-runnable bit-identically given the same inputs (the golden suite proves this, `fitEngine.golden.test.ts`). [FACT]

**Summary [INFERENCE]:** the natural re-entry seam is exactly the existing persistence boundary — (1) an *extraction re-run* needs an evidence-reconstruction step (creator: high fidelity today; brand: requires persisting crawl text first, or accepting re-crawl), and (2) a *scoring re-run* needs nothing new structurally, but to be *faithful* it needs the myth/tribe call pinned (temperature/seed or cached result — the raw scores are already stored on `match_scores.myth_alignment_score/trib_match_score`) and the two known from-DB degradations above acknowledged. Storing `evidenceSummary` (and brand crawl text) at analysis time — e.g. in the currently-empty `semantic_documents` table, which was designed for exactly this shape — would close the loop for byte-identical extraction replay. That is a design option, not a change made here.

---

## Could not determine / out of scope

- **Effective server-side default temperature** for `gemini-2.5-flash` when the payload omits it — external to the codebase; treated as "unset" throughout.
- Whether Google's OpenAI-compat layer enforces `strict: true` json_schema identically to OpenAI (transport behavior not observable from code); the code *requests* strict enforcement and additionally re-parses with `JSON.parse`.
- Precise Playwright-vs-HTTP path frequencies in production (which fallback fires how often) — `scrape_events` cannot answer this because of the §1.10 coverage gap; only 7 method labels have ever been recorded.
- `test_scraper_verification.ts` references a `whisperFallbackTriggered` flag — a standalone test script, not wired into the pipeline; not inventoried.
