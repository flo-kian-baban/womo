# YouTube — DISABLED (diagnosis complete, repair deferred)

**Status:** disabled 2026-07-26. YouTube is not a platform this product supports.
**The repair is deferred, not unknown** — all four defects below were reproduced
and root-caused against live pages. Nobody needs to re-diagnose this.

The toolset (`YOUTUBE_TOOLSET`, `phases/platformTools.ts`) and the scrapers
(`server/scraping/youtube/`) are deliberately KEPT in the source, unregistered
and unreachable. Deleting them would discard this diagnosis; leaving them
registered would keep a broken path live.

---

## How the disable works

A platform is capable **iff** it appears in `REGISTRY` in
`server/phases/platformTools.ts`. YouTube was removed from it, so
`toolsetFor("YouTube")` throws exactly as it does for an unknown platform. No
phase, runner, scheduler, queue or harness change was required — that is the
platform contract doing its job.

Enforced at four edges, each closing a different hole:

| edge | file | what it stops |
|---|---|---|
| registry | `phases/platformTools.ts` | anything resolving a toolset |
| `creator.submit` | `routers.ts` | a new campaign being created at all (zod, before a ledger row exists) |
| `creator.reanalyze` | `routers.ts` | a stored YouTube profile becoming a fresh campaign |
| `processCampaign` | `queue/analysisQueue.ts` | **resumption** — the ledger outlives a release, so the boot loop can meet a YouTube campaign enqueued while YouTube still worked |

`PlatformName` still includes `"YouTube"`. That is intentional: the union names
what the system can *describe* (historical rows carry it, and `toolsetFor` must
typecheck in order to throw). Capability lives only in the REGISTRY.

Guarded by `server/youtubeDisabled.test.ts`.

---

## The four defects

### 1. ~25% of every fetch gets mobile HTML the extractor cannot read

`USER_AGENTS` (`server/scraping/httpClient.ts:41-68`) holds **16 agents, 4 of
them mobile** (Pixel 8, SM-S928B, 2× iPhone). `randomUserAgent()` (`:69`) picks
uniformly, so roughly a quarter of fetches present as a phone and YouTube
answers with MWEB, which serialises the payload as a **hex-escaped JS string**
rather than an object literal:

```js
var ytInitialData = '\x7b\x22responseContext\x22:\x7b…'   // \x7b = { , \x22 = "
```

All three patterns in `extractYtInitialData`
(`scraping/youtube/searchScraper.ts:172`) require a literal `{`, so all three
miss and the extractor returns `null` — surfacing as
`"no ytInitialData on channel page"`. MWEB also uses
`singleColumnBrowseResultsRenderer` instead of `twoColumnBrowseResultsRenderer`,
so **decoding the string alone would not be enough**; the navigation paths differ
too.

`fetchHtml` retries only on transport errors, and MWEB is a clean HTTP 200 — so
the user agent is never re-rolled and the failure sticks.

Pinned-UA reproduction, fully deterministic:

| page | desktop UA | mobile UA |
|---|---|---|
| channel details | 2,603,780 B, parses | 1,258,086 B, **null**, hex-escaped, singleColumn |
| videos tab | 1,171,272 B, parses | 517,232 B, **null**, hex-escaped, singleColumn |
| search | 824,105 B, parses | 462,204 B, **null**, hex-escaped |

This is a **shared-code** defect, logged separately — see
[Open finding: mobile agents in the desktop pool](#open-finding).

### 2. Videos tab — `videoRenderer` → `lockupViewModel`

`scrapeYouTubeChannelVideos` (`scraping/youtube/channelScraper.ts:275`) navigates
`richItemRenderer → content → videoRenderer`. YouTube now serves
`richItemRenderer → content → **lockupViewModel**`, so the parse yields zero
videos from a perfectly valid page (30 items + 1 continuation present).

Every field the parser actually uses is still available, just relocated:

| field | new location |
|---|---|
| `videoId` | `lockupViewModel.contentId` |
| `title` | `…metadata.lockupMetadataViewModel.title.content` |
| views | `…metadata.contentMetadataViewModel.metadataRows[0].metadataParts[].text.content` (`"3.9M views"`) |

Duration (`contentImage.thumbnailViewModel.overlays[].thumbnailBadgeViewModel.text`,
e.g. `"9:23"`) and publish date (`"4 days ago"`) are *newly* available. The
current parser does not read them, and adding them would change **what** is
gathered, not just how — out of scope for a repair.

### 3. Channel details — header drift, plus a `videoCount` that is never assigned

`header.c4TabbedHeaderRenderer` is gone, replaced by `header.pageHeaderRenderer`.
`scrapeYouTubeChannelDetails` (`channelScraper.ts:98-201`) still reads the dead
header for two fields, and has a third bug that predates the drift:

| field | value today | why |
|---|---|---|
| `title` | `""` | reads the dead header; the `??` chain does **not** fall through to the handle, because `""` is not nullish. `displayName` ends up empty |
| `stats.subscribers` | `0` | reads the dead header. Feeds `followerCount` (`webResearch.ts:1539`) |
| `stats.videos` | `0` | **never assigned anywhere** — `let videoCount = 0` with no write. A latent bug, independent of the drift |
| `stats.views` | `0` | `channelAboutFullMetadataRenderer` is no longer on the channel page |
| description / keywords / country | correct | come from `channelMetadataRenderer`, which is intact |

The missing values are present in `pageHeaderRenderer` today as the strings
`"21.1M subscribers"` and `"1.8K videos"`.

Consequence worth knowing before repairing: `followerCount` is currently always
`0`, so YouTube's `engagementRate` (`avgViews / followerCount`) is always `0` via
its zero-guard. Repairing subscribers moves that to a real number.

### 4. Captions cannot be downloaded at all

`/api/timedtext` answers **HTTP 200 with an empty body**. Verified across both
`en` and `en(asr)` tracks, three formats (default, `json3`, `srv3`) and two
different videos — every combination returned 0 bytes. The `baseUrl` handed out
in `ytInitialPlayerResponse` carries no `pot` (proof-of-origin) token.

This is an **access requirement, not shape drift** — no parser change can fix it.
The watch page itself is fine on a desktop UA (`playabilityStatus: OK`, 7 caption
tracks listed).

---

## What re-enabling requires

1. Defects 1–3 repaired. For 2 and 3 an ordered strategy chain (legacy shape
   first, current shape second, telemetry naming the winner) is warranted — the
   `transcriptStrategies` pattern. For 1, the narrow in-scope fix is to pin a
   desktop `User-Agent` via `extraHeaders` at YouTube's call sites, since
   `extraHeaders` is spread last in `fetchHtml` and therefore wins.
2. **A decision on transcripts.** Defect 4 has no parser-level fix. The only
   route to YouTube transcripts is audio + speech-to-text, which changes
   `transcriptSource` from `TRANSCRIPT_SOURCE.subtitle` to `speech_to_text` —
   a **FROZEN** classification. That needs explicit sign-off, not an
   implementation decision.

A chain is **not** warranted for defect 4: one mechanism, blocked by policy
rather than shape, so a fallback chain would just be three ways to get an empty
body.

---

## Existing YouTube data (as of disabling)

Left in place, untouched. Nothing is accepted and nothing feeds a match.

| where | count | notes |
|---|---|---|
| `observations` | 2 | both `review_status: pending`, `follower_count` NULL, `transcript_count` 0 |
| `content_items` | **0** | consistent with defect 2 — no video ever parsed |
| `match_scores` | **0** | nothing downstream depends on them |
| `signal_values` | 94 | attached to the 2 observations |
| `decoded_signals` | 13 | |
| `semantic_documents` | 4 | |
| `platform_handles` | 1 | `mkbhd` |
| `scrape_events` | 38 | includes the instrumented failure run |
| `analysis_phase_state` | 10 rows / 2 runs | **both terminal** (`extract_commit: complete`) |

Neither run is resumable: `scanReadyWork` only returns `pending`/`failed`/
`blocked` rows and there are none, while `findIncompleteCampaigns` skips any run
whose `extract_commit` reached `complete`. The `processCampaign` platform guard
is a second, independent line of defence.

---

## Open finding

**Mobile agents in the desktop user-agent pool — needs its own investigation.**

`USER_AGENTS` (`server/scraping/httpClient.ts:41`) contains 4 mobile entries out
of 16, so roughly **25% of every fetch** — TikTok, Instagram, brand crawl and
review research alike — receives mobile HTML. A separate
`randomMobileUserAgent()` exists at `:588` for callers that actually want mobile,
which suggests the mobile entries in the desktop pool are an oversight.

- **Proven fatal for YouTube** (defect 1 above).
- **UNMEASURED for every other platform.** Some paths may tolerate or even
  depend on mobile shapes.

**Do not "fix" this by deleting entries until the effect on each platform has
been measured.** Removing them could change behaviour on paths that currently
work. The investigation is: for each `fetchHtml` caller, compare desktop-pinned
against mobile-pinned responses and record which parsers survive.
