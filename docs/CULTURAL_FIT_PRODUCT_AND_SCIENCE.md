# The Cultural Fit Product — What It Is, What It Gathers, and Where It Disagrees With the Science

**For:** Jason, CSO — owner of the model.
**Date:** 2026-07-31.
**Corpus read:** the live database, this morning. 41 subjects (32 creators, 9 brands),
54 observations, 1,878 pieces of content, 257 stored transcripts, 8 scored matches,
6,044 gathering attempts, 803 logged model calls.

This document has one job: let you read cover to cover and come away knowing what
the product does, what evidence it actually holds, what of that evidence reaches
your engine, and every place where the plumbing and your model are saying different
things. Every number below was read from the live corpus. Where a claim rests on
code rather than data, the file and line are in a footnote at the end, never in the
body.

Two conventions worth knowing before you start:

- **Measured** means a number we read off a platform. **Derived** means arithmetic
  on measured numbers. **Inferred** means a language model read evidence and made a
  judgment. **Defaulted** means nothing arrived and a constant was substituted.
  Nothing in the stored record distinguishes these four — a defaulted value and a
  measured one occupy the same column and render identically. That is the single
  most important structural fact in this document.
- Where I disagree with a premise I was given, I say so and show the evidence. Two
  such places remain, flagged **[correction]**. A third — that TikTok's save and
  share rates were lost — has since been **[resolved]**: they were recoverable all
  along and are now available (§2.3, Q&nbsp;B1).

---

## Contents

1. [What the product is](#part-1--what-the-product-is)
2. [What we gather, and how](#part-2--what-we-gather-and-how)
3. [What reaches the engine](#part-3--what-reaches-the-engine)
4. [The model calls](#part-4--the-model-calls)
5. [Where plumbing and science disagree](#part-5--where-plumbing-and-science-disagree)
6. [What changed since you last saw it](#part-6--what-changed-since-you-last-saw-it)
7. [The questions](#part-7--the-questions)

---

# Part 1 — What the product is

The product is a desk tool for one analyst at a time. It takes a creator, takes a
brand, gathers public evidence about each, converts that evidence into your
framework's vocabulary, and scores the pair. There are five surfaces.

## 1.1 The journey of a subject

A creator moves through five states, and only one of them is matchable.

```
    submitted  →  queued  →  running (5 phases)  →  committed as PENDING
                                                          │
                                        analyst reviews ──┤
                                                          │
                                      ACCEPTED ───────────┴─────── DECLINED
                                          │                            │
                                   matchable                     archived,
                                                                 never matched
```

The five phases a run passes through are **capture** (who is this account),
**augment** (what else can we find), **transcribe** (what do they actually say),
**derive** (compute the rates and signals), and **commit** (call the model, write
the observation). Each phase banks its output, so a restart resumes rather than
restarts.

**Right now: 8 of 32 current creator observations are accepted. 24 are pending.
Zero have ever been declined.** All 9 brands are accepted — brands are not gated at
all, which is a deliberate current-state decision, not an oversight.

## 1.2 Analyze Creator

An analyst pastes handles — one per row, or a whole column pasted at once — and the
page detects the platform from the link. Handles are grouped by platform and queued
in batches. A duplicate handle stops at a gate and asks before enqueuing.

Below the form sits the live queue. It shows only work in flight and work needing
attention: a campaign that completes leaves the page, because its home is now the
Library. Refusals stay until acknowledged, because the queue is the only record an
analyst will ever see of a run that produced no profile.

**What the analyst does here:** submits work, watches it run, and reads refusals.
Nothing on this page is a judgment about a creator.

## 1.3 Analyze Brand

One brand at a time, with four inputs: a **brand name or URL** (required), and
optionally a **Google Maps URL**, a **TikTok handle**, and an **Instagram handle**.

The page tells the analyst plainly that a URL is crawled directly while a bare name
falls back to search and yields thinner evidence. That warning is load-bearing —
see §2.3.

## 1.4 The review gate

This is the quality control, and it is the only one.

- **Pending** — the run committed but no analyst has vetted it. A full-width amber
  banner says "pending review — not vetted", and the profile is **excluded from
  matching**. Attempting to score it fails with a precondition error naming the
  status.
- **Accepted** — an analyst looked at the run diagnostics and vouched for it. This
  is the quiet default state; there is no badge.
- **Declined** — archived. Retained with full provenance, hidden from the default
  Library view behind an "Archived" toggle, never matched.

The gate panel shows facts and counts only — how many content items, how many
transcripts, which sources answered, which failed, how long it took. Deliberately no
derived quality metric appears there. The analyst is being asked "did we actually see
this creator?", not "is this a good creator?".

**Excluded from matching:** any creator observation that is pending or declined.
Brands are not filtered by review status.

## 1.5 Profile Library

Three tabs — Creators, Brands, Matches — with search, filters, and an archived
toggle. Each row is dense: handle, platform mark, follower count, engagement rate,
transcript count, a confidence dot, review status, and per-row actions (view
profile, run match, export JSON, delete).

This is where finished work lives and where the review gate is exercised.

## 1.6 Cultural Match Score

Two pickers — a creator and a brand — and a Calculate button. The creator picker
lists only accepted observations; when profiles exist but are all pending it says so
and links to the Library, rather than showing an empty list.

Calculation runs the engine, makes four model calls, persists a match record, and
renders the report inline. If persistence fails the page says the result was **not**
saved, in red, rather than silently offering a dead link.

The report has five sections:

1. **Executive summary** — the verdict, scannable in seconds.
2. **Detailed analysis** — the arithmetic shown as chains: Cultural Match Score =
   A×α + P×β + S×γ, with each sub-score expanded into its own inputs.
3. **Trust** — how far to believe this number, and why.
4. **Support** — the evidence underneath the score.
5. **Cost and process** — how this score was produced.

Section 5 is where the invisible transcription spend belongs and does not appear
(§4.3).

---

# Part 2 — What we gather, and how

This part reports what the telemetry says, not what the code intends. All 6,044
gathering attempts in the corpus are counted.

## 2.1 The honest headline

| Platform | What we can reliably get | What we cannot |
|---|---|---|
| **TikTok** | Base profile fields, a video pool via search, subtitles about a third of the time, full per-video engagement including saves and shares | The profile's own video list — 403-walled |
| **Instagram** | Base profile fields, exactly 12 posts, reel speech about two thirds of the time | Saves, shares, temporal depth, and the bio |
| **Brand** | The brand's own website, Google reviews, its own social channels | Yelp (blocked), audience mentions at scale, any Reddit signal |

## 2.2 TikTok

**Chain 1 — base profile fields.** Four legs, and it is healthy.

| Leg | Attempts | Answered | Rate |
|---|---|---|---|
| `profile_embed_json` | 44 | 44 | **100%** |
| `profile_rendered_text` | 8 | 3 | 37.5% |
| `profile_rendered_grid` | 8 | 3 | 37.5% |
| `profile_html_direct` | 2 | **0** | **0%** |

The embed leg answers essentially always, which means legs 2–4 only ever run when it
does not. `profile_html_direct` has **never once succeeded** in its lifetime.

**Chain 2 — the video pool. This is the wound.**

| Leg | Attempts | Answered | Rate |
|---|---|---|---|
| `profile_xhr_scroll` | 237 | 83 | **35.0%** |

That lifetime figure hides a collapse. Read by day:

| Date | Attempts | Answered |
|---|---|---|
| 2026-07-26 | 45 | 38 (84%) |
| 2026-07-27 | 47 | 40 (85%) |
| 2026-07-29 | 10 | **0** |
| 2026-07-30 | 118 | **4 (3%)** |
| 2026-07-31 | 16 | **0** |

TikTok's profile video endpoint went from answering 85% of the time to returning
HTTP 403 with a 39-byte body. A rendered-grid fallback was added on 2026-07-31 and
has answered 3 of 8 attempts — partial rescue, not a fix.

**What this means for the science:** when the profile pool is empty, the entire video
corpus for that creator comes from search augmentation. Search was designed to
*supplement* the profile; it is now carrying it alone. Pools fell from 27–146 videos
to 2–16. On the most recent audited run, four of five TikTok creators still committed
— two of them recorded at `high` confidence, on runs where we never saw the creator's
actual body of work.

**Chain 3 — search augmentation.** One strategy. 479 attempts, 303 answered
(**63.3%**). Its yield tracks fame, not need: a 507k-follower creator returned 16
videos, a 357-follower creator returned 2. An HTML-parse fallback existed and was
removed on evidence — 38 lifetime attempts, **0 successes**.

**Chain 4 — transcripts.** Three strategies, tried in order per video.

| Strategy | Attempts | Answered | Rate |
|---|---|---|---|
| `subtitle_http` | 988 | 312 | **31.6%** |
| `subtitle_browser` | 670 | 65 | **9.7%** |
| `caption_fallback` | 604 | 228 | **37.7%** |

`subtitle_browser` was a dead leg for a long stretch — 0 successes in its first 227
attempts — and has since started answering. It is now live but weak.

The consequence you need: **when speech cannot be had, the written caption is stored
in the same column, and the record cannot tell you which you are reading without
looking at a separate source field.** Of 143 stored TikTok transcripts, **103 are
actual subtitles and 40 are captions** — 28% of what the system calls a "transcript"
is text the creator typed, not words the creator said.

## 2.3 Instagram

**Base profile.** 339 attempts on the Playwright path, 325 clean (**95.9%**). Four
legs exist; the first answers.

**Posts.** Exactly **12, always**. Not a sample of 12 — a hard slice. NatGeo reports
32,000 posts; we read 12, which is 0.0375% of their output. There is **no fallback
and no supplemental source** — the augment step backfills captions and cannot add a
post. 12 is simultaneously the floor and the ceiling.

**Transcripts.** 176 attempts, 118 answered (**67.0%**). Until very recently this was
one strategy with no fallback whatsoever: download the reel, hand it to the model, and
if anything went wrong the post contributed nothing. A caption fallback has now been
added and has answered **39 of 39** attempts. Of 114 stored Instagram transcripts, 75
are speech and **39 are captions** (34%).

Six of a recent run's 26 transcription attempts were refused for file size — at 15.7,
17.9, 18.6, 26.0, 37.7 and 57.0 MB against a 15 MB ceiling — *after* the file had been
fully downloaded. 294 MB of reel video pulled in one run. The audio track is now
extracted before the size check, so this specific waste is closed.

**What Instagram genuinely cannot give us:**

- **Saves and shares.** All 240 Instagram content rows with engagement data carry
  `save_count = 0` and `share_count = 0`, maximum 0. These are not measurements; they
  are the absence of a measurement stored as a number. Instagram's public surface
  does not expose them — they live only in the creator's own analytics dashboard.
- **Temporal depth.** All 147 bucketed Instagram items are `unbucketed`. Never
  `recent`, `mid` or `anchor`. Instagram does not sample temporally at all, and the
  code says so honestly rather than inventing buckets.
- **The bio.** Captured cleanly on the profile and then lost — 12 of 32 creator
  observations have an empty bio, and on a recent five-creator Instagram run it was
  empty on **all five** without a single failure event being emitted. Silent loss.

**[resolved 2026-07-31] — saves and shares on TikTok.** An earlier draft of this
document recorded that TikTok's save and share rates were computed, shown to the
extraction model, and then discarded with nowhere to read them. The first half was
right and the conclusion was wrong: they were never actually lost. **Every input
they need was already persisted per post**, on the same `content_items` row —
`save_count`, `share_count` and `view_count` side by side, written from the same
pool element the live computation read.

So the rates are now **derived on demand rather than stored**: a read of a creator
profile computes all eight engagement rates from the rows it has already fetched.
Nothing new is written and no column was added. Three consequences worth your
attention:

- **It reaches backwards.** All 25 TikTok observations already in the corpus have
  their save and share rates now, without a re-run. A stored column would have
  started blank and filled only going forward.
- **It cannot drift.** A stored aggregate and its per-post inputs are two sources of
  truth for one number, and they part company the moment a re-analysis writes new
  content rows. A derivation has one source.
- **The engine still cannot see it.** These are read-path values. Nothing in the
  scoring path reads them, and `engagement_rate` — the one number the engine does
  read — is untouched.

The same fix covered all eight rates, not just the two. Six are now derivable;
**`remixEnablementRate` and `adTagRate` are not, and never will be from this
schema** — the duet, stitch and ad flags are read off the platform, live briefly on
the in-memory pool item, and are dropped before persistence with no column to land
in. Those two return a permanent null that names its own reason. Recovering them
needs a schema change.

**The limitation this leaves on Instagram — and it is the one that matters to you.**
All 240 Instagram rows carrying engagement read `save_count = 0` and
`share_count = 0`, maximum 0, because the pool builder writes a literal zero for a
field Instagram does not publish. **At the row level that is absence stored as a
value, and it is not distinguishable from a measurement.** Nothing about a stored
`0` says whether nobody saved the post or whether nobody could have told us.

The derived rate does not repeat the mistake — it returns **null** for Instagram
saves and shares, and names Instagram as the reason. But it can only do that because
the code carries an out-of-band table saying *Instagram does not publish this field*.
The distinction is asserted by that table, not recoverable from the data. If a
platform's behaviour changes, or a third platform arrives, the table is the only
thing standing between an absence and a number.

This is the same shape as the projected-versus-received gap on the brand side (§2.4,
Q&nbsp;G2): a nothing that was written down as a zero and now reads as evidence. It
is worth deciding whether you want that class of value marked at the row level
rather than patched at the aggregate.

## 2.4 Brand

A brand is not a platform — it is a different kind of subject, with a website,
review sites, search fallbacks, and optionally two social channels. Its evidence is
assembled in a fixed order: base block, then decoded symbols, then audience
mentions, then TikTok channel, then Instagram.

| Source | Attempts | Answered | State |
|---|---|---|---|
| Website crawl | 55 | 54 (98.2%) | healthy — 1 to 5 pages, 12 to 2,411 words |
| Google Maps / Places | 43 | 43 (100%) | healthy |
| Google search fallback | 5 | 5 (100%) | rarely needed |
| **Yelp** | **30** | **0** | **dead** |
| Brand TikTok channel | — | — | populated for 0 of 9 brands |
| Audience mentions | — | — | populated for **1 of 9 brands** |

**Yelp is blocked and should be treated as gone.** 30 lifetime attempts, zero
successes. Eight were explicit blocks; the rest were "no business results" for names
the search could not resolve. `yelp_review_count` is NULL on all 9 brands.

**The brand's own TikTok channel returned nothing for any brand.**
`tiktok_follower_count` is NULL on 9 of 9. `tiktok_engagement_rate` is populated for
exactly one (Glossier, 13.11). This has a scoring consequence — see §5.5.

**Audience mentions — the brand's received meaning — exist for one brand.**
autorama.ca has 12 mentions and a `positive` sentiment reading. The other eight
brands have none. This is the single thinnest part of the brand evidence, and it is
the part your model leans on hardest for the received side of the brand.

**[correction] — on Reddit.** I was given "Reddit needs OAuth" as a named
unavailable source. **There is no Reddit code in this repository at all** — not a
client, not a config key, not a disabled branch. It is not a blocked source; it is an
unbuilt one. The OAuth requirement is presumably why it was never built, but nothing
in the system is waiting on it.

## 2.5 Where a chain has one strategy, and where it never fires

**Single strategies with no fallback** — a failure here is total:

- TikTok video pool (`profile_xhr_scroll`) — the one currently failing.
- TikTok search augmentation (`search_xhr_scroll`).
- Instagram post pool (`slice(0, 12)`).
- Brand website crawl.

**Fallbacks that have never fired successfully:**

- `profile_html_direct` — 2 attempts, 0 successes, lifetime.
- The removed TikTok search-HTML leg — 38 attempts, 0 successes, before removal.
- `profile_rendered_text` on TikTok fires only when the embed leg fails, and the
  embed leg has never failed.

**Captured and discarded:**

- The duet, stitch and ad flags on every TikTok post — read off the platform and
  dropped before persistence, which is why `remixEnablementRate` and `adTagRate`
  cannot be recovered without a schema change (§2.3).
- Instagram bio.
- `content_items.region` — the column exists, is populated on **0 of 1,878** rows.
- `creator_observations.engagement_quality_score` — **0 of 32**.
- `creator_observations.niche_id` — **0 of 32**; the niche taxonomy table is unused.
- Music artist on Instagram — 0 of 347 (Instagram carries no music metadata).

---

# Part 3 — What reaches the engine

This is the important part. For every field the engine reads, this section states
where it comes from, how often it is really populated across the current corpus, and
what happens when it is absent.

The denominators: **32 current creator observations** and **9 current brand
observations**.

## 3.1 Creator side

| Field | Origin | Populated | On absence |
|---|---|---|---|
| Archetype | **Inferred** | 32/32 | defaults to *The Everyman* |
| Goffman stage consistency | **Inferred** | 32/32 | defaults to *Consistent* → **10/10** |
| Drift signal | **Inferred** | 32/32 | defaults to *Zero Change* → **9.5/10** |
| Stuart Hall decoding | **Inferred** | 32/32 | defaults to *Dominant* → **+0.5** |
| Rogers adopter stage | **Inferred**, from a computed rubric on TikTok | 32/32 | defaults to *Early Majority* → **7/10** |
| Turner liminal phase | **Inferred** | 32/32 | defaults to *Pre-Liminal* → **0** |
| Creator niche position | **Inferred** | 32/32 | defaults to *Consistent* |
| Barthes myth | **Inferred** | 32/32 | myth **and** tribe scores both collapse to **3.0** |
| Raw keywords / themes | **Inferred** | 32/32 | symbolic overlap → 0 |
| Cultural velocity | **Derived** from the temporal sample | **21/32** — 0/11 on Instagram | *Insufficient Data* |
| Data confidence level | **Derived** from transcript count | 32/32 | *low* |
| Engagement rate | **Derived** | **30/32** | contributes nothing |
| Follower count | **Measured** | 31/32 | contributes nothing |

**Every framework field is populated on every creator. None of them has ever been
absent. That is not a sign of health — it is the reason the defaults are invisible.**

Now look at what those always-populated fields actually contain:

| Field | Distribution across all 32 |
|---|---|
| **Goffman** | **Consistent 32. Minor Gap 0. Significant Gap 0.** |
| **Drift** | Zero Change 28. Minor Drift 4. Significant Drift 0. Full Pivot 0. |
| **Stuart Hall** | Dominant 23. Negotiated 9. **Oppositional 0.** |
| **Rogers** | Early Majority 25. Early Adopters 6. Late Majority 1. **Innovators 0. Laggards 0.** |
| **Turner** | Pre-Liminal 17. Liminal 11. Post-Liminal 4. |
| **Niche position** | Ahead 25. Consistent 7. **Behind 0.** |
| **Cultural velocity** | Drifting 14. Insufficient Data 7. **Focusing 0.** NULL 11 (all Instagram). |

Read the Goffman row again. **Every creator in the corpus is "Consistent."** Thirty-two
for thirty-two, across two platforms, from 357 followers to 162 million. A field with
three possible values that has taken one value 32 times is not measuring anything.
It scores 10 out of 10, every time, for everyone.

Instagram is starker still: 11 of 11 are *Consistent*, *Zero Change*, *Dominant*, and
*Ahead*. Four fields, four unanimous verdicts, on the platform that has no temporal
buckets to read them from.

## 3.2 Brand side

| Field | Origin | Populated | On absence |
|---|---|---|---|
| Brand archetype | **Inferred** | 9/9 | defaults to *The Everyman* |
| Brand type (→ weights) | **Inferred**, then table lookup | 9/9 | defaults to *Retail — Local Boutique* |
| Barthes myth | **Inferred** | 9/9 | myth and tribe both → **3.0** |
| Audience tribe | **Inferred** | 9/9 | prompt context lost |
| Cultural tension | **Inferred** | 9/9 | prompt context lost |
| Brand Goffman | **Inferred** | 9/9 | no stability blend |
| Brand drift | **Inferred** | 9/9 | no stability blend |
| Brand Stuart Hall | **Inferred** | 9/9 | no decoding blend |
| Brand Rogers | **Inferred** | 9/9 | no pulse blend |
| Brand Turner liminal | **Inferred** | 9/9 | no pulse blend |
| Brand keywords / themes | **Inferred** | 9/9 | symbolic overlap → 0 |
| **TikTok follower count** | Measured | **0/9** | follower stability boost never applies |
| **TikTok engagement rate** | Measured | **1/9** | pulse boost never applies |
| **TikTok post frequency** | Measured | **0/9** | pulse boost never applies |
| **Mention sentiment** | **Inferred** from mentions | **1/9** | no stability modifier |
| **Mention hashtags / keywords** | **Inferred** | **1/9** | vocabulary boost = 0 |
| Google review count | **Measured** | 6/9 | performance signals lose a term |
| Yelp review count | Measured | **0/9** | performance signals lose a term |

Brand distributions:

| Field | Distribution across all 9 |
|---|---|
| Brand Goffman | Consistent 4. Minor Gap 3. Significant Gap 2. |
| Brand drift | Zero Change 8. Minor Drift 1. |
| Brand Stuart Hall | Dominant 6. Negotiated 3. |
| Brand Rogers | Early Majority 7. Early Adopters 2. |
| **Brand Turner** | **Pre-Liminal 9.** Liminal 0. Post-Liminal 0. |

The brand side has *more* variance than the creator side on Goffman — four Consistent,
three Minor Gap, two Significant Gap. The brand's identity stability is being read;
the creator's is not.

Brand Turner is unanimous, so the brand's liminal contribution to Pulse is always
exactly zero.

## 3.3 What the engine did with all of that — the eight live matches

| Creator × Brand | Align | Pulse | Stab | Score | Verdict |
|---|---|---|---|---|---|
| zachking × nike.com | 8.00 | 7.0 | 8.5 | **7.70** | Green Light |
| zachking × bludental.ca | 5.33 | 7.0 | 9.8 | **6.56** | Proceed with Caution |
| markrober × autorama.ca | 6.83 | 7.0 | 10.0 | **7.52** | Green Light |
| olga.popovaa × Reset Wellness | 8.83 | 6.6 | 9.8 | **8.58** | Green Light |
| kourosh.zz × Lululemon | 1.83 | 7.3 | 7.3 | **5.11** | Do Not Proceed |
| kaylee.nhi × Senso Café | 8.17 | 6.6 | 7.9 | **7.64** | Green Light |
| kaylee.nhi × Glossier | 8.33 | 7.0 | 7.3 | **7.73** | Green Light |
| sarrrrrr68 × Lululemon | 2.50 | 7.0 | 7.3 | **5.26** | Do Not Proceed |

Now the columns that never moved:

- **Goffman score: 10.0 on all eight.**
- **Drift score: 9.5 on all eight.**
- **Rogers base: 7.0 on all eight.**
- **Liminal adjustment: 0 on seven of eight.**
- **Symbolic vocabulary overlap: 0.0 on five, 0.3 on three.** Never above 0.3 out of 10.
- **Mention vocabulary boost: 0.00 on all eight.**
- Mention sentiment modifier: +0.5 once, 0 on the other seven.

**Stability is a constant.** Every creator contributes exactly (10 + 9.5) ÷ 2 = 9.75
to it. The only reason the Stability column varies at all across those eight rows is
the *brand's* Goffman and drift, blended 50/50. The creator half of Partnership
Stability has never once differed between two creators.

**Alignment is the only sub-score doing work**, and within Alignment only three of six
components have ever moved the number.

---

# Part 4 — The model calls

Every call goes to **`gemini-2.5-flash`** through one shared client. Ten purposes are
logged. **803 calls** in the corpus, **9 failures**.

## 4.1 Creator analysis — three calls per run

| Purpose | Calls | Evidence in | Returns | Goes to |
|---|---|---|---|---|
| `content_theme_extraction` | 194 | video titles and captions | theme labels | `content_theme_labels`, symbolic overlap |
| `creator_symbol_decoding` | 187 | transcripts, captions, hashtags | symbolic vocabulary, community references, decoded signals | `decoded_signals` (611 rows), and the evidence block for the next call |
| `creator_profile_extraction` | 183 | the whole assembled evidence block, ~6.5k tokens | **24 fields** — archetype, Barthes myth, Goffman, drift, Stuart Hall, Rogers, Turner, niche position, cultural capital, parasocial bond, tone register, lifecycle | `creator_observations` — i.e. **every framework field in §3.1** |

`creator_profile_extraction` is the call that produces your model's vocabulary. It has
no fallback profile: on failure it retries once, then the run fails. Nothing fabricated
is written by this path.

Two things about it you should know. First, on TikTok the prompt contains a
pre-computed block of engagement labels with the instruction *"use these values
directly … do not override them with your own estimate"* — so for parasocial bond,
audience relationship, cultural capital, remix and brand saturation, the model is
being told to copy a rubric, not to judge. Second, **that block does not exist on
Instagram**, so on Instagram the same five fields are free estimates from thin
evidence — and they land in the same columns, indistinguishable.

## 4.2 Brand analysis — four calls per run

| Purpose | Calls | Evidence in | Returns |
|---|---|---|---|
| `brand_profile_extraction` | 44 | crawl text, reviews, snippets, ~7.4k tokens | archetype, classification, myth, tribe, tension, tone, and the nine brand-side framework fields |
| `brand_symbol_decoding` | 44 | crawl + review text | brand symbolic vocabulary, themes |
| `brand_instagram_voice_analysis` | 27 | the brand's own IG posts | voice and tone reading |
| `brand_channel_analysis` | 8 | the brand's own TikTok channel | channel posture |
| `brand_mention_analysis` | 8 | audience mention videos | **sentiment, hashtag cloud, audience keywords, music** |

`brand_mention_analysis` is the only call that reads the brand's *received* meaning
rather than its *projected* meaning. It has run 8 times and produced a stored result
for **one brand**.

## 4.3 Match scoring — four calls per match

| Purpose | Calls | What it receives | What it returns | Where it goes |
|---|---|---|---|---|
| `myth_tension_analysis` | 27 | both Barthes myths, tone registers, audience relationship, cultural capital, both decodings, and semantic keyword context | **`mythAlignmentScore` and `tribMatchScore`, 0–10 each** | **two of the three inputs to Alignment** |
| `cultural_synergy_analysis` | 27 | both profiles, shared signals, all scores | a 120–200 word partnership brief and three content directions | report sections 1 and 2 |
| `fit_narrative_generation` | 27 | scores, warnings, archetypes, myths | narrative summary and six alignment notes | report |
| `cultural_borrowing_analysis` | 27 | archetypes, tone, parasocial bond, myths, sentiment, shared keywords, music overlap | 2–3 sentences on what the brand borrows culturally | report — **the only free-text call, no schema** |

`myth_tension_analysis` is the highest-leverage model output in the entire system.
Two of the three numbers averaged into Alignment come from a single call, and
Alignment carries α = 0.4 to 0.6 of the final score. Its median output is 16 tokens.

**The synergy and borrowing prompts are explicitly forbidden from using your
vocabulary.** Both list your theorists by name — Barthes, Goffman, Stuart Hall,
Bourdieu — and instruct the model never to say them. That is a deliberate product
choice for a business-owner reader. It is worth you knowing that the analyst-facing
prose is a translation away from your model, not an expression of it.

## 4.4 Transcription — invisible in every cost view

Transcription does **not** go through the shared client. It is a direct call to
Gemini's `generateContent` endpoint, and it therefore writes **no invocation row**.

**334 transcription attempts exist in the corpus** — 176 recorded against Instagram,
158 with no platform recorded — and **not one of them appears among the 803 logged
model calls.** Every audio payload is base64-encoded inline, so a 15 MB reel is a
20 MB request body. These are, by payload size, by far the most expensive calls the
system makes, and section 5 of the match report — "Cost and process" — cannot see
them.

There is a second labelling problem stacked on top. The engine that runs is chosen by
which API key is present: with no OpenAI key, transcription runs on **Gemini audio**,
not Whisper. The key has been absent, so **every Instagram transcript in this corpus
came from Gemini** — while the telemetry method reads `whisper_transcription` and the
failure text reads `transcript whisper: FILE_TOO_LARGE`. The label names a path that
was not running. The enum value is shared by both engines by design; the real engine
is now published separately so the row can name it, but the historical rows say
Whisper.

---

# Part 5 — Where plumbing and science disagree

Each item: what your model intends, what the system does, and the live evidence.

## 5.1 The six Alignment components — three have never contributed

**Your model intends** Alignment to be a composite: archetype compatibility, mythic
alignment, tribe match, audience decoding on both sides, symbolic vocabulary, and the
audience's own language about the brand.

**The system computes** six components. Here is each one's record across all 8 matches:

| # | Component | Ever moved a score? | Evidence |
|---|---|---|---|
| 1 | Archetype match | **Yes** | ranged 2.5 to 7 |
| 2 | Myth alignment (model) | **Yes** | ranged 2 to 9 |
| 3 | Tribe match (model) | **Yes** | ranged 1 to 9 |
| 4 | Creator Stuart Hall decoding | **Yes** | +0.5 twice |
| 5 | Brand Stuart Hall decoding (blend) | **Yes — by suppression only** | see below |
| 6 | Audience-mention vocabulary boost | **No. 0.00 on 8 of 8.** | |

Component 5 has never *raised* a score; it has only lowered one. kaylee.nhi reads
*Dominant* and Glossier reads *Negotiated*, so the blend returns *Negotiated* and the
+0.5 is cancelled — Alignment 8.33 instead of 8.83. Same mechanism on kourosh.zz ×
Lululemon. A component whose only observed effect is to remove a bonus is worth a
ruling on its own.

Component 6 cannot fire, because it needs brand mention hashtags and only one brand
in the corpus has any.

And note what is **not** in Alignment at all: the symbolic vocabulary overlap. It is
computed, it is stored, it feeds PARR — but it is not an Alignment term. Its values
across the eight matches were 0.0, 0.0, 0.0, 0.3, 0.0, 0.3, 0.3, 0.0. Out of ten.

## 5.2 Confidence counts transcripts while the capture is blind

**Your model intends** a confidence level to say how far to trust a reading of a
creator.

**The system computes** it from one number: how many transcripts came back.
Six or more → `high`. Three to five → `medium`. Fewer → `low`. Nothing else enters.

**The evidence.** On the most recent audited run, `chriswillx` and `drjudithjoseph`
were both stored at **`high` confidence** on runs where the profile capture returned
**zero videos** and every single item came from search. Their capture health was
recorded — correctly — as `degraded`. Two fields on the same observation say opposite
things, and the one that reaches the engine is the optimistic one.

Worse, the count includes captions. Of 257 stored transcripts, **79 are written
captions, not speech** (40 TikTok, 39 Instagram). A creator can reach `high`
confidence on six captions without the system ever having heard them speak.

Capture health is explicitly barred from feeding scoring or confidence. That was a
deliberate separation, and it means the honest signal is the one that goes nowhere.

## 5.3 The 3.0 fallback

**Your model intends** myth and tribe alignment to be judgments about two cultural
narratives.

**The system** falls back to **3.0 for both** when either Barthes myth sentence is
missing, or when the model call fails. 3.0 is not neutral — on a 0–10 scale where the
observed range is 1 to 9, it is a firmly negative judgment, and it is being asserted
where no judgment was made.

Because myth and tribe are two of the three averaged terms, a double fallback drags
Alignment toward (archetype + 3 + 3) ÷ 3. With a complementary archetype of 7, that is
**4.33 — an automatic "Low Alignment" warning and a capped verdict**, produced by
absence rather than by evidence.

**The good news:** none of the current 8 matches is degraded. `score_degraded` is
false on all eight, and the reasons column is empty. The marker exists, it is
persisted, and it renders on both surfaces. The problem is historical (§6) and
structural, not currently active.

## 5.4 Thin data defaults to the most favourable values

**Your model intends** Goffman stage consistency and drift to detect a creator whose
front-stage persona is fracturing, or whose identity is pivoting.

**The system**, when those fields are missing, substitutes *Consistent* (10/10) and
*Zero Change* (9.5/10) — the two highest values each field can take. Missing evidence
is scored as a perfect performance.

**The evidence** is that we never reach the fallback, because the model always fills
the field — and it always fills it the same way. **32 of 32 creators are Consistent.**
28 of 32 are Zero Change. Instagram, which has no temporal buckets to read consistency
from at all, is 11 of 11 on both.

The downstream effect is measurable: the **Identity Instability** warning fires on
*Full Pivot* or *Significant Gap*. Neither value has ever been assigned to a creator.
That warning is unreachable.

So is **Trajectory Divergence**, which fires when a creator is *Behind* their niche.
Niche position is Ahead 25, Consistent 7, Behind 0.

Across 8 matches, only two warning types have ever fired: **Low Alignment (3)** and
**Archetype Tension (2)**. The other five have never fired once.

## 5.5 The Pulse and Stability boosts are unreachable

**Your model intends** a brand's own cultural momentum to lift Pulse, and a large
engaged brand audience to lift Stability.

**The system** requires, for the Pulse boost, that the brand's TikTok engagement rate
**and** post frequency both be known. Post frequency is populated for **0 of 9**
brands. Engagement rate for 1 of 9. The boost is doubly unreachable.

For the Stability boost it requires a brand follower count above zero — NULL on
**9 of 9**. The engagement-rate half of that boost sits *inside* the follower check,
so Glossier's known 13.11% rate contributes nothing either.

Both boosts have fired **zero times**. Their code is live, tested, and inert.

## 5.6 The temporal sampler

**Your model intends** a 6-3-3 stratified sample — 6 recent, 3 from around nine
months back, 3 from around eighteen months back — so drift and consistency compare
like with like across time.

**The system** does sort by post date, and the three windows are real. Two things
break it.

**First, the buckets are spaced by position, not by time.** Within each window it
picks indices 0, n/3, 2n/3 from a recency-ordered list. If a creator posted 40 videos
in one month of the window and 2 in another, all three "evenly spaced" picks land in
the busy month. The spacing is even in *count of posts*, not in *elapsed time*.

**[correction]** I was given this as "bucketing by view-count position." The ordering
is by post date, not by views — but the *selection within* each window is positional,
and that is the defect. Nothing sorts by view count anywhere in the sampler.

**Second, and worse: fill-forward produces an anchor newer than the mid bucket.**
When a window comes up short, both mid and anchor are filled from the same
oldest-first remainder — and **mid fills first**, taking the genuinely old videos.
Anchor then takes what is left, which is newer.

Live evidence, from the corpus:

| Creator | Mid bucket span | Anchor bucket span | |
|---|---|---|---|
| chriswillx | 2023-05-05 → 2025-12-22 | **2026-02-09 → 2026-05-11** | anchor entirely newer |
| charlidamelio | 2026-03-21 → 2026-05-10 | **2026-05-10 → 2026-05-11** | anchor newer |
| khaby.lame | 2023-07-19 → 2025-11-08 | **2026-02-27** | anchor newer |

Sixteen creators in the corpus have both a mid and an anchor bucket. **Three of those
sixteen have an "18-month historical anchor" that is entirely newer than their
"9-month mid."** charlidamelio's whole pool spans four months — her anchor is two
months old.

**Nothing on the row marks a bucket as filled forward.** Every downstream consumer
reads a two-month-old video as that creator's historical anchor. Drift and cultural
velocity are computed from exactly this comparison.

## 5.7 The campaign modifier is computed and never applied

**Your model intends** a Long-Term Ambassador campaign to weight stability higher
(γ +0.1, β −0.1) and a Product Launch to weight momentum higher (β +0.1, γ −0.1).

**The system** applies that modifier when the brand profile is saved, and stores the
modified weights on the brand. At **scoring time** it looks the weights up from the
table again **without passing the campaign type**, so the modifier is silently
dropped.

The brand's stored weights and the weights used for its score can differ by ±0.1 on
β and γ. Every campaign is effectively scored as though it had no campaign type.

## 5.8 The alignment narrative always says "weak"

**Your model intends** the one-line narrative to characterise the archetype pairing.

**The system** compares the archetype score against thresholds of 80 and 60 — on a
scale that runs **0 to 10**. Ten is not greater than eighty. Every narrative therefore
opens with "weak."

**All 8 stored narratives open "Both entities share a weak archetype alignment"** —
including zachking × nike.com, whose archetype score is 7 (Complementary), and
including pairs the engine itself rates Resonant at 10.

## 5.9 The "success" keyword rule

**Your model intends** the Receptivity Fit signal to estimate whether an audience will
receive the partnership as legitimate.

**The system** adds **+10 points out of 100** when both the creator's and the brand's
Barthes myth sentences contain the literal substring `"success"`. Case-insensitive
substring match. No synonym, no concept, no semantic check — the word, or nothing.

A myth about "succeeding against the odds" scores. A myth about triumph, achievement
or mastery does not. This is a semantic claim implemented as a text search, and it is
worth 10% of that signal.

## 5.10 Engagement rate is a mean of per-post ratios over an arbitrary pool

**Your model intends** engagement rate to describe how a creator's audience behaves.

**The system** computes it differently on each platform, from a pool whose size is an
artefact of what the scraper happened to retrieve:

- **TikTok:** the mean of (likes ÷ views) plus the mean of (comments ÷ views), across
  every video in the pool. When the pool has no per-video stats it falls back to
  average views ÷ followers, which is not an engagement rate at all.
- **Instagram:** mean likes ÷ followers. A different quantity with the same name.

The pool size is not a design decision. On TikTok it is however many videos search
happened to return — 2 for one creator, 16 for another. On Instagram it is exactly 12.
A creator with 2 sampled videos and a creator with 100 produce numbers in the same
column and are compared directly.

The results show the strain: **three of 32 creators exceed 20%**, including one at a
clamped **100.0** and one at 41.0. Two are NULL — and one of those is a zero that was
coerced to NULL by a falsy check, so the largest Instagram account in the corpus
silently has no engagement metric at all.

These two formulas are deliberately different, for a defensible reason each — but
they are never unified, and nothing on screen says which one produced the number.

## 5.11 Instagram takes the defaults because it has no temporal buckets

This is the compounding of §5.4 and §5.6, and it deserves naming on its own.

Instagram samples no temporal buckets — 147 of 147 items are `unbucketed`. There is
therefore no recent-versus-historical comparison from which to read Goffman
consistency, drift, or cultural velocity.

The result, across all 11 Instagram creators:

- Goffman: **Consistent, 11 of 11** → 10/10.
- Drift: **Zero Change, 11 of 11** → 9.5/10.
- Stuart Hall: **Dominant, 11 of 11** → +0.5.
- Niche position: **Ahead, 11 of 11**.
- Cultural velocity: **NULL, 11 of 11**.

Every Instagram creator in the corpus contributes an identical, maximal 9.75 to
Stability and an identical +0.5 to Alignment — not because they were assessed and
found consistent, but because there was nothing to assess and the defaults are
generous.

**A TikTok creator's Stability and an Instagram creator's Stability are not the same
measurement, and the scores are not comparable.** Nothing on the report says so.

## 5.12 Quality of View uses the wrong Cultural Match Score

QoV = (CMS ÷ 10) × (PARR ÷ 100) × 100. It uses the **pre-modifier** CMS, computed
before the mention sentiment and vocabulary adjustments. When either modifier is
non-zero, the QoV on screen is not the product of the CMS on screen and the PARR on
screen.

It fired once in the corpus — markrober × autorama.ca, where positive sentiment added
+0.5 to Stability. QoV also contains no information beyond CMS and PARR, and measures
no actual viewing.

## 5.13 The weight priority is computed and thrown away

The engine returns a `weightPriority` string for every match — "Trust + safety",
"Cultural momentum", "Community identity". It is passed into the narrative prompt.
There is **no column for it on the match record**, so it is not stored and cannot be
retrieved for a saved match. The same is true of the shared music titles and artists
in their raw form; only the strength label survives.

---

# Part 6 — What changed since you last saw it

**Read this before you compare any new score to your intuitions from the web
version.**

## 6.1 The scores you validated were computed on a broken Alignment

On the web version, brand symbols and the brand's Barthes myth were extracted by the
model and **never stored**. Because the myth-and-tribe call requires *both* Barthes
myth sentences to exist, and the brand's did not, that call never ran. Both scores
fell to the 3.0 fallback.

**That means two of the three components averaged into Alignment were the constant
3.0 on every score you saw.** Alignment reduced to (archetype + 3 + 3) ÷ 3 — a
number driven almost entirely by the 12×12 archetype matrix, with the mythic and
tribal judgments contributing a fixed penalty rather than a reading.

Your intuitions were calibrated against that. **Do not carry them forward
unadjusted.** A pair that scored poorly then may score well now for reasons that have
nothing to do with your model changing.

**It is fixed.** Brand Barthes myth is populated on **9 of 9** brands. Brand decoded
symbols exist for all 9 (308 stored signals). The myth-and-tribe call has run 27
times without a single failure, and across the 8 stored matches it returned real
spread — myth 2, 2, 4, 5, 8, 8.5, 9, 9; tribe 1, 3, 5, 7, 9, 9, 9, 9. **None of the
current 8 matches is degraded.**

## 6.2 Brand evidence changed materially in three other ways

- **The nine brand-side framework fields now exist and are blended into scoring.**
  Brand Goffman and drift blend 50/50 into Stability; brand Rogers and Turner blend
  40/60 into Pulse; brand Stuart Hall blends into the decoding modifier. On the web
  version, Stability and Pulse were creator-only. This is why brand identity
  instability now visibly moves a score — kaylee.nhi × Glossier lands at 7.3
  Stability instead of 9.75 purely because Glossier reads *Significant Gap*.
- **Yelp is gone.** It was contributing review evidence; it now contributes nothing,
  0 for 30. Brand perception now rests on Google reviews (6 of 9 brands) and the
  crawl.
- **All prior brand data was purged on 2026-07-29** and re-gathered. The 9 brands you
  see are new observations, not the ones you scored against.

## 6.3 The four sociological fields moved from prose to computation

`parasocialBondStrength`, `audienceRelationshipType`, `culturalCapital` and
`remixRate` were free model prose. They are now computed from TikTok engagement
signals by fixed rubric, and the extraction prompt orders the model to copy the
computed label verbatim rather than judge.

**Two consequences.** First, these fields are now reproducible and no longer drift
between runs. Second — and you should weigh this — **the rubric only exists on
TikTok.** On Instagram the same four fields are still free estimates from thin
evidence, stored in the same columns with no marker. A parasocial bond of 5 read from
a TikTok comment rate and a parasocial bond of 5 guessed from an Instagram caption are
the same value in the same column.

The corpus shows the asymmetry plainly: **8 of 11 Instagram creators read parasocial
bond at exactly 5.0** — the top of the scale — against a spread of 1.0 to 5.0 on
TikTok where the rubric applies.

## 6.4 Other changes worth a line

- YouTube was disabled entirely on 2026-07-26. Two platforms remain.
- Instagram gained a caption fallback for transcripts (39 of 39 successful) — so
  Instagram transcript counts now include captions, as TikTok's already did.
- Instagram transcription now extracts the audio track before sending, rather than
  uploading whole video files.
- A degradation marker (`score_degraded` plus reasons) is now persisted on every
  match and rendered, so a fallback-driven score is distinguishable from a computed
  one. This did not exist on the web version.

---

# Part 7 — The questions

Every open item as something you can rule on. Grouped by theme.

## Theme A — Fields that assert what they did not measure

### A1. Should a missing framework field score maximally, or refuse?

**What it is.** Goffman missing → *Consistent* → 10/10. Drift missing → *Zero Change*
→ 9.5/10. Stuart Hall missing → *Dominant* → +0.5.

**Why it matters.** Absence of evidence is currently scored as evidence of excellence,
in the two fields that constitute your entire Stability term.

**If you rule "refuse":** thin creators stop being scored on Stability, and some
matches return no score at all rather than an inflated one.
**If you rule "keep":** the behaviour is frozen, and we mark it on screen instead.

**Evidence.** 32 of 32 creators are Consistent; 28 of 32 are Zero Change; Goffman
scored 10.0 and drift 9.5 on all 8 matches.

### A2. Is a field with zero variance still a field?

**What it is.** Goffman has taken one of its three values 32 times out of 32.

**Why it matters.** It contributes a constant to every score, which means it changes
no ranking and carries no information — while occupying half of Stability and 10% of
PARR.

**If you rule "it is broken":** it needs a different derivation or it should be
removed from the weighting until it has one.
**If you rule "the corpus is just consistent":** we need a creator we both expect to
read *Significant Gap*, run them, and see.

### A3. Should the Instagram fields be marked, gated, or dropped?

**What it is.** Instagram has no temporal buckets, so Goffman, drift and cultural
velocity have nothing to read. All four framework fields come back unanimous, and
cultural velocity comes back NULL.

**Why it matters.** TikTok Stability and Instagram Stability are different
measurements sharing a column, and the report compares them directly.

**Three ways you can rule.** Mark them (a provenance flag on screen), gate them
(Instagram creators score no Stability), or accept them.

**Evidence.** 11 of 11 Instagram creators: Consistent, Zero Change, Dominant, Ahead.
147 of 147 Instagram items unbucketed.

## Theme B — The parasocial matrix

### B1. Complete on TikTok, or uniform across both?

The question has changed since the first draft, because two of the six signals moved
from *unavailable* to *available*. Save rate and share rate are **live on TikTok
today** — derived on demand from the per-post columns, across all 25 TikTok
observations, with no re-run needed (§2.3). The old framing of "impossible" was
wrong; the honest framing is a platform asymmetry you now have to rule on.

| Signal | Status | Detail |
|---|---|---|
| Like rate | **Available, both platforms** | derived per observation |
| Comment rate | **Available, both platforms** | derived per observation |
| **Save rate** | **Available on TikTok. Absent on Instagram.** | reads `null` on Instagram, never 0 |
| **Share rate** | **Available on TikTok. Absent on Instagram.** | reads `null` on Instagram, never 0 |
| Reply / community language | Available, both platforms | reads decoded signals, which are sound |
| Persona consistency | **Available but inert** | reads Goffman — 32/32 identical (A2) |

**The TikTok data is real and it discriminates.** Across the 21 TikTok observations
with a computable rate, the save rate spans **1.4767% (@chriswillx) down to 0.0410%
(@khaby.lame) — a 36× range**, with a genuine floor at **0.0000% (@lynlecheung**,
21 posts with views and not one save). Share rate spans **1.0054% (@alkvlogs) to
0.0147% (@khaby.lame), a 68× range.** These are not noise: the two highest save
rates in the corpus belong to a men's-advice creator and a psychiatrist — formats an
audience files away to return to — and the lowest belongs to silent visual comedy
nobody needs to keep. That is the signal your model predicts, showing up.

*(An earlier note in this section quoted a save-rate comparison involving
@nadinebaggott. She is an Instagram creator and has no save rate at all — the figures
above are the real TikTok spread, read from the corpus.)*

**The two dead signals are unchanged, and they are the ones that should worry you.**
Persona consistency reads Goffman, which is *Consistent* on 32 of 32 creators — a
signal that cannot vary is not a signal. Anything reading drift or niche position
inherits the same problem (A1, A2).

**The question for you.** Two shapes, and the trade is coverage against
comparability:

- **Complete on TikTok, degraded on Instagram** — six signals where the data allows,
  four where it does not. Richer on the platform we hold most of, but a TikTok
  creator and an Instagram creator are no longer scored on the same instrument, and
  every comparison between them carries a hidden asymmetry.
- **Uniform across both** — limited to like rate, comment rate and community
  language. Poorer, but a number means the same thing wherever it came from.

There is a third option if you want it: build the full matrix, and have the
Instagram-blind signals report *not measured* on the surface rather than quietly
dropping out of an average. That keeps the coverage and makes the asymmetry visible
instead of silent, which is the pattern the rest of this document keeps asking for.

## Theme C — Time

### C1. Is a two-month-old video an acceptable historical anchor?

**What it is.** When the pool is thin, the anchor bucket is filled forward from
whatever is left after the mid bucket has taken the oldest videos — so the anchor can
be, and often is, newer than the mid.

**Why it matters.** Drift, Goffman consistency and cultural velocity are all
computed by comparing these buckets. When the anchor is newer than the mid, that
comparison is running backwards.

**If you rule "refuse":** a creator without genuine 18-month depth gets no drift
reading, and cultural velocity returns *Insufficient Data* far more often.
**If you rule "fill but mark":** the row carries a flag and the report says
"historical anchor unavailable — sampled from N months".

**Evidence.** chriswillx: mid 2023-05 → 2025-12, anchor **2026-02 → 2026-05**.
charlidamelio: whole pool spans four months, and still has all three buckets.
khaby.lame: mid runs to 2025-11, anchor is **2026-02-27**.

### C2. Should the mid and anchor picks be spaced by time or by post count?

**What it is.** Within each window the sampler picks indices 0, n/3, 2n/3 from a
date-ordered list. Even spacing by *number of posts*, not by *elapsed time*.

**Why it matters.** A creator with a posting burst gets all three "spread" samples
from inside the burst.

**If you rule "by time":** the picks become genuinely stratified and the sample
represents the window.

## Theme D — Confidence and trust

### D1. Should confidence know about capture health?

**What it is.** Confidence counts transcripts and nothing else. Capture health knows
the profile capture failed. They never speak.

**Why it matters.** Two creators were stored at `high` confidence on runs where we
never saw their body of work.

**If you rule "combine":** confidence caps at `medium` when capture health is
degraded, and at `low` when it is thin.

**Evidence.** chriswillx and drjudithjoseph — `high` confidence, `degraded` capture,
zero videos from the profile.

### D2. Should a written caption count toward confidence as a transcript?

**What it is.** 79 of 257 stored transcripts are captions, not speech. All count
equally toward the ≥6 → `high` threshold.

**Why it matters.** Your extraction prompt calls transcripts *ground truth*. A caption
is the creator's marketing copy, not their voice — and the confidence metric cannot
tell them apart.

**If you rule "weight them":** a caption counts as half, or not at all, and several
creators drop a confidence tier.

## Theme E — The engine's own arithmetic

### E1. Is 3.0 the right fallback for an uncomputed myth score?

**What it is.** A missing Barthes myth or a failed call sets both myth and tribe to
3.0. On the observed range of 1–9, that is a negative verdict asserted where no
verdict was reached.

**If you rule "refuse":** the match returns no score. **If you rule "neutral":** 5.0.
**If you rule "keep 3.0":** it stands, marked as degraded — which it now already is.

### E2. Should the campaign modifier be applied at scoring time?

**What it is.** Long-Term Ambassador and Product Launch modifiers are applied when a
brand is saved and dropped when it is scored. The stored weights and the used weights
disagree by up to ±0.1 on β and γ.

**Why it matters.** Campaign type currently has no effect on any score.

### E3. Should the brand's decoding be able to suppress the creator's?

**What it is.** When creator and brand decodings differ, the blend returns
*Negotiated* — cancelling the creator's +0.5. It has never raised a score, only
lowered two.

**If you rule "asymmetric is correct":** it stands. **If you rule "average them":**
mixed pairs land at +0.25 rather than 0.

**Evidence.** kaylee.nhi (Dominant) × Glossier (Negotiated) → 8.33 instead of 8.83.

### E4. Should "success" as a substring be worth 10 points?

**What it is.** Receptivity Fit adds 10 of 100 when both myth sentences contain the
literal word.

**If you rule "remove it":** one line. **If you rule "keep the concept":** it needs
the model to judge shared aspiration, not a text search.

### E5. Should the alignment narrative be fixed or removed?

**What it is.** It compares a 0–10 score against thresholds of 80 and 60, so every
narrative says "weak."

**Evidence.** All 8 stored narratives open "weak archetype alignment", including a
Complementary 7 pairing.

### E6. Is Quality of View worth keeping?

**What it is.** CMS × PARR, using the pre-modifier CMS so it disagrees with the two
numbers displayed beside it. It contains no information beyond its two inputs and
measures no viewing.

## Theme F — Reach and comparability

### F1. Are two engagement-rate formulas acceptable under one label?

**What it is.** TikTok computes a mean of per-post interaction ratios; Instagram
computes mean likes over followers. Both are stored in one column and displayed under
one name.

**Why it matters.** Three of 32 creators exceed 20%, one is clamped at 100.0, and one
Instagram account has NULL because a real zero was coerced away.

**If you rule "separate them":** two columns, two labels, and cross-platform
comparison stops silently happening.

### F2. Is 12 Instagram posts enough to read a creator?

**What it is.** A hard slice with no fallback. NatGeo publishes 32,000 posts; we read
12.

**Why it matters.** Every Instagram framework field is inferred from those 12 posts.

### F3. Should a search-only pool be scoreable at all?

**What it is.** TikTok's profile video endpoint is currently 403-walled — 0 of 16
attempts on 2026-07-31. Every TikTok pool is coming from search augmentation, which
was built as a supplement.

**Why it matters.** Pools fell from 27–146 videos to 2–16, and creators still commit
at `high` confidence.

**If you rule "refuse":** TikTok analysis largely stops until the capture path is
restored. **If you rule "proceed":** the reports must say the pool was search-derived.

## Theme G — Visibility

### G1. Should transcription appear in the cost view?

**What it is.** 334 transcription attempts, none logged, none costed, none visible in
report section 5 — while being the largest payloads the system sends.

**If you rule "yes":** transcription routes through the shared client or writes its
own invocation rows, and the cost view becomes true.

### G2. Should the brand's received meaning be required?

**What it is.** Audience mentions — the only evidence of how a brand is actually
received — exist for **1 of 9 brands**. Yelp, the other received-meaning source, is
dead. For eight of nine brands, every stored judgment rests on what the brand says
about itself.

**Why it matters.** Your model treats projected and received meaning as distinct. In
practice we hold only the projected side for 89% of brands, and nothing on the report
says so.

---

## Footnotes — code references

Formulas and behaviours cited above, with their defining location.

1. Alignment, Pulse, Stability, weights, PARR, QoV, warnings — `server/fitEngine.ts`.
   Alignment `:405-413`; Pulse `:423-441`; Stability `:451-471`; final score and the
   Alignment cap `:480-503`; warnings `:534-580`; PARR `:653-695`; symbolic overlap
   `:588-624`; the full entry point `:813-1049`.
2. The 3.0 fallback and every creator/brand default at scoring time —
   `server/routers.ts:1897-1898`, `:1907-1909`, `:1939-1982`.
3. Campaign modifier computed but not applied — `server/fitEngine.ts:320-351`
   (modifier), `:814` (`getBrandWeights(input.brandType)` called without campaign type).
4. Alignment narrative thresholds — `server/fitEngine.ts:1000-1009`.
5. QoV uses the pre-modifier score — `server/fitEngine.ts:994`.
6. `weightPriority` computed, passed to the narrative, never persisted —
   `server/routers.ts:2120` against the `insertMatchScore` call at `:2188-2240`.
7. Data confidence from transcript count alone — `server/webResearch.ts:2078-2081`.
8. Capture health barred from scoring and confidence — `server/db.ts:851`, `:2664`.
9. The 6-3-3 sampler, positional spacing and fill-forward —
   `server/webResearch.ts:914-1023`; mid fill `:972-986`, anchor fill `:988-1003`.
10. The eight engagement rates as the collection pipeline computes them —
    `server/webResearch.ts:1282-1326`; their appearance in the prompt `:2205-2219`.
    Derived for retrieval in `server/engagementRates.ts`, called from the creator
    read path in `server/db.ts`; the Instagram save/share constants that make the
    platform gate necessary are `server/phases/platformTools.ts:503-505`.
11. Engagement rate formulas — `server/phases/platformTools.ts:456-461` (TikTok),
    `:863-869` (Instagram).
12. Instagram `unbucketed` — `server/phases/platformTools.ts:653-665`.
13. Instagram posts hard-sliced to 12 — `server/scraping/instagram/profileScraper.ts:870`, `:1299`.
14. The `"success"` substring rule — `server/performanceSignals.ts:334-340`.
15. Every model call goes to `gemini-2.5-flash` through one client —
    `server/_core/llm.ts:304`; invocation logging `:316-344`.
16. Transcription bypasses that client and writes no invocation row —
    `server/_core/voiceTranscription.ts:573-599`; engine selection `:57-59`, `:299-301`.
17. The ten logged purposes — `server/aiExtraction.ts:202`, `:537`, `:671`;
    `server/symbolDecoder.ts:130`; `server/brandSymbolDecoder.ts:207`;
    `server/brandTikTokAnalysis.ts:455`, `:763`; `server/brandInstagramAnalysis.ts:216`;
    `server/webResearch.ts:345`; `server/routers.ts:1843`, `:2014`, `:2130`.
18. The review gate — `client/src/components/ReviewGate.tsx`; the matching
    precondition `server/routers.ts:1782-1787`.
19. Brand as a non-platform subject — `server/phases/brandPhases.ts:1-41`,
    `server/phases/brandEvidence.ts:1-32`, `docs/BRAND_PSEUDO_PLATFORM.md`.
20. The five report sections — `client/src/components/MatchReportBody.tsx:642`, `:718`,
    `:850`, `:918`, `:1023`.

Prior documents this one draws on and does not replace: `TECHNICAL_CALCULATIONS.md`
(the formulas, transcribed from code), `docs/DATA_GATHERING_AUDIT_2026-07-30.md` (the
ten-creator re-run, stage by stage), `docs/CREATOR_PIPELINE_AUDIT.md` and
`docs/PIPELINE_REFERENCE.md` (the prompts, verbatim).
