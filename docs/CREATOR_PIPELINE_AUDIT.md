# CREATOR PIPELINE — DEEP AUDIT

**Scope:** the creator analysis pipeline, submit → stored result, at implementation depth.
**Commit:** `cf312c4` (HEAD). Reflects Session 7 (scrape telemetry, evidence snapshots, music metadata, duplicate preflight) and the Session 6 review gate / run-id work.
**Method:** static read of source + read-only schema introspection (`server/integration/schema.sql`, `drizzle/schema.ts`). No code was run, no scraping, no LLM calls, no DB writes.
**Relationship to `docs/PIPELINE_REFERENCE.md`:** this supersedes that document's *creator* sections. Where the two disagree, this is authoritative for the creator path at HEAD; PIPELINE_REFERENCE predates the Session-7 changes and covers creator + brand at survey depth.

**Convention:** every claim is tagged **[F]** (FACT — directly in code/schema, cited `file:line`) or **[I]** (INFERENCE — reasoning from the code, live behavior not observable statically). "Could not determine" items are flagged explicitly.

**Governance tags on defects:** **OURS** = plumbing/engineering (our code); **JASON'S** = science/model design (frameworks, thresholds, prompt design). Known science items are referenced as J-N where identifiable.

---

## SESSION 8 — ADDRESSED (update; the diagnosis below is preserved as originally written, pre-fix)

Everything below this section is the **pre-fix** diagnosis at `cf312c4`. Session 8 landed the following correctness fixes on `main` (fitEngine/scoring untouched; the caption-vs-transcript *evidence* rule is Jason's and was left exactly as-is):

| Prioritized finding | What shipped | Commit |
|---|---|---|
| **#7** — scrape telemetry corrupt (§3.1) | `logScrapeSuccess` now evaluates the real response body; **253** historical false-positive rows corrected via migration **`womo_0008`** (the 14 sub-5000-byte rows are intentionally left flagged — bodies were never stored) | `a2d5991` + womo_0008 |
| **#4** — reanalyze fabricates on scrape failure (§1.4, C1.1) | `reanalyze` fails cleanly (no observation, nothing persisted); `analyze`/`bulkAnalyze` guarded too; the "use your knowledge" prompt branch remains only for the (now-unreachable-with-empty-evidence) snapshot path | `e4e422f` |
| **#2** — confidence over-stated (§6.4, C1.3) | transcript counter now counts only `content_items` rows actually updated (`.returning()`); confidence on new analyses drops to honest values. The caption-counts-as-evidence question is **unchanged** (Jason's) | `5cbbd2b` |
| **#1** — 6-3-3 sample not persisted (§7.6, C4) | `content_items.temporal_bucket` written + verbatim sample stored as `semantic_documents` `creator_longitudinal_sample` (womo_0007 mechanism, no DDL) | `a071b4e` |
| **#3** — IG/YouTube sociological fields unmarked (§6.2, C1.4) | provenance marker `persistence_status._meta.sociologicalFieldsProvenance` (`computed`/`estimated`), surfaced in `creator.getDiagnostics`; **values unchanged** | `c6fade9` |

**Still OUTSTANDING (not touched in Session 8):** **#5** (TikTok video collection is a single fragile Playwright-XHR strategy), **#6** (Instagram transcription is one vendor-shape from zero; the `fetchReelVideoUrl` fallback is dead code), the remaining §C4 data-loss items (`following_count` dropped on read-back, `content_items.region` unwritten), the three incompatible engagement-rate formulas (§6.1), and the free-text mythology hallucination surface (§5.3 / #12). Non-determinism in the two default-temperature LLM calls (§C6 / #10) is unchanged.

> Numbering note: findings are cited by their number in the **Prioritized Findings** list at the end. The sociological-fields item is **#3** (shipped as Commit 5).

---

## TABLE OF CONTENTS

1. Stage 1 — Entry (preflight → analyze; auth, rate limiting, run-id, duplicate gate; rerun/bulk/ingest variants)
2. Stage 2 — Platform routing (`researchCreator`, the "Multi" merge, reachability)
3. Stage 3 — Scraping (TikTok, Instagram, YouTube): strategies, fallbacks, fields, blocking, timing, browser lifecycle, scrape_events
4. Stage 4 — Video selection & transcription (pool discovery, 6-3-3 + fill-forward, Whisper vs Gemini, caption paths, "no transcript" cases)
5. Stage 5 — LLM calls (verbatim prompts, schemas, parsing, failure behavior)
6. Stage 6 — Derived fields (engagement, cultural velocity, confidence, tier, sociological signals)
7. Stage 7 — Persistence (atomic core, enrichments, persistence_status, evidence snapshot, table/column map, not-persisted)
8. Stage 8 — Read-back (`getCreatorProfileById`: dropped / transformed / reshaped)
9. Critical assessment (silent degradation, defaults, fragility ranking, data loss, ordering, non-determinism, defects)
10. Prioritized findings

---

## STAGE 1 — ENTRY

### 1.0 The one run we trace
An analyst opens **Analyze Creator**, types a handle or URL, picks a platform (**TikTok** or **Instagram** only), and submits. The client runs a duplicate pre-flight, then calls `creator.analyze`. Everything below inherits one `runId`.

### 1.1 Client submit and pre-flight
- `client/src/pages/AnalyzeCreator.tsx:23` **[F]** — form schema `platform: z.enum(["TikTok", "Instagram"])`. **YouTube and Multi are not selectable in the UI.**
- On submit, `startAnalysis(values, confirmDuplicate=false)` (`AnalyzeCreator.tsx:143`) is preceded by a pre-flight fetch (`:171`): `utils.creator.preflight.fetch({ handleOrUrl, platform })`. If `pre.existing` is truthy it opens a duplicate-warning dialog (`:175-176`) offering **Open existing profile** or **Analyze anyway** → `startAnalysis(values, true)` (`:237`). Otherwise it proceeds directly (`:183`). **[F]**
- `analyzeMutation.mutate({ ...values, confirmDuplicate })` (`:163`). **[F]**

### 1.2 `creator.preflight` (read-only)
`server/routers.ts:786-794` **[F]** — `protectedProcedure` (auth only, **not** rate-limited). Input `{ handleOrUrl: string.min(1), platform: enum["TikTok","Instagram"] }`. Calls `findExistingCreatorByHandle(handleOrUrl, platform)` and returns `{ existing }`.

`findExistingCreatorByHandle` — `server/db.ts:631-710` **[F]**:
1. `canonicalizeHandle(handleOrUrl)` → lowercased handle stripped of URL/`@` (`server/_core/handles.ts:17-22`). Empty → returns `null`.
2. Primary probe: `subjects` where `subject_type='creator'` AND `primary_platform=normalizePlatform(platform)` AND `lower(primary_handle)=canonical` (`db.ts:650-661`).
3. Secondary probe: `platform_handles` join `subjects` (covers subjects whose *primary* platform differs) (`db.ts:666-683`).
4. Returns `{ subjectId, handle, displayName, lastAnalyzedAt (latest observation), reviewStatus (latest), pendingObservation }`.

### 1.3 `creator.analyze` — the mainline
`server/routers.ts:796-967`. **[F]**

**Middleware / limits** — `analysisRateLimitedProcedure` (`server/_core/rateLimit.ts:142-150`): `requirePilotAuth` (cookie check) **+ 10 requests / hour / IP**, in-memory sliding window keyed by `x-forwarded-for` (`rateLimit.ts:63-71, 78-108`). **[F]** Not multi-instance safe (comment `rateLimit.ts:8-9`). **[F]**

**Auth** — cookie `womo_pilot_auth` = `HMAC-SHA256(JWT_SECRET)` set on login (`routers.ts:755, 739-743`); `ctx.authenticated` gates every protected procedure (`rateLimit.ts:112-118`). PIN auth carries no per-user identity (`schema.sql:733`). **[F]**

**Input** — `{ handleOrUrl: string.min(1), platform: enum["TikTok","Instagram"], confirmDuplicate?: boolean }` (`routers.ts:797-802`). No URL/format validation beyond min-length; handle canonicalization happens later at persist time. **[F]**

**Duplicate gate** (`routers.ts:807-818`) **[F]** — runs **before any scraping**. If `!confirmDuplicate`, re-runs `findExistingCreatorByHandle`; if a subject exists, throws `TRPCError PRECONDITION_FAILED` with the last-analyzed date and review status. This is enforced server-side even if the client skips pre-flight, and re-checked at submit to cover the pre-flight→submit race. On a **first analysis** the gate passes silently; on a **rerun via this endpoint** the analyst must pass `confirmDuplicate:true` (the "Analyze anyway" path). Note: an accepted-or-not existing subject blocks equally.

**Run id** — `runId = newRunId()` (`randomUUID`, `server/_core/runContext.ts:21-23`), then `withAnalysisRun(runId, …)` establishes an `AsyncLocalStorage` context (`runContext.ts:26-28`). Every `scrape_events` and `llm_invocations` row written anywhere downstream is stamped with `currentRunId()` — no code hands the id around explicitly. **[F]**

**Timeout / concurrency** (`routers.ts:828-872`) **[F]**:
- `ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000` (`:831`) — **the comment at `:828-830` says "3-minute timeout" but the constant is 5 minutes.** [minor doc/code drift, OURS]
- `analysisConcurrencyLimit = pLimit(2)` (`routers.ts:48`) — at most 2 analyses run the research+extract stage at once, process-wide. **[F]**
- Research + extraction race against the timeout via `Promise.race` inside the concurrency limiter (`:861-872`).

**The work** (`routers.ts:833-859`) **[F]**:
1. `research = await researchCreator(input.handleOrUrl, input.platform)` (Stage 2-4).
2. `extracted = await extractCreatorProfile(input.handleOrUrl, input.platform, research.evidenceSummary)` — **one retry** after a 1s delay on any throw; a second failure throws `INTERNAL_SERVER_ERROR` (`:842-855`).
3. `researchData` is assembled from `research.*` (`:893-916`) — the flat bag persistence consumes.
4. `persistCreatorToV2({... evidenceSnapshot: buildCreatorEvidenceSnapshotPayload(input.handleOrUrl, input.platform, research.evidenceSummary, research) })` (Stage 7, `:920-933`).
5. `tokenMetrics = getLlmTokenUsageByRunId(runId)` (`.catch → zeros`, `:938`).
6. `persistence = summarizePersistence(persistResult)` (`:945`).
7. `saved = getCreatorProfileById(actualSubjectId)` (Stage 8, `:952`).
8. Returns `{ profile: saved, persistence, extracted, runId, pipelineMetrics }` (`:953-965`).

### 1.4 Rerun vs first analysis — the four entry variants

| Endpoint | routers.ts | Auth / limit | Duplicate gate | 5-min timeout | pLimit(2) | Extraction retry | Notes |
|---|---|---|---|---|---|---|---|
| `analyze` | 796 | 10/hr | **yes** | **yes** | **yes** | **yes (1×)** | mainline |
| `reanalyze` | 1078 | auth only | **no** | **no** | **no** | **no** | append-only rerun |
| `bulkAnalyze` | 1234 | 2/hr | **no** | **no** | **no** | **no** | background job, ≤10 handles |
| `ingestSupplementalVideo` | 1152 | auth only | n/a | n/a | n/a | n/a | one video, captions only |

- **`reanalyze`** (`routers.ts:1078-1147`) **[F]**: own `runId`; `getCreatorProfileById(id)` → `researchCreator(existing.profileUrl || existing.handle, existing.platform as any)`. **On research failure it catches and proceeds with `evidenceSummary=""`** (`:1117-1119`), then calls `extractCreatorProfile(handle, platform, "")`. Because the empty string is falsy, the prompt's `evidenceBlock` becomes *"No scraped evidence available. Use your knowledge of this creator if publicly known"* (`aiExtraction.ts:107-109`) — i.e. **reanalyze can produce a fully LLM-hallucinated profile on scrape failure**, unlike `analyze` (whose research failure inside the race propagates). [OURS] It creates a new `pending` observation (append-only) and returns the *previous* profile when `saved==="none"` (`:1142-1145`).
- **`bulkAnalyze`** (`routers.ts:1234-1307`) **[F]**: `bulkRateLimitedProcedure` (2/hr), `handles.max(10)`, platform enum `["TikTok","Instagram"]`. Returns a `jobId` immediately and processes **in a background async IIFE** (`:1245-1304`); each handle is its own run (`withAnalysisRun(newRunId(), …)`), inlining research→extract→persist (it does **not** call the `analyze` endpoint despite the comment at `:1253`). No duplicate gate, no timeout, no extraction retry, no concurrency cap; per-handle errors are recorded and the loop continues (`:1298-1300`). A hung handle blocks the sequential loop.
- **`ingestSupplementalVideo`** (`routers.ts:1152-1230`) **[F]**: `fetchSingleTikTokTranscript` (captions only — Whisper is explicitly not used for TikTok, `webResearch.ts:2925`). Stores a `content_items` row with **`transcriptSource:"whisper"`** (`:1214`) — **mislabeled; the transcript came from captions.** [OURS, cosmetic] It does **not** update `observations.transcript_count`; the returned `newDataConfidence`/`newTranscriptCount` are cosmetic (`:1194-1196`) and diverge from stored state. [OURS]

---

## STAGE 2 — PLATFORM ROUTING

`researchCreator(handleOrUrl, platform)` — `server/webResearch.ts:2838-2918`. **[F]**

Order of branch tests (`:2842-2917`):
1. `extractHandle(handleOrUrl)` (case-preserving, `:2842`, defined `:146-150`).
2. `platform==="YouTube"` **OR `handleOrUrl.includes("youtube.com")`** → `researchYouTubeCreator` (`:2844`).
3. `platform==="Instagram"` **OR `handleOrUrl.includes("instagram.com")`** → `researchInstagramCreator` (`:2848`).
4. `platform==="Multi"` → merge (below).
5. default → `researchTikTokCreator` (`:2917`).

**Reachability [F/I]:** `analyze` and `bulkAnalyze` only ever pass `"TikTok"` or `"Instagram"` (enums at `routers.ts:799, 1237`; client `:23`). `"YouTube"` / `"Multi"` reach `researchCreator` only via **`reanalyze` of a legacy record** whose stored `existing.platform` is one of those (`routers.ts:1092`), or via the **URL-substring override** (a "TikTok"-selected `handleOrUrl` that contains `instagram.com`/`youtube.com` is silently re-routed). [I] So the YouTube and Multi code paths are effectively dead for new analyses and reachable only for historical data or URL edge cases.

**"Multi" mechanics** (`:2852-2914`) **[F]**: `Promise.allSettled([researchTikTokCreator, researchYouTubeCreator])`. If both reject → `NOT_FOUND`. If one is null → return the other verbatim. Otherwise merge with **TikTok as primary**:
- de-duplicated & capped: titles(30), hashtags(20), keywords(40), themeLabels(5), contentThemes(5); transcripts concatenated; excerpts joined with `--- YOUTUBE EVIDENCE ---`.
- scalar merges: `followerCount=max`, `videoCount=sum`, `totalViews=sum`, `avgViews=max`, `engagementRate=max`, `totalLikes=tiktok`, `location=tiktok||youtube`, `profileUrl=tiktok`.
- **Session-6 fix — fields formerly dropped, now preserved (TikTok-first `??` YouTube)** (`:2901-2911`): `followingCount`, `decodedSymbols`, `longitudinalSample`, `culturalVelocity`, `dataConfidenceLevel`, `discoveredVideoPool` (concatenated).
- **Gap [I]:** `researchYouTubeCreator` never populates `dataConfidenceLevel`, `longitudinalSample`, `culturalVelocity`, or `discoveredVideoPool` (see §2 return at `webResearch.ts:2268-2276`), so a Multi run where TikTok failed (returns `youtube!` at `:2868`) yields a result missing all of those — degrading silently.

---

## STAGE 3 — SCRAPING

Shared infrastructure (`server/scraping/httpClient.ts`, `browserClient.ts`) is used by all three platforms; platform specifics follow.

### 3.0 Shared HTTP + browser layer

**`fetchHtml`** (`httpClient.ts:164-265`) **[F]**: UA rotation per attempt (15-string pool, `:41-67`), `maxRetries=3`, backoff `baseDelay·2^(attempt-2)` = 1s then 2s (the inline comment "1s, 2s, 4s" is wrong for 3 attempts, `:180-181`), 100-500ms jitter, 15s timeout. 404/410 → immediate throw, all other non-OK retried then thrown (`:213-224`). Declared options `jitter` and `responseType` are never read (dead options). **[F]**

**Cloudflare** — `detectCloudflare` (`:89-109`) is **gated on `body.length < 50000`** (`:99`), so a challenge page larger than 50 KB evades detection and is treated as success. **[F/I]** [OURS]

**`detectSilentFailure`** (`:415-502`) **[F]** — 200-but-empty detection. TikTok: rehydration `webapp.user-detail` with `followerCount===0 && itemCount===0` → soft block; handle redirect loop; `/login` or `/captcha` in response URL; `body.length<5000 && no rehydration`. Instagram: `_sharedData` present but `graphql.user===null`; rate-limit phrases; login wall (`loginForm && !ProfilePage && !graphql`). **IG has no redirect-to-`/accounts/login` URL check** (IG serves login walls at HTTP 200). **[F]**

**`requestGovernor`** (`:519-567`) **[F]** — process-global inter-request pacing. TikTok: 800-2000ms gap, pause 6-12s every 3 requests. Instagram: 3-8s gap, pause 10-20s every 5 requests. **YouTube is not a supported platform** (no governor). Being process-global, it serializes *starts* but does not limit *overlap* of the long Playwright phases. **[F/I]**

**Proxy is a non-wired stub** — `NoProxy` default (`:33-37, 150`); `setProxyProvider` (`:153`) has no caller and `fetchHtml` never reads `_proxyProvider`; `chromium.launch` passes no proxy. **Every request is direct, un-proxied, and anonymous — no IP rotation exists.** **[F/I]** [OURS]

**Browser pool** (`browserClient.ts`) **[F]**: single Chromium with `puppeteer-extra-plugin-stealth` (`:16-21`) and **`--single-process`** launch arg (`:153`, crash-prone under load). `MAX_CONCURRENT_CONTEXTS=5`, `DEFAULT_MAX_USES=5`, `CONTEXT_TTL_MS=5min`, cleanup sweep 60s (`:79-82`). `getContext` opens a **new page** on every call (`:191`); at capacity it `shift()+close()`s the oldest context **even if a page on it is still in flight** (`:196-203`). Contexts abort image/font loads (`:221-224`). No persistent/authenticated session anywhere. **[I]**

### 3.1 TikTok (the default path)

**Entry:** `scrapeTikTokProfile(handle)` (`scraping/tiktok/profileScraper.ts:492`), called from `webResearch.ts:698` (video API) and `:1730` (profile stats). **[F]**

**Strategy order / fallback chain** (`fetchProfileHtml`, `profileScraper.ts:352-401`) **[F]** — *not* the linear A→B→C→D the header advertises:
1. **Path A (desktop HTTP) is skipped** — `fetchViaDesktopHttp` is dead code (`:357-359`). "TikTok returns a JS shell."
2. **Phase 1 — mobile web** `fetchViaMobileWeb` (`:360`, Path B): `fetchHtml("m.tiktok.com/@handle")` → `detectSilentFailure`; returns `null` on soft-fail/throw.
3. **Phase 2 — Playwright ALWAYS runs** `fetchViaPlaywright` (`:367-370`, Path C) — the **only real source of videos**. Returns Playwright HTML + intercepted XHR `item_list` + user-detail.
4. Fallthrough: Playwright HTML wins → else mobile HTML → else `fetchViaGoogleCache` (Path D, `webcache.googleusercontent.com`, largely defunct) → else `throw "All scrape paths failed"` (`:400`). This throw is the only hard error and propagates up through `researchTikTokCreator`'s try/catch (which converts it to a quota/`NOT_FOUND`/`PRECONDITION_FAILED` decision).

**Videos come only from XHR interception** (`page.on("response")`, `:177-219`), matching `/api/post/item_list/` (over-broad `"item_list"` substring). Rehydration HTML has `itemList` stripped. **[F]**

**Fields yielded [F]:**
- User (XHR user-detail or rehydration `webapp.user-detail`): `secUid, nickname, signature(bio), followerCount, followingCount, heartCount(totalLikes), videoCount`.
- **Regex fallback** (`extractUserInfoFromRegex`, `:673-707`) yields only `followerCount, heartCount, videoCount, nickname, signature, secUid, id` — **`followingCount` stays 0**, `verified`/`diggCount` lost.
- Per video (`parseItemList`, `:619-671`): `id, desc, createTime, playCount, diggCount, commentCount, collectCount, shareCount, music{title,authorName,original}, duetEnabled, stitchEnabled, isAd, video.duration, challenges/textExtra hashtags`.
- **`parseItemList` discards `playAddr`, `downloadAddr`, `subtitleInfos`, `cover`** (`:634-667`) — the profile/search normalizers never surface video/subtitle URLs. **[F]** Consequence: transcription cannot use these; it must re-navigate each video page (Stage 4).

**Commonly missing:** videos from HTTP/rehydration (near-always empty → why Playwright always runs); `followingCount` whenever regex fallback fires; `music.title`/`authorName` when TikTok omits; `secUid` on video items.

**Search** — `searchTikTokVideos(keyword)` (`tiktok/searchScraper.ts:306`), called `webResearch.ts:820`. **[F]** `searchViaPlaywright` intercepts `/api/search/*` XHR → HTML fallback `parseSearchFromHtml` (**`SIGI_STATE` regex — legacy/pre-2023, effectively dead**, `:195`; then rehydration `webapp.search-detail`). Never throws to caller (returns empty on failure). Author-guarded downstream (Stage 4). Same `playAddr/subtitleInfos` omission.

**Blocking in code** — soft block = `detectSilentFailure` fires; the Playwright silent-fail gate (`profileScraper.ts:255-266`) **only aborts if `check.isFailed` AND 0 videos AND no user-detail** — if any XHR data was captured the run returns "success" even when `check.isFailed` is true (the event still records `silentFailureDetected: check.isFailed`, `:272`). **[F]** On a Playwright exception the context is **not retired** (`:289-291`) and can be reused while poisoned. **[I]** [OURS]

**scrape_events for TikTok:**
- Playwright: 3 explicit `tiktok_playwright` events (silent-fail `:258`, success `:269`, catch `:284`). **[F]**
- Mobile web (Path B): no explicit event — relies on `fetchHtml` auto-log `tiktok_mobile_http`. **[F]**
- Google cache: auto `tiktok_google_cache`.
- Per-video transcript page: Path A `fetchHtml` auto `tiktok_desktop_http`; subtitle download `downloadWebVTT` explicit `tiktok_desktop_http` (`webResearch.ts:595, 608`).
- Aggregate `scrapeTikTokProfile/UserInfo/UserPosts` and regex-fallback record nothing of their own.
- **🔴 Telemetry bug [F, OURS]:** `logScrapeSuccess` calls `detectSilentFailure(platform, "", url)` with an **empty body** (`httpClient.ts:353-354`). For TikTok that hits `body.length<5000 && !rehydration` → **every auto-logged TikTok success (mobile-web, video-page, cache) is written with `silent_failure_detected=true`** and reason "TikTok response too small and missing rehydration data", even though `response_size_bytes` shows a full page. IG is unaffected. Auto-logged TikTok HTTP telemetry is systematically mislabeled.

**Fragility (TikTok):** hardcoded rehydration regex + `webapp.user-detail`/`webapp.search-detail` JSON paths; legacy `SIGI_STATE`; over-broad XHR substrings; `--single-process`. Failures are almost all *soft* (null / empty / regex fallback), not throws.

### 3.2 Instagram

**Entry:** `scrapeInstagramProfile(handle)` (`scraping/instagram/profileScraper.ts:624-738`), called `webResearch.ts:1907`. **Never throws** — worst case returns `{ profile: {...emptyProfile(), username}, posts: [], source:"none", confidence:"low" }`. **[F]**

**Two-phase orchestration** (not a simple cascade): Phase 1 Picuki (HTTP, profile) + Phase 2 Playwright (posts, **always**). **[F]** Full top-level order (`:624-738`): Picuki → mobile Playwright (with inner chain) → Picuki-merge if Playwright follower=0 → accept Playwright if any data → desktop Playwright fallback → return Picuki if it has data → profile oEmbed last resort → partial/empty.

**Inner Playwright chain** (`scrapeViaPlaywright`, mobile-ios, `:24-346`) **[F]**:
1. **GraphQL/API XHR interception** (`page.on("response")` filtering `graphql` / `api/v1/users`, status 200).
2. **Direct API via `context.request`** (inherits cookies): `web_profile_info` with hardcoded headers `X-IG-App-ID: 936619743392459`, `X-ASBD-ID: 129477` (`:137-142`); then `feed/user/{id}`.
3. **Silent-failure gate** (`:214-225`) — ignored if any XHR/API data was captured.
4. **Build from captured** → `source:"playwright-mobile-xhr"`, confidence by post count (`≥6 high, >0 medium, else low`).
5. **Legacy embedded JSON** (only if nothing yet): `_sharedData` (IG removed this years ago); `__additionalDataLoaded` (**non-greedy regex captures a truncated object → JSON.parse throws → null; structurally near-unusable**, `:273`); meta tags (**profile stats only, `posts:[]` always**).

The desktop path (`scrapeViaPlaywrightDesktop`) has **no silent-failure gate and no direct-API strategy**. **[F]**

**Fields yielded [F]:**
- Profile (GraphQL/`_sharedData`): `username, full_name, biography, follower_count, following_count, media_count, category, external_url, is_business_account, is_verified, profile_pic_url`.
- Posts (GraphQL/`_sharedData`): `id, shortcode, timestamp, like_count, comment_count, view_count, caption, media_type, video_duration, thumbnail_url, video_url`.
- **`video_url` — the transcription-critical field — is populated ONLY by the GraphQL/API-v1 and `_sharedData` paths.** Picuki, meta, DOM-extraction, and oEmbed never set it. **[F]**
- Picuki: **positional** stat mapping (`statValues[0..2]` → media/followers/following, `:538-541`) — if Picuki reorders, stats are **silently mis-assigned (wrong data, not an error)**. **[F]** [OURS/vendor]
- `supplementPostsViaOEmbed` (`postScraper.ts:129`) only supplements when `caption.length<=10` and yields caption+thumbnail only.

**Dead code [F]:** `fetchReelVideoUrl` (`postScraper.ts:66`) — the header's "Whisper fallback" for a missing `video_url` — has **no caller**. There is no live recovery path when `video_url` is absent; the reel is simply skipped in Stage 4.

**Blocking:** `detectSilentFailure` IG branch (above); page-title "couldn't load"/"Page not found" → one reload; login-prompt "Not now" click (best-effort). `page.on("response")` **ignores non-200** and swallows errors — a 401/429 on the graphql/API XHR is silently dropped, not surfaced as a block. **[F]**

**scrape_events for IG:** every mobile/desktop Playwright outcome branch records an explicit `instagram_playwright` event (`:149,184,217,316,327,336,468,476,484`); Picuki/oEmbed auto-log (`instagram_picuki`/`instagram_oembed`); reel download records `instagram_playwright` (`webResearch.ts:1989,2002`). **[F]**
- **Blind spot [F, OURS]:** `extractAndSupplementPosts` (`profileScraper.ts:747-862`) performs a full Playwright profile navigation with **no `recordScrapeEvent`** — an entire page load invisible to telemetry. A Picuki HTTP-200 page that parses to nothing is auto-logged as a *success*.
- **Labeling [F]:** `instagram_playwright` conflates XHR interception, `api/v1` REST calls, page navigation, and reel video download — the events cannot distinguish them.

### 3.3 YouTube

**Entry:** `searchYouTube` (`scraping/youtube/searchScraper.ts:41`) + `scrapeYouTubeChannelDetails/Videos` (`channelScraper.ts:53,185`), driven by `fetchYouTubeTranscripts` (`webResearch.ts:1314`). All delegate HTTP to `fetchHtml`. **[F]**

**Single-path parse** (`extractYtInitialData`, three regexes, `searchScraper.ts:133-153`) — no fallback chain; missing `ytInitialData` → graceful empties (`{contents:[]}` / `status:"ERROR"`). **[F]**

**Fields + missingness [F]:**
- Search channel result: `channelId, title, descriptionSnippet` — **no counts**.
- `scrapeYouTubeChannelDetails`: `title`, `subscribers` (**only from legacy `c4TabbedHeaderRenderer` → 0 on modern layouts**), `description, keywords, country`; **`videos` is `videoCount = 0` declared at `:123` and never reassigned → `stats.videos` is ALWAYS 0** (`:173`) [🔴 hard bug, OURS]; `views` usually 0 (About tab loads via continuation not present on first HTML).
- `scrapeYouTubeChannelVideos`: **first grid page only** (no continuation, ~≤30 videos), `videoId, title, views` — no dates/likes/comments.

**Blocking:** no consent-page detection, no `CONSENT` cookie, no 429 branch; a consent interstitial parses as "no ytInitialData" → empty. 429 surfaces from `fetchHtml` → `isQuotaErr` → `ytQuotaExhausted` (`webResearch.ts:1334-1337`). **No `requestGovernor` for YouTube.** **[F/I]**

**scrape_events:** all YouTube HTTP is auto-logged `youtube_html`; caption downloads are explicit `youtube_html` (`webResearch.ts:1279,1289`). **[F]**

### 3.4 The §1.10 "zero scrape_events" bug — status at HEAD
PIPELINE_REFERENCE §1.10 (content_items + decoded_signals but **zero** scrape_events) is a **pre-Session-7 diagnosis**. At HEAD, commit `8d2428e` wired `recordScrapeEvent` directly into every collection path; the specific blind spots it named (TikTok Playwright video collection, IG profile scrape, reel/transcription downloads) now each record on every outcome branch. **The coverage blind spot is closed** for those paths. **[F, code-level]** Residual: the §3.1 empty-body telemetry corruption (data-quality, not coverage) and two minor unlogged navigations (`extractAndSupplementPosts`; the Path B+C browser nav in `fetchVideoTranscriptMultiPath`, mitigated because Path A already auto-logged the same URL). Confirming live rows requires DB access (out of scope for a read-only audit). **[I]**

---

## STAGE 4 — VIDEO SELECTION AND TRANSCRIPTION

### 4.1 Pool discovery (TikTok) — `fetchTikTokTranscripts` (`webResearch.ts:743-1193`) **[F]**
1. **Primary source** `fetchTikTokVideosFromAPI` (`:795`, via `scrapeTikTokProfile` XHR `itemList`).
2. **Supplemental source — always runs** (`:807-906`): four search queries `[handle, @handle, handle-without-dots, @handle-without-dots]` (dot-stripping works around TikTok search tokenization). Each result is **author-guarded** (`normalizeHandle` equality/substring, `:833-840`) so foreign creators are dropped. Dedup by video id.
3. `< 4` videos → warning "analysis quality degraded" (`:912-914`); the hard block is later in `researchTikTokCreator` (`realTranscripts<2 && titles<4 → PRECONDITION_FAILED`, `:1816`).

### 4.2 The 6-3-3 longitudinal sample (`:918-1020`) **[F]**
- Sort all videos by `createTime` desc.
- **recent** = 6 newest with `createTime>0`.
- **mid** = 3 evenly-spaced from the 6-18-month window.
- **anchor** = 3 from ≥18 months old.
- **Fill-forward fallback (`:965-1003`):** if mid or anchor has <3, fill from `remainingOldestFirst` (oldest available not already bucketed), regardless of true age band. **[F]** Consequence [I]: for creators with few videos, a video labeled `anchor`/`mid` may actually be recent — the temporal stratification the labels imply is not guaranteed, which directly weakens the drift/velocity signals derived from it.
- `completeness`: `≥12 full`, `≥6 partial`, `<6 insufficient` (`:1127-1130`).

### 4.3 Transcription attempts (TikTok) — `fetchVideoTranscriptMultiPath` (`:365-552`) **[F]**
Runs on the 12 sampled videos at `pLimit(3)` over one shared Playwright context (`:1022-1063`). Per video, in order:
- **Path A — HTTP WEBVTT** (`:385-413`): re-fetch the video page, parse `__UNIVERSAL_DATA_FOR_REHYDRATION__` → `subtitleInfos` → download+parse WEBVTT → `transcriptSource:"captions"`.
- **Path B — Playwright `page.evaluate` subtitleInfos** (`:457-507`) → `"playwright-webvtt"`.
- **Path C — Playwright XHR interception of `.vtt`** (`:415-447, 509-523`) → `"playwright-xhr"`.
- **Path E — caption fallback** (`:535-548`): only if the caption has **≥8 real (non-`#`/`@`) words** → `transcriptSource:"caption"`.
- **Path D (Whisper) is deferred/not implemented for TikTok** (`:363`). TikTok never calls the audio transcriber.

### 4.4 Transcription (Instagram) — audio via `transcribeAudio` (`webResearch.ts:1946-2061`) **[F]**
Reels (`media_type video|reel`, sliced to 6) that have a `video_url` are downloaded via `browserCtx.request.get` (inherits IG cookies) and passed as a pre-downloaded buffer to `transcribeAudio`. Batches of 3, stops at 5 transcripts. Merged into the pool with `transcriptSource:"gemini-2.5-flash"` (`:2155`).

### 4.5 Whisper vs Gemini decision (`_core/voiceTranscription.ts`) **[F]**
- **Purely env-gated** (`:127-138`): if `OPENAI_API_KEY` unset and `GEMINI_API_KEY` set → **Gemini** (`transcribeWithGemini`); otherwise → **Whisper** (`whisper-1`, OpenAI).
- **🔴 The Whisper branch ignores the pre-downloaded `audioBuffer`** — `transcribeAudioInner` always re-downloads from `options.audioUrl` (`:144`) with no IG cookies, so IG reel URLs (which need cookies / expire) will usually fail on re-download. Only `transcribeWithGemini` uses the buffer (`:336`). **[F/I]** [OURS] Effectively, IG audio transcription works only when Gemini is the transcriber (no OpenAI key) — consistent with the hardcoded `"gemini-2.5-flash"` source label at `webResearch.ts:2155`.
- **Size caps:** Whisper 16 MB (`:158`), Gemini 15 MB (`:342, 368`).

### 4.6 What "no transcript" means — the distinct cases **[F]**
| Case | Where | Effect |
|---|---|---|
| TikTok all paths exhausted (no subtitles, thin caption) | `:550-551` | returns `null`, video excluded |
| TikTok caption-only fallback | `:544` | `transcriptSource:"caption"` — thin; **excluded from `realTranscripts`** (min-data gate, `:1812`) **but counted in the persisted confidence** (§6.4) |
| IG reel with no `video_url` | `:1976` | skipped (no fallback — `fetchReelVideoUrl` is dead code) |
| IG transcription failed/empty | `:2031-2036` | returns `null` |
| YouTube no caption tracks | `:1254-1257` | `null`; YouTube degrades gracefully (no hard error) |

---

## STAGE 5 — LLM CALLS

**All LLM calls in the creator path use one model and one provider:** `gemini-2.5-flash`, hardcoded in `server/_core/llm.ts:295`, called via the OpenAI-compatibility endpoint `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` (`llm.ts:223`). **[F]** `max_tokens` defaults to 32768 (`:353`). 429s retry with backoff `[5s,15s,30s]`, 60s per-attempt timeout (`:372-420`). Every call logs an `llm_invocations` row fire-and-forget with `purpose, model, promptVersion:"1.0", input/outputTokens, durationMs, status, errorMessage`, `run_id` stamped from ALS (`:300-322`). **`temperature` is only sent when the caller provides it** (`:354-356`) — see the determinism note below. **The `llm_invocations.temperature` and `response_json` columns exist but `insertLlmInvocation` never passes them → both are null on every row.** **[F, OURS-minor]**

The creator path makes **three `invokeLLM` calls per platform run** (theme translation, symbol decoding, profile extraction) plus, for Instagram only, **Gemini audio transcription** (a raw `generateContent` call that bypasses `invokeLLM` and is therefore **not** logged to `llm_invocations`).

### 5.1 Content-theme translation — `translateKeywordsToThemes`
**Caller:** `webResearch.ts:213-280` (invoked from each `research*Creator`). **Purpose:** `content_theme_extraction`. **Model:** gemini-2.5-flash. **Temperature: not set → Gemini default (non-deterministic).** **[F]**
**Evidence interpolated / truncation:** keywords[0:25], hashtags[0:15], titles[0:10], transcript[0:400 chars] (`:225-234`).
**System:** `"You are a content analyst. Output only valid JSON arrays."`
**User prompt (verbatim, `:229-243`):**
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
**Schema:** `{ themes: string[] }` (strict). **Parse:** `JSON.parse` → `themes.slice(0,5)`. **Failure:** any throw → `console.warn` and **fallback `inferContentThemes`** (rule-based keyword→theme map, `:282-307`) — a plausible-looking default that is not evidence-marked downstream. **[F]**

### 5.2 Symbol decoder — `decodeCreatorSymbols`
**Caller:** `server/symbolDecoder.ts:47-228` (invoked once per run from each `research*Creator`, e.g. `webResearch.ts:1861`). **Purpose:** `creator_symbol_decoding`. **Model:** gemini-2.5-flash. **Temperature: not set → Gemini default (non-deterministic).** **[F]**
**Corpus / truncation (`:56-71`):** bio + video titles[0:20] + hashtags[0:20] + transcript excerpts[0:5, each 0:300 chars].
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
**User prompt (verbatim, `:98-126`):**
```
Decode the following creator's language into structured cultural signals.

Creator: @${handle}

ALL CREATOR-AUTHORED TEXT:
${corpus}

Output a JSON object with EXACTLY this structure:
{
  "identityClaims": [
    { "phrase": "exact quote or paraphrase from text", "meaning": "what this reveals about the creator's cultural identity", "informs": ["Archetype", "NicheTopicNode"] }
  ],
  "statusSignals": [
    { "phrase": "exact quote or paraphrase", "meaning": "what cultural position this signal claims", "informs": ["CulturalCapital", "RogersAdoptionStage"] }
  ],
  "communityReferences": [
    { "phrase": "exact quote or paraphrase", "meaning": "what this reveals about the creator-audience bond", "informs": ["ParasocialBondStrength", "AudienceRelationshipType"] }
  ],
  "aspirationDrivers": [
    { "phrase": "exact quote or paraphrase", "meaning": "what emotional promise or identity upgrade this offers the audience", "informs": ["BarthesMyth", "StuartHallDecoding"] }
  ],
  "symbolicSummary": "One precise sentence: what is this creator's core symbolic position? What cultural identity do they embody and sell to their audience?"
}

Rules:
- Only include signals that are genuinely present in the text — do not invent examples
- Each array may have 0–6 items
- Quotes should be close to verbatim where possible; paraphrase only if the pattern is implicit
- The symbolicSummary must be specific and anthropologically grounded, not generic
```
**Schema:** four arrays of `{phrase, meaning, informs[]}` + `symbolicSummary` (strict). **Parse:** `JSON.parse`. **Failure:** any throw → `console.warn` → **returns `null`** (graceful; the run continues with no decoded block). **[F]**
**Injection:** `formatDecodedSymbolsBlock` (`:236-266`) renders the signals into the extraction evidence with the instruction *"⚠️ INSTRUCTION: … You MUST use them to inform … archetype … barthesMyth … audienceRelationshipType … parasocialBondStrength … nicheTopicNode … stuartHallDecoding … goffmanStageConsistency"*. **[F]**

### 5.3 Creator profile extraction — `extractCreatorProfile` (the main call)
**Caller:** `server/aiExtraction.ts:207-278`; prompt built by `buildCreatorExtractionPrompts` (`:55-205`, the **single source of truth** the evidence snapshot also persists). **Purpose:** `creator_profile_extraction`. **Model:** gemini-2.5-flash. **Temperature: 0** (`:203, 220`). **max_tokens:** default 32768. **[F]**
**Evidence interpolated:** `evidenceBlock = "\n\nREAL SCRAPED EVIDENCE (use this as ground truth):\n" + evidenceSummary` when present; otherwise `"No scraped evidence available. Use your knowledge of this creator if they are publicly known, but be conservative and note uncertainty."` (`:107-109`). The `evidenceSummary` is the entire `buildCreatorEvidenceSummary` block (§5.5). No length cap is applied at this layer (the summary's own internal caps apply).

**System prompt (verbatim, `aiExtraction.ts:60-105`):**
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

**User prompt (verbatim, `aiExtraction.ts:111-196`):**
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
**Notes on the prompt [F]:** the JSON block advertises `platform: "TikTok" | "YouTube" | "Multi"` (Instagram omitted from the instruction, though the schema enum includes it, `:230`); the **CAMPAIGN TYPE GUIDE is vestigial** — no campaign field exists in the creator schema (it is a brand concept), so those ~8 lines are inert instruction. **[I, minor, JASON'S/prompt-hygiene]**

**Schema (`:226-264`):** 24 required fields, enums enforced by the provider for archetype, audienceRelationshipType, culturalCapital, goffmanStageConsistency, driftSignal, stuartHallDecoding, rogersAdopterStage, creatorNichePosition, lifecyclePhase, turnerLiminalPhase, pronouns, platform. Free-text: `displayName, toneRegister, barthesMyth, nicheTopicNode, barthesNicheMeaning, aiSummary`. Number: `parasocialBondStrength`. Booleans: `undergroundDensity, mainstreamBleed, remixRate, brandSaturation`.
**Parse / clamp (`:269-277`):** `JSON.parse` with **no try/catch** — malformed JSON throws (caught by the analyze retry). `parasocialBondStrength` clamped to `[1.0,5.0]`. **There is no fabricated-default fallback in `extractCreatorProfile`** — on failure it throws; the mainline `analyze` retries once and then surfaces `INTERNAL_SERVER_ERROR`. **[F]**

### 5.4 Instagram audio transcription (Gemini) — raw `generateContent`
**Caller:** `voiceTranscription.ts:328-449`. **Model:** `gemini-2.5-flash:generateContent` (`:384`). **temperature 0.1, maxOutputTokens 4096** (`:400-403`). **Not logged to `llm_invocations`** (bypasses `invokeLLM`); only a `whisper_transcription` scrape_event is written (`:111`, with `platform` null). **[F]**
**Prompt (verbatim, `:396`):** `"Transcribe ALL spoken words in this audio precisely. Output ONLY the raw transcript text with no labels, timestamps, or formatting. If there are no spoken words, respond with exactly: [NO_SPEECH]"`
**Parse:** first candidate text; reject if empty / `[NO_SPEECH]` / `<5` chars; strip markdown fences. Whisper variant uses `whisper-1`, `verbose_json`, and a language-based prompt (`:181-190`).

### 5.5 The interpolated evidence — `buildCreatorEvidenceSummary` (`webResearch.ts:1495-1702`) **[F]**
This is what fills `${evidenceBlock}`. It is assembled once per run and embeds:
- Header stats (followers, videos, likes, views, avg views, **engagement rate as a computed %**).
- `DETECTED CREATOR TYPE` from `detectCreatorType` (§6).
- **`COMPUTED ENGAGEMENT SIGNALS` block (TikTok only)** (`:1572-1599`): rate metrics and **rule-derived sociological labels** (parasocial bond, audience relationship, cultural capital, remix, brand saturation) followed by *"⚠️ INSTRUCTION: … You MUST use these values directly … Do NOT override them with your own estimate."* — i.e. the LLM is told to **copy** these labels.
- `TEMPORAL CONTENT ANALYSIS` (recent/mid/older buckets, `:1612-1626`) for drift/Goffman.
- The `DECODED CULTURAL SIGNALS` block (§5.2).
- `PRIMARY EVIDENCE — SPOKEN TRANSCRIPTS`: up to 5 transcripts, each truncated to 500 chars (`:1519-1520`).
- Secondary evidence: theme labels, rule themes, keywords[0:20], hashtags[0:15], titles[0:20], music signals[0:10].
- A `DATA CONFIDENCE LEVEL` line computed **inline** as `≥3 transcripts → HIGH` (`:1683`) — note this differs from the persisted confidence rule (§6.4).

Keyword/theme extraction feeds on `combinedTranscriptText = transcripts.join(" ").slice(0, 6000)` (`:1844`) — transcripts beyond ~6000 chars don't inform keywords/themes.

### 5.6 Dead override functions
`aiExtraction.ts:8` imports `computeRogersAdopterStageFromMetadata`, `computeRemixRateFromMetadata`, `computeStabilityScoreFromMetadata`, `computeDriftSignalFromMetadata` from `fitEngine`, **but none are called anywhere in the creator path** (grep confirms only the import line). Deterministic metadata-based override functions exist but are not wired in; `rogersAdopterStage`, `remixRate`, `driftSignal`, `goffmanStageConsistency` come **purely from the LLM** (guided by the evidence text). **[F]** [OURS or JASON'S depending on intent — flagged]

---

## STAGE 6 — DERIVED FIELDS

Fields computed rather than scraped/LLM-extracted, with inputs and empty-input behavior.

### 6.1 Engagement rate — **three different formulas** **[F]**
- **TikTok** (`webResearch.ts:1830-1834`): if `avgLikeRate>0` → `round((avgLikeRate + avgCommentRate)·100, 2)` (like+comment per **play**); else if `followers>0 && avgViews>0` → `min(100, round(avgViews/followers·100,1))`; else 0.
- **Instagram** (`:1938`): `min(100, round(avgLikes/follower_count·100, 1))` (likes per **follower**).
- **YouTube** (`:2229`): `min(100, round(avgViews/follower_count·100, 1))` (views per **subscriber**).
The three are not comparable across platforms. The **persisted** `engagement_rate` is this computed value (not an LLM field — the LLM schema has no engagement rate). [OURS — cross-platform inconsistency; arguably JASON'S if intended]

### 6.2 Engagement signals & sociological labels (TikTok only) **[F]**
`fetchTikTokTranscripts` computes `EngagementSignals` from all `videoItems` (`:1080-1118`): `avgCommentRate, avgSaveRate, avgShareRate, avgLikeRate` (per-play), `originalAudioRate, remixEnablementRate, adTagRate, avgDurationSeconds`. When `rateCount===0` (no videos with views) every rate is 0. These raw rates are **converted to labels** in the evidence summary via fixed thresholds (`:1533-1570`) and the LLM is instructed to copy them (§5.5). **On Instagram and YouTube, `EngagementSignals` is never computed**, so those sociological labels are absent from the evidence and the LLM falls back to its estimation rubric (thin-data guessing). [JASON'S — threshold design; OURS — platform asymmetry]

### 6.3 Cultural velocity (TikTok only) **[F]**
`fetchTikTokTranscripts:1132-1151` — word-overlap heuristic: top-20 words of recent transcripts vs top-20 of historic (mid+anchor); `overlap≥10 → "Focusing"` else `"Drifting"`; requires recent + (mid OR anchor), else `"Insufficient Data"`. Absent for IG/YouTube. Persisted to `creator_observations.cultural_velocity`. [JASON'S — heuristic design]

### 6.4 Confidence level — **three separate computations that disagree** **[F]**
1. **Research-level (TikTok)** `:1879-1882`: `≥6 → high, ≥3 → medium, else low`.
2. **Research-level (Instagram)** `:2120-2123`: `≥3 → high, (posts≥6 || ≥1 transcript) → medium, else low`.
3. **Evidence-summary text** `:1683`: `≥3 → HIGH`.
4. **Persisted (authoritative)** — `routers.ts:380-384` (FIX 8.2): `updateObservationTranscriptCount` recomputes from `transcriptSuccessCount`: `≥6 high, ≥3 medium, else low`, **overwriting** the value written at insert time. **[F]**
YouTube produces no `dataConfidenceLevel` at all. The persisted count **includes caption-fallback pseudo-transcripts** (they are in `researchData.transcripts`), so `data_confidence_level="high"` can be reached with 6 thin captions. And `transcriptSuccessCount` **over-counts** because `updateContentItemTranscript` returns truthy even when 0 rows match (`db.ts:1006-1018`; `routers.ts:373`). [OURS — count fidelity; JASON'S — the thresholds]

### 6.5 Other derived fields **[F]**
- **Engagement tier** — `computeEngagementTierLocal(followerCount)` (`routers.ts:723-730`): `<10k nano, <100k micro, <500k mid, <1M macro, ≥1M mega`. Persisted to `subjects.engagement_tier`; **not read back** (§8).
- **Creator type** — `detectCreatorType` (`webResearch.ts:1460-1491`): keyword heuristics → `PERSONALITY/COMEDY/FOOD/TRAVEL/GENERAL CONTENT CREATOR`; only used to shape the evidence text, not persisted.
- **Rule content themes** — `inferContentThemes` (`:282-307`): keyword→theme map, ≥2 hits; feeds evidence and is also the fallback when the LLM theme call fails.
- **Location** — hardcoded city-list regex over bio + titles + transcript (`:1744, 1850, 2073`). Only ~30 named cities match; everything else → empty. [OURS — brittle]
- **`avg_video_duration`** — computed at persist from `content_items` durations (`routers.ts:349-358`).
- **`engagement_quality_score` / `engagement_quality_confidence`** — `creator_observations` columns that the creator path **never populates** (they belong to `fit.calculate`'s `calculateAllSignals`, `routers.ts:1927`, which runs in the fit path only). Always null for a freshly analyzed creator; returned as null by read-back. **[F]**

---

## STAGE 7 — PERSISTENCE

`persistCreatorToV2` — `server/routers.ts:195-413`. Called identically by analyze (`:920`), reanalyze (`:1124`), bulk (`:1257`). **[F]**

### 7.1 Atomic identity core (`routers.ts:214-282`) **[F]**
One `withTransaction` (`db.ts:120-124` → `db.transaction`): all-or-nothing.
1. `upsertSubject` → `subjects` (`:223`). Key = `canonicalizeHandle(params.handle) || params.handle` (`:212`) — the **canonical lowercased handle**, not the LLM's echo. **On an existing subject only `latestArchetype, displayName, profileUrl, engagementTier` update — `pronouns` and `primaryHandle` are NOT refreshed** (`db.ts:289-297`). **[F]**
2. `upsertPlatformHandle` → `platform_handles` (`:235`).
3. `insertObservation` → `observations`, `review_status:"pending"` (`:239`). `is_latest` = true only if the subject has no `accepted` observation yet (`db.ts:441-449`) — so a **rerun of an already-accepted creator inserts a pending observation that does NOT become authoritative** until an analyst accepts it.
4. `insertCreatorObservation` → `creator_observations` (`:250`).
`identity_core` is recorded `success` immediately after commit (`:286`).

### 7.2 Independent enrichments (`routers.ts:284-406`) **[F]**
Each wrapped by `runEnrichment` (`:99-115`) which records `success`/`failed`/skip into a `PersistenceStatusMap` and **never rethrows** — any one can fail without aborting the others or the run:
5. `signal_values` (`:298`) — keywords→`keyword`, contentThemeLabels→`content_theme`, topHashtags→`hashtag`, extracted.recurringThemes→`theme`; skip if none.
6. `decoded_signals` (`:312`) — from `decodedSymbols` (4 categories); skip if none.
7. `content_items` (`:341`) — from `discoveredVideoPoolJson`; `status = transcriptText ? "sampled" : "discovered"`; carries `music_title`/`music_artist` (**J-4 fix — creator side**, previously hardcoded empty).
8. `avg_video_duration` (`:351`) — computed from content rows.
9. `transcripts` (`:363`) — `updateContentItemTranscript` per transcript, matched by (subjectId, videoId, platform).
10. `transcript_count` (`:383`) — FIX 8.2: overwrites `observations.transcript_count` and `data_confidence_level` from `transcriptSuccessCount`.
11. `evidence_snapshot` (`:388`) — womo_0007 (below); skip if no payload (all creator callers pass one).
12. `persistence_status` (`:402-406`) — best-effort write of the map; in its own try/catch, **not itself recorded** in the map.

### 7.3 Table/column → source map **[F]**
| Table | Key columns ← source |
|---|---|
| `subjects` | `primary_handle←canonicalizeHandle`, `primary_platform`, `display_name←extracted.displayName`, `pronouns←extracted.pronouns`, `latest_archetype←extracted.archetype`, `engagement_tier←computeEngagementTierLocal(followerCount)` |
| `platform_handles` | `handle, platform, profile_url, is_primary=true` |
| `observations` | `follower_count, following_count, engagement_rate, bio, data_confidence_level, transcript_count` ← `researchData.*`; `review_status='pending'`, `run_id=currentRunId()`, `is_latest=takeLatest` |
| `creator_observations` | **22 analytic `extracted.*` fields** (archetype…turnerLiminalPhase, aiSummary — none dropped); `total_likes/video_count/total_views/avg_views/primary_region←researchData`; `cultural_velocity←researchData.culturalVelocity`; `symbolic_summary←researchData.decodedSymbols.symbolicSummary`; `avg_video_duration` set in step 8; `niche_id, engagement_quality_score, engagement_quality_confidence` **never set → null** |
| `signal_values` | `domain, signal_key, rank, source='creator'` (`signal_value, confidence` null) |
| `decoded_signals` | `category, phrase, meaning, informs_fields, source='creator'` |
| `content_items` | `platform_video_id, video_url, caption, create_time, {view,like,comment,share,save}_count, is_original_audio, music_title, music_artist, video_duration, transcript_{text,source,word_count}, status`; **`region` and `temporal_bucket` never set → null** |
| `semantic_documents` | evidence snapshot (2 rows) |

### 7.4 `persistence_status` (`observations.persistence_status jsonb`, `schema.sql:705`) **[F]**
Per-component `{status, reason, at}` map. Status vocabulary (`schema.sql:719`): `success | failed | skipped_no_data | skipped_not_attempted`. `summarizePersistence` (`routers.ts:178-191`) collapses to **`saved`**:
- `none` — core transaction threw (`PersistFailure`); nothing persisted.
- `partial` — core committed but ≥1 enrichment `failed`.
- `full` — core committed and no enrichment failed. **Skips do not count as failures**, so a run with legitimately-absent data still reports `full`.
The mainline warns when `!== "full"` (`routers.ts:945-948`) but **still returns the (partial) profile**.

### 7.5 Evidence snapshot — womo_0007 (`routers.ts:130-153`, `db.ts:559-596`) **[F]**
`buildCreatorEvidenceSnapshotPayload` uses the **same `(handleOrUrl, platform, evidenceSummary)` triple** the extractor received, so the persisted prompt is byte-identical. Two `semantic_documents` rows keyed by `(run_id, document_type)`:
1. `creator_evidence_inputs` — `content_text = JSON({schemaVersion, handleOrUrl, platform, evidenceSummary, structuredInputs=full research object})`.
2. `creator_extraction_prompt` — `content_text = userPrompt`, `metadata = {systemPrompt, model, purpose, temperature}`.
Append-only: partial unique index `(run_id, document_type)` → a duplicate write **rejects** rather than replaces (`db.ts:555-557`). No pgvector column exists (`schema.sql:818`). **This snapshot is the only place the raw engagement rates and the full evidence text survive queryably** (embedded in the prompt), because the numeric rates are not stored as columns.

### 7.6 Captured but NOT persisted (data loss) **[F]**
- **`longitudinalSampleJson`** (the 6-3-3 sample) — passed into persist by all three callers (`routers.ts:913,1113,1286`) but **never read in the persist body**. Only the scalar `cultural_velocity` derived from it survives.
- **`content_items.temporal_bucket`** — never written; combined with the above, the completeness diagnostic (`db.ts:1690`) will **always report `longitudinalSample` missing** for creators.
- **`content_items.region`** — never written.
- **`researchData.recentVideoTitles` and `transcriptExcerpts`** — passed but never read; read-back reconstructs them from `content_items` (a string→array reshape for excerpts).
- **Raw `EngagementSignals` rates** (avgCommentRate, avgSaveRate, …) — never stored as columns; only their LLM interpretation (`parasocial_bond_strength`, etc.) and their appearance inside the evidence-snapshot prompt.
- **`creator_observations.niche_id`, `engagement_quality_score/confidence`** — never populated on the creator path.
- **`scrape_events` / `llm_invocations`** — not written by persist; written ambiently during Stages 3-5, correlated only by `run_id`.

---

## STAGE 8 — READ-BACK

`getCreatorProfileById(subjectId)` — `server/db.ts:1217-1453`. **[F]** Shape: `subjects ⨝ observations(is_latest=true) ⨝ creator_observations`, plus review-gate-filtered subqueries for `signal_values`, `decoded_signals`, `content_items` (visible = accepted OR the current authoritative observation; content_items also include null-observation legacy rows).

### 8.1 Returned verbatim
All 22 `creator_observations` analytic fields + metrics (`total_likes, video_count, total_views, avg_views, avg_video_duration, engagement_quality_score/confidence, primary_region`); `observations.{follower_count, engagement_rate, data_confidence_level, transcript_count, review_status, reviewed_at, reviewed_by, run_id, created_at, observed_at}`; `subjects.{id, primary_handle, primary_platform, profile_url, display_name, pronouns, updated_at}`; `pendingObservation`.

### 8.2 STORED but NOT returned (dropped on the way out) **[F]**
- **`observations.following_count`** — written at persist (`routers.ts:242`) but **absent from the return object** (`db.ts:1365-1452`). Still readable by other diagnostics (`db.ts:1679`), so this is a getter-specific drop. **`fit.calculate` and the UI never receive it.** [OURS]
- **`subjects.engagement_tier`** — written, not returned (recomputable from followerCount).
- **`observations.persistence_status`** — not returned; surfaced live only at analyze/reanalyze time, never re-read for existing profiles.
- `subjects.latest_archetype`, `observations.is_latest`, subject website/created fields — not returned (archetype is served from `creator_observations` instead).

### 8.3 TRANSFORMED / reshaped **[F]**
- **`decodedSymbols`** — reassembled from `decoded_signals` rows into `{identityClaims, statusSignals, communityReferences, aspirationDrivers, symbolicSummary}` (symbolicSummary sourced from `creator_observations`, not the rows); `null` if no rows. `symbolicVocabulary` is **not** reconstructed (never stored for creators).
- **`discoveredVideoPoolJson`** — rebuilt from `content_items` ordered by `view_count DESC`; `createTime` back to Unix seconds; `url` falls back to a **synthetic `https://www.tiktok.com/@/video/${id}` even for IG/YouTube** when `video_url` is null (`db.ts:1341`); adds `alreadySampled = status==="sampled"`; `musicArtist` defaults `""`.
- **`transcripts`** (J-4 music round-trip, `db.ts:1425-1434`) — from transcript-bearing content_items as `{videoId, transcript, wordCount, musicMetadata: music_title ? {soundName, isOriginal} : undefined}` — exactly the shape `fit.calculate` reads for music overlap.
- **`transcriptExcerpts`** — array rebuilt from content_items (input was a string); `temporalBucket` always `""` (never stored).
- **`recentVideoTitles`** — rebuilt from `content_items.caption`.
- **`rawKeywords/contentThemeLabels/topHashtags/recurringThemes`** — rebuilt from `signal_values` by domain, ordered by rank; `null` if empty.
- **`location` and `primaryRegion`** — both mapped from the single `creator_observations.primary_region`.

### 8.4 What downstream therefore receives **[F/I]**
- **`fit.calculate`** (`routers.ts:1710`, `fitRateLimitedProcedure` 20/hr) gates on `creator.reviewStatus === "accepted"` (`:1724`) — a `pending` freshly-analyzed creator is **not matchable** until an analyst accepts it. It reads `barthesMyth, rawKeywords, contentThemeLabels, decodedSymbols`, and `transcripts[].musicMetadata.soundName` → `creatorMusicTitles`. **It also reads `creator.decodedSymbols?.symbolicVocabulary` and `.rawKeywords` on the decoded object (`routers.ts:1747,1865`) — fields that do not exist on the creator `DecodedSymbols` shape → always `[]`/undefined for creators** (a latent no-op). `creatorMusicArtists` is hardcoded `[]` (`:1859`). **[F/I]**
- Consumers never receive `following_count`, `engagement_tier`, `persistence_status`, the longitudinal/temporal sample, or `content_items.region/temporal_bucket`. `engagement_quality_score/confidence` are returned but always null on the creator path.
- Token metrics are read separately via `getLlmTokenUsageByRunId(runId)` (`routers.ts:938`), summing `llm_invocations` by `run_id`.

---

## STAGE-BY-STAGE SUMMARY (one run, chronological)

```
submit (client, TikTok|Instagram)
  └─ creator.preflight ── findExistingCreatorByHandle ─→ duplicate dialog
  └─ creator.analyze  [auth + 10/hr + duplicate gate + runId(ALS) + 5-min race + pLimit(2)]
       ├─ researchCreator(platform)
       │    ├─ TikTok  : scrapeTikTokProfile (Playwright XHR)  +  fetchTikTokTranscripts
       │    │             ├─ pool = API itemList + 4× search (author-guarded)
       │    │             ├─ 6-3-3 sample (+fill-forward)
       │    │             ├─ per-video transcript: HTTP-WEBVTT → PW-webvtt → PW-xhr → caption
       │    │             ├─ EngagementSignals + culturalVelocity (rule)   ← TikTok only
       │    │             ├─ translateKeywordsToThemes (LLM, default temp)
       │    │             ├─ decodeCreatorSymbols (LLM, default temp)
       │    │             └─ buildCreatorEvidenceSummary  (rule labels injected + "use directly")
       │    ├─ Instagram: scrapeInstagramProfile (Picuki + PW) → reel audio → transcribeAudio(Gemini)
       │    └─ YouTube/Multi: reachable only via reanalyze/legacy
       ├─ extractCreatorProfile (LLM, temp 0, 24-field schema)   [1 retry on failure]
       ├─ persistCreatorToV2
       │    ├─ atomic core: subject/handle/observation(pending)/creator_observation
       │    ├─ enrichments: signals, decoded, content_items, avg_dur, transcripts, count/confidence(FIX 8.2), snapshot
       │    └─ persistence_status (best-effort)
       └─ getCreatorProfileById → { profile(pending), persistence, extracted, runId, pipelineMetrics }
```

---

## CRITICAL ASSESSMENT

### C1. Points where the pipeline silently yields a plausible-looking, low-evidence result
1. **`reanalyze` with failed research** produces a fully LLM-imagined profile: research error is swallowed and `extractCreatorProfile` runs with empty evidence → the *"use your knowledge of this creator"* prompt branch (`routers.ts:1117-1121`, `aiExtraction.ts:107-109`). No confidence penalty is forced; the result reads like any other. **[OURS]**
2. **Caption-only "transcripts" inflate confidence.** Path E stores thin captions as `transcriptSource:"caption"`; they are excluded from the min-data gate (`realTranscripts`) but **counted** in the persisted `data_confidence_level` (`routers.ts:361-384`). Six captions → `high`. **[OURS thresholds are JASON'S]**
3. **`transcriptSuccessCount` over-counts** — `updateContentItemTranscript` returns truthy even on 0 matched rows (`db.ts:1006-1018`), so `transcript_count`/confidence can exceed the transcripts actually stored. **[OURS]**
4. **IG/YouTube sociological fields are LLM guesses.** `EngagementSignals` (and thus the parasocial/audience/capital/remix labels) are TikTok-only; on IG/YT the prompt's estimation rubric fills `parasocialBondStrength`, `audienceRelationshipType`, `culturalCapital`, `remixRate`, `brandSaturation` from thin evidence — indistinguishable in the stored row from a data-backed value. **[OURS asymmetry / JASON'S rubric]**
5. **Rule labels are copied, not validated.** The evidence block computes the sociological labels by fixed thresholds and orders the LLM to copy them verbatim (`webResearch.ts:1597-1599`). Whatever the thresholds' validity, the "AI analysis" is largely echoing a lookup table. **[JASON'S]**
6. **`inferContentThemes` fallback** silently replaces LLM themes on any theme-call failure with keyword-map output that looks identical downstream (`webResearch.ts:279`). **[OURS/JASON'S]**

### C2. Fallbacks that substitute a default, and whether it's visible downstream
| Fallback | Default produced | Visible downstream? |
|---|---|---|
| Theme LLM fails → `inferContentThemes` | rule-based themes | **No** — stored in `signal_values` identically |
| Symbol decode fails → `null` | no decoded block | Partially — `decoded_signals` empty; not flagged |
| `parasocialBondStrength` clamp | forced into [1,5] | No |
| Confidence recompute (FIX 8.2) | count-based level incl. captions | Surfaced as `data_confidence_level` (but over-optimistic) |
| Location regex miss | `""` | Stored null; no signal it was attempted |
| `researchCreator` Multi with TikTok-failed | YouTube-only result missing velocity/longitudinal/confidence | **No** |
| Whisper re-download (IG, if OpenAI key set) | transcription fails → fewer transcripts | Only as lower confidence |
| YouTube `videoCount` hardcoded 0 | `video_count=0` stored | **No** — looks like a real zero |

### C3. Fragility ranking of scraping strategies (most → least likely to break on a vendor change)
1. **TikTok Playwright XHR interception** (the sole video source). Depends on TikTok emitting `/api/post/item_list/` XHR to a logged-out desktop browser and on stealth evading detection. Break mode: **empty result** (0 videos) → silent-fail gate may still pass if user-detail was captured → thin analysis, no hard error. **[highest]**
2. **Instagram GraphQL/`api/v1` with hardcoded `X-IG-App-ID`/`X-ASBD-ID`.** IG rotating these or requiring auth → 4xx → null; **and `video_url` disappears, killing all IG transcription** (no live fallback — `fetchReelVideoUrl` is dead). Break mode: empty/soft.
3. **TikTok rehydration & IG `_sharedData`/`__additionalDataLoaded` JSON-path parsing.** Hardcoded key paths + a truncating regex already near-dead. Break mode: soft null → regex/meta fallback → wrong-shape or empty.
4. **Picuki (IG profile Phase 1)** — third-party mirror with positional stat parsing. Break mode: **wrong data** (mis-assigned counts) or outage → Playwright-only.
5. **TikTok search `SIGI_STATE` HTML fallback** — legacy blob, effectively dead already. Break mode: empty.
6. **YouTube `ytInitialData`/`c4TabbedHeaderRenderer` paths** — already partly broken (`videoCount` always 0; subs 0 on modern layout). Break mode: silent zeros. **[lowest incremental risk — already degraded]**

Common theme: **almost every break is soft (empty/null/wrong-data), not a throw.** The only hard error is TikTok's "All scrape paths failed" and the downstream min-data gates.

### C4. Data-loss points (captured then discarded, or stored then not read)
- 6-3-3 **longitudinal sample** computed → never persisted (§7.6). **[largest]**
- **Raw engagement rates** (comment/save/share/like per play) → never stored as columns; only inside the snapshot prompt blob.
- **`content_items.temporal_bucket` / `region`** → never written.
- **`following_count`** → stored, then dropped by the read-back getter (§8.2).
- **`engagement_tier`, `persistence_status`** → stored, not returned by the getter.
- **`playAddr`/`subtitleInfos`** → discarded by `parseItemList` (transcription must re-fetch each page).
- **TikTok `music_artist`** → stored, but `fit.calculate` hardcodes `creatorMusicArtists=[]`, so it is never consumed.

### C5. Ordering / dependency risks
- **Confidence depends on enrichment order:** `transcript_count`/confidence (step 10) overwrite the observation only if the earlier `transcripts` wiring (step 9) and `content_items` (step 7) succeeded; a partial failure there yields an optimistic or stale confidence while the run still returns `partial`/`full`.
- **`avg_video_duration` (step 8)** depends on `content_items` rows existing (step 7); if step 7 fails, duration silently stays null even though the pool had durations.
- **A degraded scrape early → confident-looking extraction later:** the LLM is told transcripts are ground truth; if only 2 thin captions survive, the extraction still emits all 24 fields with full confidence unless `identityCoherenceScore` guidance (which maps to no schema field) happens to lower `aiSummary` tone.
- **`is_latest` gate:** re-analyzing an accepted creator inserts a pending observation that is invisible to `getCreatorProfileById`'s default (it returns the *accepted* one), so the caller can see `persistence:"full"` yet the displayed profile is the **old** one until review — correct by design but easy to misread.

### C6. Non-determinism (different results on identical input)
- **`translateKeywordsToThemes` and `decodeCreatorSymbols` run at Gemini's default temperature** (no `temperature` passed, `llm.ts:354-356`) → theme labels and decoded signals vary run-to-run. Extraction is temp 0 (still not guaranteed deterministic on Gemini, but low variance).
- **Scraping is inherently non-deterministic:** which videos the 4 search queries return, how many transcripts succeed under rate-limits/blocks, and the fill-forward bucket composition all vary → different evidence → different derived signals and confidence.
- **6-3-3 fill-forward** makes bucket membership depend on how many videos were collected this run, not just the creator's true history.
- **Rate-limit/quota timing** changes whether a run hard-blocks, degrades, or succeeds.

### C7. Defects — classified

**OURS (plumbing/code):**
- Empty-body `detectSilentFailure` in `logScrapeSuccess` → every auto-logged TikTok success mislabeled `silent_failure_detected=true` (`httpClient.ts:353-354`). *(High: poisons the core diagnostic signal.)*
- YouTube `videoCount` declared 0 and never reassigned → `video_count` always 0 (`channelScraper.ts:123,173`).
- Whisper branch ignores the pre-downloaded buffer and re-downloads without cookies (`voiceTranscription.ts:144`) → IG transcription fails when an OpenAI key is present.
- `longitudinalSampleJson` never persisted; `temporal_bucket`/`region` never written.
- `following_count` dropped by read-back; `engagement_tier`/`persistence_status` not returned.
- `transcriptSuccessCount` over-count (`db.ts:1006-1018`).
- `ingestSupplementalVideo` labels caption transcripts `"whisper"` and doesn't update the observation count.
- Proxy interface non-wired (no IP rotation despite the abstraction).
- Playwright context not retired on exception (poisoned reuse); pool `shift()+close()` can evict an in-use context; `--single-process`.
- Cloudflare detection gated on `<50 KB` bodies.
- `fit.calculate` reads `decodedSymbols.symbolicVocabulary`/`.rawKeywords` that don't exist on the creator shape (latent no-op); `creatorMusicArtists` hardcoded `[]`.
- Analyze timeout comment says 3 min, code is 5 min.
- Dead code: `fetchReelVideoUrl`, `fetchViaDesktopHttp`, `scrapeTikTokUserPosts/PopularPosts`, `interceptRoute`, `compute*FromMetadata` imports.
- `llm_invocations.temperature`/`response_json` columns never populated.
- Three incompatible engagement-rate formulas across platforms.

**JASON'S (science/model design):**
- Confidence thresholds counting caption fallbacks as evidence-bearing transcripts.
- Sociological-label thresholds (parasocial/audience/capital) computed by fixed cutoffs then *ordered copied* by the LLM — the "AI" contributes little on those fields.
- Cultural-velocity word-overlap heuristic (top-20 overlap ≥10).
- 6-3-3 fill-forward semantics (age bands not guaranteed).
- Archetype strict-priority decision rules and the free-text `barthesMyth`/`nicheTopicNode`/`barthesNicheMeaning` fields (unconstrained hallucination surface).
- The `"use your knowledge of this creator"` no-evidence prompt branch (a sanctioned hallucination path).
- Vestigial CAMPAIGN-TYPE guide inside the creator prompt.

**Duplicates a known J-item:** the **music metadata** carry-through is **J-4** (creator side fixed this session — `music_title`/`music_artist` now flow to `content_items` and back into `fit.calculate` via `musicMetadata.soundName`; the artist half remains unused because `creatorMusicArtists=[]`).

---

## PRIORITIZED FINDINGS (highest impact first)

1. **6-3-3 longitudinal sample is computed but never persisted** (§7.6). The pipeline's most sophisticated temporal artifact is discarded every run; only a single scalar `cultural_velocity` survives, and the completeness diagnostic will always report it missing. *Consequence: drift/temporal reasoning cannot be audited or re-scored from stored data; re-analysis is the only way to recover it.* **[OURS]**
2. **Confidence is systematically over-stated** (§6.4, C1.2-3). Caption-only pseudo-transcripts and a truthy-regardless `updateContentItemTranscript` inflate `data_confidence_level`; a creator with six thin captions and zero spoken transcripts reads `high`. *Consequence: analysts and `fit.calculate` trust thin runs as strong ones.* **[OURS count / JASON'S thresholds]**
3. **IG/YouTube sociological fields are unmarked LLM guesses** (§6.2, C1.4). The computed-signal scaffold is TikTok-only; on other platforms parasocial/audience/capital/remix/brandSaturation are rubric estimates stored identically to data-backed values. *Consequence: cross-platform scores are not comparable and non-TikTok creators carry hidden low-evidence fields.* **[OURS asymmetry / JASON'S]**
4. **`reanalyze` can hallucinate a whole profile on scrape failure** (§1.4, C1.1). Empty evidence silently routes to the "use your knowledge" prompt branch with no confidence floor. *Consequence: a blocked re-scrape yields a confident, fabricated profile that overwrites nothing but appends an authoritative-looking observation.* **[OURS enables JASON'S hallucination path]**
5. **TikTok video collection is a single fragile strategy with soft failure** (C3.1). Playwright XHR interception is the only video source; a vendor change yields empty results that may still pass the silent-fail gate. *Consequence: silent thin-data analyses, no hard error to alert on.* **[OURS/vendor]**
6. **Instagram transcription is one vendor-shape away from zero, with dead fallback** (§3.2, §4.5, C3.2). `video_url` only comes from the GraphQL/`_sharedData` path; the "Whisper fallback" (`fetchReelVideoUrl`) is dead code; and the Whisper branch can't use the downloaded buffer. *Consequence: IG runs frequently degrade to captions-only, then §finding-2 inflates their confidence.* **[OURS]**
7. **Scrape telemetry is present but partly corrupt** (§3.1). The empty-body `detectSilentFailure` bug flags every auto-logged TikTok HTTP success as a silent failure. *Consequence: the very diagnostic added in Session 7 to detect blocking is unreliable for TikTok's HTTP paths.* **[OURS]**
8. **YouTube channel stats are structurally wrong** (§3.3). `video_count` is always 0; subscribers/views are commonly 0 on modern layouts. *Consequence: any YouTube-derived (or Multi-merged) creator has false zero metrics.* **[OURS]**
9. **Read-back drops `following_count` (and tier/persistence_status)** (§8.2). Stored, then never surfaced to fit/UI. *Consequence: a scraped-and-stored signal is invisible to every consumer.* **[OURS]**
10. **Non-determinism in two of three LLM calls** (C6). Theme translation and symbol decoding run at default temperature; identical input yields different themes/decoded signals, which ripple into the extraction evidence. *Consequence: run-to-run instability in stored signals independent of scraping variance.* **[OURS]**
11. **Cross-platform engagement rate is three incomparable formulas** (§6.1). *Consequence: a single `engagement_rate` column means different things per platform and should not be compared or thresholded uniformly.* **[OURS/JASON'S]**
12. **Free-text mythology fields are an unconstrained hallucination surface** (§5.3). `barthesMyth`, `nicheTopicNode`, `barthesNicheMeaning` have no schema constraint and no evidence-grounding check. *Consequence: confident narrative claims with no verifiability, persisted verbatim.* **[JASON'S]**

---

*End of audit. Diagnosis only — no fixes proposed. Items flagged "could not determine": live scrape success rates per strategy; whether post-Session-7 `scrape_events` rows exist for a real run (needs DB read); Gemini's actual determinism at temp 0; runtime frequency of each transcript path.*
