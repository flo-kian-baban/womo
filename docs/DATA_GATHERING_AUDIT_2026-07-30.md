# Data-Gathering Audit — 10-Creator Scoped Re-Run

**Run date:** 2026-07-30, 23:02:24 → 23:16:20 UTC (13 min 56 s wall clock)
**Method:** 10 pending creators deleted, then resubmitted as new analyses through
`creator.submit` and run unattended by the live queue on the Electron child server
(`:3100`). No intervention, no restarts, no code changes.
**Scope:** this document is about DATA GATHERING — what each stage attempts, what it
actually returns, what fallbacks exist. It does **not** assess the science, the
weights, or whether any score is correct. Those are frozen and Jason's.

Every number below was read from the live database (`smvflfoxnkghkiuamkmi`) after the
run. Claims about code cite `file:line`.

---

## 0. HEADLINE

TikTok's only profile-side video source, `profile_xhr_scroll`, returned **HTTP 403
with a 39-byte body on 30 of 30 attempts**. Every TikTok video pool in this run came
from search augmentation alone — a fallback designed to *supplement* the profile,
now carrying it entirely. Pools fell from 27–146 videos to 2–16.

Four of five TikTok creators still committed. Two of them at
`data_confidence_level = high`. The fifth was refused and recorded as
`genuine_empty` — a confirmed fact about the account — when the account is live and
has content.

Instagram captured cleanly on 5 of 5 and lost the `biography` field on all five
without emitting a single failure event.

---

## 1. THE RUN

| Creator | Platform | Followers | Band | Phases | Result | Wall |
|---|---|---|---|---|---|---|
| khaby.lame | TikTok | 162,500,000 | very large | capture **partial** → augment → transcribe → derive → commit | committed | 608 s |
| drjudithjoseph | TikTok | 817,300 | mid | capture **partial** → … → commit | committed | 663 s |
| chriswillx | TikTok | 507,100 | mid | capture **partial** → … → commit | committed | 477 s |
| invisible.ads | TikTok | 1,716 | small | capture **partial** → … → commit | committed | 630 s |
| lynlecheung | TikTok | 357 | small | capture **partial** → … → **genuine_empty** | **REFUSED** | 561 s |
| natgeo | Instagram | 268,000,000 | very large | all complete | committed | 790 s |
| nasdaily | Instagram | 4,800,000 | mid | all complete | committed | 811 s |
| nadinebaggott | Instagram | 240,000 | mid | all complete | committed | 805 s |
| vnillalondon | Instagram | 25,600 | small | all complete | committed | 790 s |
| rachael.pazan | Instagram | 3,402 | small | all complete | committed | 818 s |

**Totals:** 9 subjects, 9 observations, 99 content_items, 278 scrape_events,
29 LLM calls (0 failures), 76,281 input + 14,966 output tokens, 50 ledger rows,
10 pipeline_runs. Browser concurrency held at 2 in-flight / 0 queued throughout;
`peakInFlight` browser 2, llm 3; 1 browser launch, 0 crash recoveries.

### Before vs after — the same ten handles

| Creator | items before | items now | transcripts before | now | confidence before | now |
|---|---|---|---|---|---|---|
| khaby.lame | 95 | **7** | 10 | **3** | high | **medium** |
| chriswillx | 146 | **16** | 9 | 11 | high | high |
| drjudithjoseph | 11 | 14 | 10 | 11 | high | high |
| invisible.ads | 83 | **2** | 10 | **2** | high | **low** |
| lynlecheung | 27 | **refused** | 9 | — | high | — |
| natgeo | 12 | 12 | 5 | 5 | medium | medium |
| nasdaily | 12 | 12 | 2 | 3 | low | medium |
| nadinebaggott | 12 | 12 | 4 | 4 | medium | medium |
| vnillalondon | 12 | 12 | 4 | 4 | medium | medium |
| rachael.pazan | 12 | 12 | 2 | 2 | low | low |

Instagram is unchanged because it is capped at 12 posts by construction (§2.2).
TikTok lost 78 % of its content volume.

---

## 2. STAGE BY STAGE

### 2.1 Stage — PROFILE CAPTURE

**WHAT WE ARE TRYING TO GET.** The account's identity and base fields — display
name, bio, follower/following/likes counts, stated post count — plus, on TikTok, the
video pool itself (capture and pool-seeding are one phase because one navigation
yields both).

**WHAT WE ACTUALLY GOT.**

TikTok, by leg, across 5 creators × 3 phase attempts:

| Leg | Attempts | Success | Outcome |
|---|---|---|---|
| `profile_embed_json` | 15 | **15** | answered every time |
| `profile_xhr_scroll` | **30** | **0** | HTTP 403, 39-byte body, every attempt |
| `profile_rendered_text` | **0** | — | **never fired** — only runs if the embed leg fails |

The embed leg supplies base fields only — no video list, no `secUid`, no video
count. So base fields were correct and complete:

| Creator | followers | following | bio | stated video count |
|---|---|---|---|---|
| khaby.lame | 162,500,000 | 82 | 77 chars | **NULL** |
| drjudithjoseph | 817,300 | 475 | 69 chars | **NULL** |
| chriswillx | 507,100 | 1 | 65 chars | **NULL** |
| invisible.ads | 1,716 | 15 | 23 chars | **NULL** |
| lynlecheung | 357 | — | — | **NULL** |

…and the video pool was **empty on all five**: `videosCaptured: 0`,
`genuineEmpty: false`, `statedVideoCount: null`, `statedCountSource: null`.

Instagram, 5 of 5 `complete`, `instagram_playwright` 36 events / 36 clean:

| Creator | followers | following | stated posts | posts read | **bio** |
|---|---|---|---|---|---|
| natgeo | 268,000,000 | 194 | **32,000** | 12 | **EMPTY** |
| nasdaily | 4,800,000 | 1,302 | 1,594 | 12 | **EMPTY** |
| nadinebaggott | 240,000 | 824 | 2,314 | 12 | **EMPTY** |
| vnillalondon | 25,600 | 33 | 242 | 12 | **EMPTY** |
| rachael.pazan | 3,402 | 2,139 | 292 | 12 | **EMPTY** |

**WHAT FALLBACKS EXIST.**

TikTok base fields — 4 legs (`profileScraper.ts:492-604`), deep and healthy:
1. `profile_embed_json` — plain GET of the embed page. **Fired, answered 15/15.**
2. `fetchViaMobileWeb` (Phase 1) — mobile-UA HTTP, pinned via `extraHeaders`.
3. `profile_xhr_scroll` (Phase 2) — Playwright + XHR interception. **Fired 30×,
   answered 0.**
4. `profile_rendered_text` — reads `document.body.innerText`. **Never fires while
   the embed leg answers** (`if (!embedFields)`, `:600`).

TikTok video pool — **ONE strategy, no fallback within the phase.** The module
header states it plainly (`profileScraper.ts:482-483`): *"The HTTP path never has
video lists (TikTok strips itemList from SSR HTML). Playwright XHR interception is
the ONLY reliable video source."* Path A desktop-HTTP and the Google-webcache leg
were both removed on evidence. When leg 3 fails, the pool is zero.

Empty-capture retry (`profileScraper.ts:527-544`): a 0-video capture is classified
by `classifyEmptyCapture(stated)`; unproven-empty gets ONE bounded retry on a fresh
context. It fired every time and never changed the outcome — so each phase attempt
cost **two** XHR attempts, and 3 phase attempts × 2 = the 30 recorded.

Instagram base fields — 4 legs (`profileScraper.ts:717-800`): `playwright-mobile-xhr`,
`playwright-desktop-xhr`, `profile_rendered_text` supplement, `oembed-fallback`.
Picuki was removed in S5. Leg 1 answered for all five.

---

### 2.2 Stage — VIDEO / POST POOL COLLECTION

**WHAT WE ARE TRYING TO GET.** A pool of the creator's videos large enough and
old enough that a 6-3-3 temporal sample means something.

**WHAT WE ACTUALLY GOT.**

TikTok: **0 videos from the profile on all five.** 100 % of every pool came from
the augment phase.

Instagram: **exactly 12 posts for every creator**, from `slice(0, 12)`
(`instagram/profileScraper.ts:870` and `:1299`). natgeo reports 32,000 posts; we
read 12 — **0.0375 %**. There is no supplemental pool source on Instagram at all
(§2.3), so 12 is both floor and ceiling.

**WHAT FALLBACKS EXIST.**

- TikTok pool: one strategy (above), plus the *separate* augment phase.
- Instagram pool: one strategy. `instagramAugment` backfills captions, never posts
  (`platformTools.ts:565-587`). **No fallback exists.**
- The IG post extractor scrolls to 800 px then 1600 px and stops
  (`profileScraper.ts:823-827`) — two short scrolls against TikTok's six over ~12 s.

---

### 2.3 Stage — SEARCH AUGMENTATION

**WHAT WE ARE TRYING TO GET.** On TikTok, videos the profile scrape missed, via
4 handle-variant search queries (`handle`, `@handle`, dot-stripped ×2), author-guarded
to the normalized handle. Designed as a supplement.

**WHAT WE ACTUALLY GOT.** `tiktok_search_xhr`: 20 events, 16 clean. It became the
sole pool source, and its yield tracks creator fame:

| Creator | followers | videos from search | date span |
|---|---|---|---|
| chriswillx | 507,100 | **16** | 2023-05-05 → 2026-07-28 |
| drjudithjoseph | 817,300 | **14** | — |
| khaby.lame | 162,500,000 | **7** | — |
| invisible.ads | 1,716 | **2** | — |
| lynlecheung | 357 | **2** | 2023-04-03 → 2025-08-25 |

Every returned item carried full metadata — createTime, views, music, duration on
16/16 for chriswillx. Search quality is not the problem; search *coverage* is.
`quotaExhausted: false` on all ten — we were never rate-limited.

Instagram: `instagram:oembed_supplement` only backfills captions of posts whose
caption is missing or ≤10 chars. It cannot add a post.

**WHAT FALLBACKS EXIST.** One strategy, `search_xhr_scroll`. The HTML-parse fallback
was removed on evidence (0 successes in 38 lifetime attempts, ~19 s of futility per
invocation). One bounded transient-retry on a fresh context; a clean zero-result is
never retried.

---

### 2.4 Stage — THE 6-3-3 SAMPLE

**WHAT WE ARE TRYING TO GET.** 6 newest, 3 evenly spaced from the 6–18-month
window, 3 from >18 months — so drift, Goffman consistency and cultural velocity
compare like with like across time.

**WHAT WE ACTUALLY GOT.** Buckets were written (`content_items.temporal_bucket` is
now populated — see §4.3), but on a 16-item pool the stratification is nominal:

chriswillx, the best-supplied creator in the run:

| bucket | count | dates |
|---|---|---|
| recent | 6 | 2026-07-28 … 2026-06-26 |
| **anchor** | 2 | **2026-05-11, 2026-02-09** |
| mid | 3 | 2025-12-22, 2025-06-08, 2023-05-05 |

**The anchor bucket is chronologically NEWER than the mid bucket.** Anchor is
defined as >18 months old; these are 2.5 and 5.7 months old. This is the documented
fill-forward behaviour (`webResearch.ts:939-977`) firing on a thin pool: recent
filled at 6, and the next-oldest unused videos were promoted into anchor. Nothing on
the row marks it as filled-forward, so every downstream consumer reads a
2.5-month-old video as this creator's historical anchor.

Bucket coverage across the run: khaby 6 recent / 1 mid / 0 anchor;
invisible.ads 2 recent / 0 / 0; Instagram `unbucketed` throughout (the contract's
honest value — Instagram does not sample temporally).

**WHAT FALLBACKS EXIST.** Fill-forward from the oldest unused videos when mid or
anchor come up short. It always fires and never refuses; there is no floor below
which a bucket is left empty rather than fabricated from the wrong era.

---

### 2.5 Stage — TRANSCRIPTION

**WHAT WE ARE TRYING TO GET.** The creator's actual spoken words. This is the
prompt's declared highest-priority signal: *"treat them as GROUND TRUTH."*

**WHAT WE ACTUALLY GOT — TikTok.** 3 strategies, per-video, in order:

| Strategy | Attempts | Success | Empty | Timeout | Skipped |
|---|---|---|---|---|---|
| `subtitle_http` | 34 | **11** | 23 | — | — |
| `subtitle_browser` | 23 | **10** | 11 | 1 | 1 |
| `caption_fallback` | 13 | **7** | 6 | — | — |

**`subtitle_browser` succeeded 10 times.** Its lifetime record before this run was
**0 successes in 227 attempts** (`PIPELINE_REFERENCE.md` §1.12, logged as an open
finding). It is no longer a dead leg. It answered for chriswillx (5), drjudithjoseph
(4) and invisible.ads (1).

Per creator, which strategy answered:

| Creator | http ✓ | browser ✓ | caption ✓ | stored `subtitle` | stored `post_caption` |
|---|---|---|---|---|---|
| chriswillx | 6 | 5 | 0 | 11 | 0 |
| drjudithjoseph | 4 | 4 | 3 | 8 | 3 |
| khaby.lame | **0** | **0** | 3 | 0 | 3 |
| invisible.ads | 1 | 1 | 0 | 2 | 0 |
| lynlecheung | 0 | 0 | 1 | — refused — | |

khaby.lame — 162 M followers — yielded **zero speech**. All three of his stored
transcripts are his written captions. For a creator whose whole format is silent
comedy that may be the honest ceiling, but the pipeline cannot tell "this creator
does not speak" from "we could not get subtitles": both produce `post_caption`.

**WHAT WE ACTUALLY GOT — Instagram.** 26 reel transcription attempts:

| Outcome | n |
|---|---|
| success (`speech_to_text`) | **18** |
| **rejected: audio file too large (>15 MB)** | **6** |
| no speech detected | 2 |

Sizes rejected: 15.7, 17.9, 18.6, 26.0, 37.7, 57.0 MB. **23 % of Instagram
transcription attempts were thrown away for file size after the file had already
been fully downloaded** — 294 MB of reel video pulled across 31 downloads in this
run. We send the whole MP4; no audio track is extracted, nothing is trimmed or
re-encoded.

**WHAT FALLBACKS EXIST.**

TikTok — 3 strategies, all three now live. Budgets: browser 20 s/video, http 8 s×2
with a 12 s race, phase 120 s, early-bail after 4 consecutive clear browser empties.

Instagram — **ONE strategy and no fallback whatsoever**
(`platformTools.ts:609-612` → `webResearch.ts:1073`). Download the reel via
Playwright `context.request`, hand the buffer to `transcribeAudio`. If the download
fails, the file is too big, or the model returns nothing, the post contributes zero
transcript. **There is no caption fallback on Instagram** — the equivalent of
TikTok's `caption_fallback`, which produced 7 of this run's transcripts, does not
exist on the Instagram path, even though Instagram captions are typically longer
than TikTok's.

Engine: `OPENAI_API_KEY` is commented out in `.env`, so every Instagram transcript
came from **Gemini audio**, not Whisper — while the telemetry labels it
`whisper_transcription` and the failure text reads `transcript whisper:
FILE_TOO_LARGE`. The label names a path that is not running.

---

### 2.6 Stage — DERIVED FIELDS

**WHAT WE ARE TRYING TO GET.** Engagement rate, engagement signals, cultural
velocity, confidence level, region, engagement tier — computed, not scraped.

**WHAT WE ACTUALLY GOT.**

| Creator | engagement_rate | cultural_velocity | region | confidence |
|---|---|---|---|---|
| khaby.lame | 8.09 | Drifting | — | medium |
| drjudithjoseph | 11.7 | Drifting | **Austin** | high |
| chriswillx | 6.5 | Drifting | — | high |
| invisible.ads | 1.33 | **Insufficient Data** | — | low |
| natgeo | **NULL** | — | — | medium |
| nasdaily | 2.6 | — | — | medium |
| nadinebaggott | 0.3 | — | — | medium |
| vnillalondon | 33.9 | — | **London** | medium |
| rachael.pazan | 7.3 | — | **Montreal** | low |

- **natgeo has no engagement rate at all.** Instagram's formula is
  `avgLikes / followers`; 488,693 total likes over 12 posts against 268 M followers
  rounds to 0.0 at one decimal, and `researchDataFromResult` uses `||` not `??`
  (`routers.ts:157`), so 0 becomes `undefined` becomes NULL. The largest account in
  the corpus silently has no engagement metric.
- **`cultural_velocity` is NULL for all 5 Instagram creators** — it is TikTok-only
  by design, as are all the sociological engagement labels.
- **Region resolved for 3 of 9**, from a hardcoded ~30-city regex over bio, titles
  and transcripts. Note vnillalondon and rachael.pazan resolved *despite* an empty
  bio — the match came from caption/transcript text.
- **`creator_observations.video_count` is NULL for all four TikTok creators** —
  the embed leg carries no video count and `profile_xhr_scroll` never answered.
  Instagram's is populated (32,000 / 1,594 / 2,314 / 292 / 242).

**Confidence is the reliability headline.** `data_confidence_level` is computed
purely from transcript count (≥6 high, ≥3 medium, else low) and is recomputed at
persist. chriswillx and drjudithjoseph are stored at **`high`** on runs where the
profile capture failed completely and every video came from search. The metric
measures how many transcripts we got, never whether we saw the creator's actual
body of work.

**WHAT FALLBACKS EXIST.** Engagement rate has a views/followers fallback on TikTok
when `avgLikeRate` is 0; Instagram has none. Cultural velocity returns
`"Insufficient Data"` rather than guessing — the one derived field that refuses
(invisible.ads). Confidence has no fallback and no floor.

---

### 2.7 Stage — EXTRACT & COMMIT

**WHAT WE ARE TRYING TO GET.** The gate's verdict, three LLM calls, and a
persisted observation.

**WHAT WE ACTUALLY GOT.** 29 LLM calls, **0 failures**, all `gemini-2.5-flash`:

| Purpose | calls | input tok | output tok | avg ms |
|---|---|---|---|---|
| `content_theme_extraction` | 10 | 6,405 | 351 | 6,209 |
| `creator_symbol_decoding` | 10 | 15,014 | 10,497 | 19,105 |
| `creator_profile_extraction` | 9 | 54,862 | 4,118 | 12,471 |

Per creator: 3 calls each (lynlecheung got 2 — it was refused before extraction),
6,344–15,821 input tokens, 13.5–53.2 s of LLM wall time.
**Cost is not stored anywhere** — `llm_invocations` has `input_tokens` and
`output_tokens` but no cost column, so per-run cost can only be reconstructed from
published rates.

Persistence: all 9 committed observations report every component `success` —
identity_core, platform_handle, signal_values, decoded_signals, content_items,
avg_video_duration, transcripts, transcript_count, evidence_snapshot,
longitudinal_sample. 3 `semantic_documents` per run
(`creator_evidence_inputs` 90,483 chars, `creator_extraction_prompt` 24,533,
`creator_longitudinal_sample` 16,111 for chriswillx).

`vnillalondon` minted a `platform_handles` row this time — the handle-collision
recorded in the corpus-rebuild notes is gone, because the brand that owned the
handle was purged on 2026-07-29. The global-uniqueness index is unchanged; it just
no longer has anything to collide with.

**WHAT FALLBACKS EXIST.** The TikTok gate is an **OR**: it refuses only when
`realTranscripts < 2 AND titles < 4` (`platformTools.ts:384`). 16 search-found
titles satisfy the titles arm on their own, so a total profile-capture failure
passes the gate untouched. `extractCreatorProfile` retries once after 1 s then
fails the run. There is no fallback profile.

---

## 3. CAPTURE HEALTH — WHAT IT REPORTED

| Creator | health | superseded | retries | failed paths | thin |
|---|---|---|---|---|---|
| chriswillx | degraded | 3 | 3 | `tiktok_playwright` | false |
| drjudithjoseph | degraded | 3 | 3 | `tiktok_playwright` | false |
| khaby.lame | degraded | 3 | 3 | `tiktok_playwright` | false |
| invisible.ads | **thin** | 3 | 3 | `tiktok_playwright` | true |
| lynlecheung | **thin** | 3 | 3 | `tiktok_playwright` | true |
| natgeo | **clean** | 0 | 0 | — | false |
| nasdaily | **clean** | 0 | 0 | — | false |
| nadinebaggott | **clean** | 0 | 0 | — | false |
| vnillalondon | **clean** | 0 | 0 | — | false |
| rachael.pazan | **clean** | 0 | 0 | — | false |

TikTok's health signal worked — it named the failed path correctly on all five.

**All five Instagram runs report `clean` on a capture that lost the biography
entirely and threw away 6 of 26 transcription attempts on file size.** Neither loss
emits a failure event: the empty bio produces no event at all, and the size
rejections are `transcript `-prefixed, so `deriveCaptureHealth`'s `isAttempt()`
filter skips them by design (`db.ts:902-906`). `clean` currently means "no path
emitted an unprefixed failure", not "we got what we came for".

---

## 4. WHAT ELSE COULD WE CAPTURE

### 4.1 Visible on pages we already load, and not collected

**a) The rendered TikTok profile grid.** `attemptProfileRenderedText`
(`profileScraper.ts:1020-1077`) navigates `tiktok.com/@handle`, waits 4 s for it to
render, reads `document.body.innerText` — and extracts **three numbers**: followers,
following, likes. The module's own header records the decisive observation
(`:974-976`): *"on 30 July jamescharles rendered a full page with 30 video links and
its identity block in innerText at the same moment profile_xhr_scroll was getting
403/39B on the same handle."* The video ids are in the DOM as `/video/<id>` anchors,
with captions and view counts on the tiles. **Nothing harvests them.** This is the
single highest-value uncollected field in the system right now: it is the exact data
the dead leg is failing to get, on a page the browser already has open. Cost: one
more `evaluate()` on a navigation already being paid for.

**b) Per-video hashtags.** `challenges[].title` and `textExtra[].hashtagName` are
parsed per video, then flattened into one pool-level `hashtags` array
(`webResearch.ts:653`). The video↔hashtag association is destroyed. Cost: a column
or a JSON field.

**c) Instagram post type.** Every post is classified `photo | video | reel | carousel`
by the parser and the classification is discarded (§4.3a). Visible, parsed, dropped.

**d) TikTok video `region`.** `content_items.region` exists and is NULL on 99 of 99
rows. Nothing writes it.

### 4.2 Available on a page we do NOT load

- **The TikTok video page's own metadata.** We fetch video pages 34 times for
  `subtitle_http` and parse only `subtitleInfos`. The same rehydration blob carries
  the full item record — description, challenges, author stats at post time, and the
  exact `createTime`. Cost: **zero additional requests**; it is parsing a payload we
  already have in memory.
- **Instagram post permalink pages.** We hold 12 shortcodes and never open them.
  A permalink carries the full caption (untruncated), comment count, tagged users,
  location tag and, on reels, the audio attribution. Cost: 12 navigations per creator
  (~30–60 s), against an Instagram path that currently costs 133–162 s and is not
  rate-limited.
- **Instagram's `/reels/` tab.** The main grid mixes photos and reels; the reels tab
  lists only transcribable content. Our 12-post cap currently spends slots on photos
  that can never yield a transcript — natgeo transcribed 5 of 12, rachael.pazan 2 of
  12. Cost: one extra navigation.

### 4.3 Fields fetched and DISCARDED at a boundary

The audit documented six. **Two have since been fixed, and I found three more.**

*Fixed since `CREATOR_PIPELINE_AUDIT.md` §7.6 was written — the doc is stale here:*
- `content_items.temporal_bucket` — **now written** (`routers.ts:763`), confirmed
  populated on 55 of 99 rows in this run.
- `longitudinalSampleJson` — **now persisted** as `semantic_documents`
  `creator_longitudinal_sample` (`routers.ts:794-807`), 16,111 chars for chriswillx.

*Still open from the original six:* `content_items.region` (NULL 99/99),
`recentVideoTitles`/`transcriptExcerpts` (reconstructed on read-back), raw
`EngagementSignals` rates (survive only inside the evidence-snapshot prompt text),
`creator_observations.niche_id` + `engagement_quality_score`/`confidence` (never
populated on the creator path).

**NEW — the seventh: Instagram `media_type`.** Set by the parser at
`instagram/profileScraper.ts:904`, `:1113`, `:1321` as `photo | video | reel |
carousel`, and dropped one function later at `instagramPostToPoolItem`
(`platformTools.ts:453-471`), whose `PoolVideoItem` has no such field. Outside test
files it is read **nowhere**. Consequence: after persist, nothing can distinguish
"this post had no transcript because it is a photograph" from "this reel's
transcription failed". That is precisely the distinction needed to interpret
natgeo's 5-of-12.

**NEW — the eighth: `baseFieldRead` / `RenderedBaseFields`.** The Instagram scraper
records the raw display strings beside the parsed numbers, and its own type comment
explains why (`instagram/types.ts:46-55`): *"a number can be re-derived from '268M',
but '268M' cannot be recovered from 268000000."* It is set at
`profileScraper.ts:712` and then **never read** — `instagramCapture.capture`
destructures only `{ profile, posts, source }` (`platformTools.ts:479`). This run
shows the cost directly: natgeo's follower count is now `268,000,000` where the
07-27 structured read gave `268,938,069`. We lost ~938,069 followers of precision
and threw away the one artefact that recorded the loss.

**NEW — the ninth: which transcript strategy answered.** `subtitle_http` and
`subtitle_browser` both write `transcript_source = "subtitle"`
(`transcriptStrategies.ts:222` and `:271`; the normalized enum is
`shared/transcriptSource.ts:26-33`). The strategy identity exists at write time and
is stored only in `scrape_events.url_requested` as a `#transcript=<strategy>:<outcome>`
fragment — and since `scrape_events.observation_id` is NULL on 100 % of rows, the
event cannot be joined back to the transcript row at all except by re-parsing URLs
against `run_id`. This is exactly why "subtitle_browser is 0-for-227" required
telemetry archaeology to discover, and why its reversal in this run is invisible from
the data model.

**Also captured and never consumed:** TikTok `verified` and `secUid`
(`TikTokBaseFields`, read nowhere downstream); Instagram `category`, `external_url`,
`is_verified`, `is_business_account` — these reach `native` and have exactly one
consumer, `instagramEvidenceExtras`, which returns `""` unless `isBusinessAccount`
is true, and the code comment notes that flag is *"populated only by the GraphQL
scrape path… live captures via playwright-mobile-xhr leave it false, so in practice
this block is usually empty"* (`platformTools.ts:732-740`). Confirmed: it produced
nothing for any of the five Instagram creators, including natgeo.

### 4.4 Chains with ONE strategy and no fallback

| Chain | Strategies | Consequence when it fails |
|---|---|---|
| **TikTok video pool** | 1 (`profile_xhr_scroll`) | **This run.** Pool = 0; whole corpus falls back on a supplement |
| **Instagram transcription** | 1 (reel download → Gemini) | 8 of 26 attempts produced nothing; no caption path exists |
| **Instagram post pool** | 1 (`extractAndSupplementPosts`) | No augment can add a post; 12 is floor and ceiling |
| TikTok search | 1 (`search_xhr_scroll`) | Currently load-bearing for the pool as well |
| Instagram engagement rate | 1 formula, no fallback | natgeo → NULL |

Profile *base fields* now have four legs on both platforms — that lesson was learned.
The pool and transcription chains did not get the same treatment.

### 4.5 Fallbacks that exist but have never succeeded

- **`subtitle_browser` — the standing 0-for-227 finding is now closed.** It went
  10-for-23 in this run. Worth recording as a reversal rather than a permanent fact.
- **`profile_rendered_text` (TikTok) — 0 attempts, ever, in this run.** It is
  gated behind `if (!embedFields)`, and the embed leg answers 15/15, so the floor
  leg never fires. It is untested in production precisely because the leg above it
  works. If the embed leg goes the way of `profile_xhr_scroll`, this is the only
  thing left and nothing has exercised it.
- **`oembed-fallback` (Instagram)** — never reached; leg 1 answered 5/5.
- **The genuine-empty discriminator** — `classifyEmptyCapture` returned `retry`
  on 100 % of TikTok captures and `genuine_empty` on none. Its ability to *confirm*
  an empty account is unexercised.

### 4.6 Platform asymmetries — things one side yields and the other does not

| Field | TikTok | Instagram | Could be captured on both? |
|---|---|---|---|
| Video duration | 99/99 populated | **0/60 populated** | Yes — IG exposes it on permalinks |
| Music title / artist / original-audio | 39/39 populated | **0/60** | Yes — IG reels carry audio attribution |
| Share count / save count | populated | **hardcoded 0** (`platformTools.ts:461-463`) | Partly — IG shows saves to the owner only |
| Temporal buckets | recent/mid/anchor | **`unbucketed`** — no temporal sampling at all | Yes — IG posts carry timestamps; 12/12 have `create_time` |
| Engagement signals + sociological labels | computed | **never computed** — the LLM falls back to guessing from its rubric | Yes, from the same post metrics |
| Cultural velocity | computed | **NULL for all 5** | Yes, once IG has buckets |
| Stated content count | **NULL 4/4** (embed leg has none) | populated 5/5 | Yes, both ways |
| Bio | 4/4 populated | **0/5 — empty** | It is a regression, not a limit |
| Caption fallback for transcripts | yes, 7 successes | **does not exist** | Yes — IG captions are longer |
| Pool ceiling | search-limited (2–16) | hard 12 | Yes |

Instagram's missing temporal buckets matter more than they look: the creator prompt
instructs the model to derive `goffmanStageConsistency` and `driftSignal` from the
TEMPORAL CONTENT ANALYSIS block and to *"default to Consistent / Zero Change if only
one time period has data"*. Every Instagram creator therefore takes the default —
which is consistent with the standing observation that Goffman and drift are
near-constant across the corpus.

---

## 5. RANKED FINDINGS

Ranked by impact on data completeness and reliability. **OURS** = our code or
scraping. **PLATFORM** = genuinely unavailable.

### 1 — TikTok's only video-pool source is 403-walled. 30/30 failures. `OURS` (mitigable) / `PLATFORM` (cause)
The refusal is TikTok's; the single-strategy design is ours. Content volume fell
78 % and one creator was lost entirely.
**To fix:** harvest video ids from the rendered profile DOM — the page is already
loaded and the code header confirms the links are visible while the XHR is refused.
**Gain:** restores the pool as a second independent leg, exactly as
`profile_embed_json` restored base fields.

### 2 — A blocked capture is terminalised as `genuine_empty`. `OURS`
`recordTerminalFailure` maps any `min_data_rejection` to
`status: genuine_empty, failureClass: genuine_empty` (`analysisQueue.ts:635-636`),
commented as *"a confirmed fact about the subject — terminal by definition and never
retried."* The gate that raised it says the opposite in its own message: *"or TikTok
may be blocking access."* lynlecheung — a live account that yielded 27 videos and 9
transcripts three days earlier — is now recorded as genuinely empty and is excluded
from `scanReadyWork` forever.
The capture phase already learned this lesson and banked the answer:
`assessment.genuineEmpty = false` sits in the ledger.
**To fix:** read the banked capture assessment before choosing the terminal class;
`genuine_empty` only when capture confirmed it.
**Gain:** live accounts stop being permanently written off during a platform block.
Prior corpus history records false "no public content" rejections causing subject
deletions twice.

### 3 — Instagram `biography` is empty on 5 of 5, silently. `OURS`
All nine Instagram observations since 2026-07-30 have NULL bio; the 07-27 runs had
139 and 44 chars. Capture reports `complete`, capture health reports `clean`, no
event is emitted. The bio is a named input to both the symbol decoder ("bio (full)")
and the profile extractor's evidence header.
**To fix:** find the parse regression; add a presence assertion so a lost base field
is an event, not a silence.
**Gain:** restores a first-class evidence field on every Instagram analysis.

### 4 — `data_confidence_level = high` on a blind capture. `OURS`
Confidence counts transcripts and nothing else. chriswillx and drjudithjoseph are
`high` on runs where zero videos came from the creator's profile. An analyst
reviewing the queue sees the system's strongest confidence label on its weakest
captures.
**To fix:** make confidence a function of capture provenance as well as transcript
count — the ingredients (`assessment.videosCaptured`, `captureHealth.status`,
pool-source split) are all already banked.
**Gain:** the one field analysts use to triage stops inverting.

### 5 — 23 % of Instagram transcriptions are discarded for file size, after download. `OURS`
6 of 26 rejected at 15.7–57.0 MB against a 15 MB limit; 294 MB of reel video pulled
in this run. We send the entire MP4 rather than an audio track.
**To fix:** extract or transcode the audio before submitting; or range-request.
**Gain:** ~6 additional transcripts per 26 attempts, at lower bandwidth than today.

### 6 — Instagram reads 12 posts regardless of account size. `OURS`
`slice(0, 12)` twice; two 800 px scrolls. natgeo: 12 of 32,000. There is no
augmentation path to raise it.
**To fix:** scroll further, or paginate the post XHR.
**Gain:** a real sample, and enough posts for temporal bucketing (§9).

### 7 — Instagram transcription has exactly one strategy and no caption fallback. `OURS`
TikTok's `caption_fallback` produced 7 of this run's 21 TikTok transcripts. The
identical mechanism does not exist on Instagram, where captions are longer.
**To fix:** add `caption_fallback` to the Instagram transcribe tool, reusing the
≥8-real-word rule and the `post_caption` source label.
**Gain:** would have converted several of the 8 failed Instagram attempts into
evidence, at zero network cost.

### 8 — The anchor bucket can be newer than the mid bucket, unmarked. `OURS`
chriswillx's "anchor" videos are 2.5 and 5.7 months old. Fill-forward is correct
behaviour on a thin pool, but the row carries no marker, so drift, Goffman and
cultural velocity read a recent video as historical.
**To fix:** stamp fill-forward on the row, or leave the bucket empty below a floor.
**Gain:** temporal signals stop being computed across fabricated eras.

### 9 — Instagram has no temporal sampling at all. `OURS`
All 60 Instagram content rows are `unbucketed`, so `goffmanStageConsistency` and
`driftSignal` take their documented defaults on every Instagram creator, and
`cultural_velocity` is NULL. All 12 posts per creator carry `create_time`.
**To fix:** bucket Instagram posts by timestamp as TikTok does (needs §6 first —
12 posts is too few to stratify).
**Gain:** two sociological fields stop defaulting, on half the corpus.

### 10 — natgeo has no engagement rate. `OURS`
`avgLikes / followers` underflows at one decimal for very large accounts and
`||` converts the 0 to NULL (`routers.ts:157`).
**To fix:** more precision, or an explicit "below measurable threshold".
**Gain:** removes a silent NULL on the largest accounts — exactly the ones most
likely to be matched.

### 11 — Nine fields captured and discarded at a boundary. `OURS`
Seven still open (§4.3): `region`, `media_type`, `baseFieldRead`, transcript-strategy
identity, raw engagement rates, `niche_id`/`engagement_quality_*`,
`videoCountUnavailableReason`. Two of the original six are already fixed and the
audit doc should be corrected.
**To fix:** columns for `media_type`, `transcript_strategy` and the raw display
strings are cheap and independently useful.
**Gain:** `media_type` alone makes every "why no transcript?" question answerable.

### 12 — Capture health reports `clean` on lossy captures. `OURS`
It measures unprefixed path failures, not evidence completeness. Five `clean` runs
lost the bio and 6 transcriptions.
**To fix:** add an evidence-completeness dimension beside the path dimension.
**Gain:** `clean` becomes a claim about the data, not about the plumbing.

### 13 — Telemetry cannot be joined to subjects. `OURS`
`scrape_events.subject_id`, `.observation_id` and both `llm_invocations` equivalents
are NULL on **100 %** of 5,530 / 745 rows. The FK columns exist and are wired
`ON DELETE SET NULL`; nothing populates them. Every diagnostic must route through
`run_id`.
**To fix:** stamp the ambient subject/observation, as `run_id` already is.
**Gain:** per-creator capture history becomes a query instead of an archaeology
project. (Silver lining: it made this run's delete provably safe for telemetry.)

### 14 — The ledger reports `running` during a retry backoff. `OURS`
Observed live: 5 capture rows `running` while `system.concurrency` showed browser
`inFlight: 1, queued: 0`. The loop writes `"pending"` at the top of each iteration
(`phaseScheduler.ts:364`) — but that write lands *after* `await sleep(delayMs)`
(`:447`), so a phase sleeping through a 30 s or 120 s backoff still reads `running`.
The contract at `:324-331` says a phase holding no permit must not read `running`.
**To fix:** record `pending` before the sleep, not after.
**Gain:** the queue view stops overstating in-flight work by up to 3× during
retry storms.

### 15 — The engine is Gemini; the telemetry says Whisper. `OURS`
`OPENAI_API_KEY` is unset, so all 18 Instagram transcripts came from Gemini audio,
while `scrape_method` reads `whisper_transcription` and failures read
`transcript whisper: FILE_TOO_LARGE`. Every Instagram transcription is also logged
twice — once by `webResearch.ts:1151` with `platform='instagram'` and once by
`voiceTranscription.ts:112` with `platform=NULL`, 2 ms apart with identical
`duration_ms`. Both are `transcript `-prefixed, so capture health is unaffected;
per-method counts are doubled.
**To fix:** label the engine actually used; drop one emitter.
**Gain:** transcription telemetry becomes countable.

### 16 — Silent-creator vs no-subtitles is indistinguishable. `PLATFORM` / `OURS`
khaby.lame produced 3 `post_caption` transcripts and zero speech. Whether that is
because he does not speak or because subtitles were withheld cannot be answered from
stored data.
**To fix (ours):** record whether `subtitleInfos` was *present but empty* versus
*absent* — `subtitle_http` already distinguishes these two cases in its `detail`
string and the distinction is thrown away.
**Gain:** separates a fact about the creator from a fact about our access.

### 17 — TikTok stated video count is NULL for every creator. `PLATFORM` (mitigable)
The embed leg carries no count and `profile_xhr_scroll` never answered, so
`creator_observations.video_count` is NULL 4/4 — and with it the denominator that
`classifyEmptyCapture` uses to prove a genuine empty. Finding 2 is partly downstream
of this.
**To fix:** read the count from the rendered profile header, alongside finding 1.
**Gain:** restores the genuine-empty discriminator.

---

## 6. WHAT DID NOT GO WRONG

Worth recording, because these were the risks:

- **Zero LLM failures** in 29 calls.
- **Concurrency held**: browser 2 in-flight / 0 queued, 1 launch, 0 crash recoveries,
  node RSS ~230 MB.
- **Instagram capture is healthy** — 36 `instagram_playwright` events, 36 clean, 5/5
  `complete` where TikTok went 5/5 `partial`.
- **The retry ladder behaved exactly as declared** — capture 3 attempts with 30 s and
  120 s backoff, every time, and banked its partial output so downstream could
  proceed.
- **The gate refused rather than fabricating** when data was genuinely too thin
  (lynlecheung) — the classification of that refusal is the defect, not the refusal.
- **`subtitle_browser` came back from the dead** — 10 successes after 227 lifetime
  failures.
- **`temporal_bucket` and `longitudinalSample` are persisted now**, closing two of
  the six documented data-loss points.

---

## APPENDIX A — DELETION PROOF

Executed as one `DO` block: pre-flight counts, three guards, the delete, then
cascade and survivor assertions. Any violation raises and rolls back. It completed
without raising.

**Guards, all passed before the delete:**
1. Exactly 10 subjects resolved from the (handle, platform) list.
2. `0` observations with `review_status='accepted'` in the victim set.
3. `0` rows in `match_scores` referencing the victim set by
   `creator_subject_id`, `brand_subject_id`, `creator_observation_id` **or**
   `brand_observation_id`.

**Removed (cascade from `DELETE FROM subjects`):**

| Table | Rows |
|---|---|
| subjects | 10 |
| observations | 12 (natgeo carried 3) |
| creator_observations | 12 |
| content_items | 446 |
| signal_values | 635 |
| decoded_signals | 170 |
| semantic_documents | 29 |
| platform_handles | 9 (vnillalondon had 0 — the handle collision) |
| audience_mentions | 0 |

**Survivor floors, asserted in-transaction and re-verified after commit:**

| Table | Expected | Actual |
|---|---|---|
| creator subjects | 22 | 22 ✓ |
| brand subjects | 9 | 9 ✓ |
| observations | 36 | 36 ✓ |
| creator_observations | 27 | 27 ✓ |
| content_items | 1,640 | 1,640 ✓ |
| signal_values | 2,333 | 2,333 ✓ |
| decoded_signals | 675 | 675 ✓ |
| semantic_documents | 72 | 72 ✓ |
| platform_handles | 31 | 31 ✓ |
| audience_mentions | 12 | 12 ✓ |
| **match_scores** | **8** | **8 ✓** (+8 match_narratives) |
| scrape_events | ≥ 5,530 | 5,530 ✓ |
| llm_invocations | ≥ 745 | 745 ✓ |
| pipeline_runs | ≥ 144 | 144 ✓ |
| analysis_phase_state | ≥ 640 | 640 ✓ |
| run_inputs | ≥ 15 | 15 ✓ |
| orphan handles / content / observations | 0 | 0 ✓ |

**Why telemetry was structurally safe:** `scrape_events.subject_id`,
`scrape_events.observation_id`, `llm_invocations.subject_id` and
`llm_invocations.observation_id` are NULL on 100 % of rows, so no cascade could
reach them. `pipeline_runs`, `analysis_phase_state` and `run_inputs` carry no FK at
all. See ranked finding 13 — this is a diagnostic gap that happened to be a safety
property here.

**Cascade hazard checked and cleared:** `match_scores.creator_subject_id` is
CASCADE while `match_scores.creator_observation_id` is NO ACTION. A subject holding
a match would set those two rules against each other. None of the 10 had a match, so
this path remains untested.

---

## APPENDIX B — PER-CREATOR RECORD

Legend: ✓ answered · ✗ attempted and failed · — never fired.

### TikTok

#### khaby.lame — 162,500,000 followers — committed
- **Profile legs:** `profile_embed_json` ✓ ×3 · `profile_xhr_scroll` ✗ ×6 (403 / 39 B) · `profile_rendered_text` —
- **Base fields:** followers 162,500,000 · following 82 · bio 77 chars · **stated video count NULL** — all from `profile_embed_json`
- **Pool:** profile 0 → search **7** (all metadata present)
- **Sample:** 3 sampled · buckets recent 6 / mid 1 / anchor 0
- **Transcripts:** attempted 3 · succeeded 3 · `subtitle_http` 0/7 · `subtitle_browser` 0/6 (+1 skipped) · `caption_fallback` **3/7** → stored 0 `subtitle`, **3 `post_caption`** — zero speech captured
- **Timestamps:** 7/7 · **Views:** 7/7 · **Duration:** 7/7 · **Music:** 7/7
- **Confidence:** medium · **Capture health:** degraded (`tiktok_playwright`)
- **Cost:** 3 LLM calls · 7,257 in / 1,041 out tokens · 28.9 s LLM · 608 s wall

#### drjudithjoseph — 817,300 followers — committed
- **Profile legs:** `profile_embed_json` ✓ ×3 · `profile_xhr_scroll` ✗ ×6 · `profile_rendered_text` —
- **Base fields:** followers 817,300 · following 475 · bio 69 chars · stated count NULL
- **Pool:** profile 0 → search **14**
- **Sample:** 11 sampled · buckets recent 6 / mid 3 / anchor 3 (12 rows bucketed, 11 transcribed)
- **Transcripts:** attempted 12 · succeeded 11 · `subtitle_http` **4**/12 · `subtitle_browser` **4**/8 (1 timeout) · `caption_fallback` **3**/4 → stored **8 `subtitle`, 3 `post_caption`**
- **Timestamps:** 14/14 · **Views:** 14/14 · **Duration:** 14/14 · **Music:** 14/14
- **Region:** Austin (city regex) · **Confidence:** high · **Capture health:** degraded
- **Cost:** 3 calls · 15,821 in / 2,164 out · 53.2 s LLM · 663 s wall

#### chriswillx — 507,100 followers — committed
- **Profile legs:** `profile_embed_json` ✓ ×3 · `profile_xhr_scroll` ✗ ×6 · `profile_rendered_text` —
- **Base fields:** followers 507,100 · following 1 · bio 65 chars · stated count NULL
- **Pool:** profile 0 → search **16**, spanning 2023-05-05 → 2026-07-28
- **Sample:** 11 sampled · buckets recent 6 / mid 3 / **anchor 2 (2026-05-11, 2026-02-09 — newer than mid)**
- **Transcripts:** attempted 11 · succeeded 11 · `subtitle_http` **6**/11 · `subtitle_browser` **5**/5 · `caption_fallback` not needed → stored **11 `subtitle`, 0 `post_caption`**
- **Timestamps:** 16/16 · **Views:** 16/16 · **Duration:** 16/16 · **Music:** 16/16 (all "original sound")
- **Confidence:** high · **Capture health:** degraded
- **Cost:** 3 calls · 9,249 in / 1,808 out · 41.4 s LLM · 477 s wall

#### invisible.ads — 1,716 followers — committed
- **Profile legs:** `profile_embed_json` ✓ ×3 · `profile_xhr_scroll` ✗ ×6 · `profile_rendered_text` —
- **Base fields:** followers 1,716 · following 15 · bio 23 chars · stated count NULL
- **Pool:** profile 0 → search **2**
- **Sample:** 2 sampled · buckets recent 2 / mid 0 / anchor 0
- **Transcripts:** attempted 2 · succeeded 2 · `subtitle_http` **1**/2 · `subtitle_browser` **1**/1 → stored **2 `subtitle`**
- **Timestamps:** 2/2 · **Views:** 2/2 · **Duration:** 2/2 · **Music:** 2/2
- **Cultural velocity:** "Insufficient Data" (the one derived field that refused)
- **Confidence:** low · **Capture health:** **thin**
- **Cost:** 3 calls · 6,344 in / 875 out · 28.0 s LLM · 630 s wall

#### lynlecheung — 357 followers — **REFUSED**
- **Profile legs:** `profile_embed_json` ✓ ×3 · `profile_xhr_scroll` ✗ ×6 · `profile_rendered_text` —
- **Base fields:** followers 357 · bio present — **captured successfully, then discarded with the run**
- **Pool:** profile 0 → search **2**, spanning 2023-04-03 → 2025-08-25
- **Transcripts:** attempted 2 · `subtitle_http` 0/2 · `subtitle_browser` 0/2 · `caption_fallback` **1**/2
- **Gate:** `realTranscripts (0) < 2 AND titles (2) < 4` → `PRECONDITION_FAILED`
- **Recorded as:** `min_data_rejection` → ledger `genuine_empty` — **terminal, never retried** (finding 2)
- **Persisted:** nothing — no subject, no observation, no handle row
- **Confidence:** n/a · **Capture health:** thin
- **Cost:** 2 calls · 1,323 in / 576 out · 13.5 s LLM · 561 s wall — paid in full for a discarded run

### Instagram

All five: `playwright-mobile-xhr` ✓ on the first leg; `playwright-desktop-xhr`,
`profile_rendered_text` and `oembed-fallback` never fired. Pool = 12 posts each
(hard cap). Augment = caption backfill only. Transcription = single strategy, Gemini
audio. Buckets = `unbucketed`. `video_duration` 0/12, `music_title` 0/12,
`share_count`/`save_count` hardcoded 0 on every row. **`bio` EMPTY on all five.**
Capture health **clean** on all five.

| | natgeo | nasdaily | nadinebaggott | vnillalondon | rachael.pazan |
|---|---|---|---|---|---|
| followers | 268,000,000 | 4,800,000 | 240,000 | 25,600 | 3,402 |
| following | 194 | 1,302 | 824 | 33 | 2,139 |
| **stated posts** | **32,000** | 1,594 | 2,314 | 242 | 292 |
| posts read | 12 (0.0375 %) | 12 | 12 | 12 | 12 |
| selected for transcription | 5 | 6 | 6 | 6 | 3 |
| **transcripts succeeded** | **5** | **3** | **4** | **4** | **2** |
| source | speech_to_text | speech_to_text | speech_to_text | speech_to_text | speech_to_text |
| timestamps | 12/12 | 12/12 | 12/12 | 12/12 | 12/12 |
| view counts | **5/12** | 12/12 | **7/12** | 12/12 | **3/12** |
| engagement rate | **NULL** | 2.6 | 0.3 | 33.9 | 7.3 |
| region | — | — | — | London | Montreal |
| signals / decoded | 52 / 15 | 48 / 13 | 50 / 13 | 47 / 15 | 48 / 12 |
| confidence | medium | medium | medium | medium | low |
| LLM in / out tokens | 7,918 / 1,766 | 7,108 / 1,789 | 7,360 / 1,574 | 6,973 / 1,802 | 6,928 / 1,571 |
| LLM seconds | 42.7 | 45.6 | 42.6 | 37.1 | 32.4 |
| wall | 790 s | 811 s | 805 s | 790 s | 818 s |

**Instagram transcription failures, all five creators pooled:** 26 attempts →
18 success, **6 rejected "Audio file too large" (15.7 / 17.9 / 18.6 / 26.0 / 37.7 /
57.0 MB vs a 15 MB limit)**, 2 "no speech detected". 294 MB of reel video downloaded
across 31 downloads (avg 9.5 MB).

### Cost

`llm_invocations` stores `input_tokens` and `output_tokens` but **no cost column**,
so per-run cost is not recorded anywhere and must be reconstructed from published
rates. Measured totals for the run: **76,281 input tokens, 14,966 output tokens,
29 calls, 0 failures**, all `gemini-2.5-flash`. Per committed creator: 6,344–15,821
input and 875–2,164 output tokens.

Transcription cost is not captured at all — the Gemini audio calls in
`voiceTranscription.ts` do not write an `llm_invocations` row, only a
`scrape_events` row with a duration. The 294 MB of reel download and 26
audio-transcription calls are therefore absent from every cost view.
