# Brand pipeline — open questions and logged findings

## Logged, not fixed — observability and identity (from the live acceptance run)

These were found running Glossier through the queue end to end
(`8ccc74a0-a3f6-47d2-9368-b477abcc9372`, 2026-07-27). They are recorded here so
they are not rediscovered; none is scheduled.

### F4 — the brand website crawl records no `scrape_event`

`researchBrand` called `insertScrapeEvent({scrapeMethod: "website_crawl", …})`
around its crawl. `makeBrandCapturePhase` calls `crawlBrandWebsite` directly and
does not. In the live run the crawl fetched **5 pages / 2411 words** and produced
**zero** scrape events, so capture-health and the run diagnostics panel lose the
single most important brand source entirely. Every other source was recorded
(TikTok profile + videos, mention searches, Instagram, Google Maps, Yelp).

### F5 — Yelp logs under `scrape_method: website_crawl` (pre-existing)

`reviewResearch`'s Yelp fetch records itself as `website_crawl`. In the live run
the only `website_crawl` row pointed at
`https://www.yelp.com/search?find_desc=…` with HTTP 403 — so the one event that
looks like the brand's own crawl is in fact the Yelp attempt. F4 and F5 compound:
the method is simultaneously missing its real user and occupied by another.

### F6 — two Glossier brand subjects

The inline `brand.analyze` endpoint created subject `bf39c035` (`glossier.com`);
the queued path created `db6770ae` (`Glossier`). Both are brand subjects for the
same brand. `upsertSubject` dedupes on `(lower(primaryHandle), primaryPlatform,
subjectType)` and brand subjects carry a null `primary_handle`, so brands are
deduped by nothing at all. This resolves itself when the router consolidation
removes the second entry point, but until then every re-run through the other
path forks a new subject.

---

## F3 / Option A — should `handles_lookup_idx` stay globally unique?

**Status:** open. Option B has landed — a handle collision now reports `failed`
with the owning subject named, instead of silent success. The *policy* is
unchanged: `handles_lookup_idx` is still `UNIQUE (platform, handle)`, so a
subject whose handle is already claimed still ends up without a row. Option A is
the decision to change that, and it needs DDL.

### Known victims (2026-07-27)

| victim | type | handle | claimed by |
|---|---|---|---|
| `vnilla` (`5968049c`) | creator | `instagram/vnillalondon` | brand `vnilla.co.uk` (`fb6716a2`) |
| `Glossier` (`db6770ae`) | brand | `instagram/glossier` | brand `glossier.com` (`bf39c035`) |

Zero rows are *mis-owned* — the global unique index made a wrong-owner row
impossible. The defect produces **absences**, which is why nothing looked wrong.

### What depends on the global one-subject-per-handle guarantee

Gathered so the decision does not have to re-derive it. Every reader of
`platform_handles` in the server, and what each would do if the index were
scoped to the subject:

| reader | what it does | under Option A |
|---|---|---|
| `upsertPlatformHandle` (db.ts) | the writer; global lookup on `(platform, lower(handle))` | **must change** — match on subject, and the collision branch disappears |
| `findExistingCreatorByHandle` (db.ts) — **duplicate pre-flight** | secondary probe joins `platform_handles → subjects` filtered to `subject_type='creator'`, `.limit(1)` | **safe, with a caveat**: already scoped to creators, so it still finds *a* creator. But `.limit(1)` over a no-longer-unique set picks arbitrarily — today the index guarantees at most one |
| `getBrandProfileById` (db.ts) — brand's Instagram handle | selects by `subject_id` + `platform`, `.limit(1)` | **safe** — already subject-scoped. Same `.limit(1)` caveat if a subject could hold two handles on one platform |
| `brand.reanalyze` (routers.ts) | reuses `existing.instagramHandle` from the reader above | **safe** — inherits whatever that returns |

Two things that look like dependencies and are **not**:

- **`upsertSubject`** dedupes on `(lower(primaryHandle), primaryPlatform,
  subjectType)` and never consults `platform_handles`. Independent of this index
  entirely. (Note: brand subjects carry a null `primary_handle`, so brands are
  deduped by nothing — that is F6, a separate problem.)
- **Creator duplicate creation.** Two creator subjects cannot share a
  handle+platform regardless of this index, because `upsertSubject` refuses it.
  The index is not what prevents that.

### The shape question Option A must answer

Scoping is not one choice but two, and they have different consequences:

- `UNIQUE (subject_id, platform, handle)` — a subject may hold **several**
  handles per platform. Permits a creator and a brand to share a handle string
  (true in the world), but breaks the `.limit(1)` assumption in the two readers
  above, which would then need an explicit primary.
- `UNIQUE (subject_id, platform)` — one handle per subject per platform. Keeps
  every `.limit(1)` correct as-is. Currently 0 duplicates on this key, so it
  migrates cleanly.

Either way the two known victims need backfilling, and `is_primary` — set to
`true` on every row today — becomes meaningful for the first time.

---

# Open questions for Jason

Interpretation calls found while moving brand onto the phased spine (S5). Each is
**pinned in the harness as current behaviour and deliberately not fixed**: the
thresholds, the refusal text and what counts as sufficient evidence are science,
not plumbing, and changing any of them changes when a brand is refused or what a
brand's observation records.

Both entries below are reported, reproducible, and covered by tests that assert
the behaviour *as it is* — so a decision either way is a small, safe edit rather
than an excavation.

---

## J-B1 — the brand min-data gate never measures evidence

**Where:** `brand.analyze` (routers.ts), replicated in `brandGate`
(`server/phases/brandPhases.ts`). Pinned by the `FINDING:` cases in
`server/brandIdentity.test.ts`.

**The condition, as written:**

```
evidenceLength < 200
  && !hasReviewData && !hasMentionData
  && !hasTikTokChannel && !hasInstagramChannel
```

**The problem.** `evidenceLength` is measured on the assembled brand evidence,
which begins with a fixed header and ends with a fixed `INSTRUCTIONS FOR
ANALYSIS` block. **An otherwise-empty base block is already 574 characters.** So
whenever a base block is built at all, `evidenceLength < 200` is false and the
gate admits — regardless of how little evidence there actually is.

The conjunct is satisfiable only when brand research was discarded wholesale (see
J-B2) or when capture produced nothing. In other words:

> The gate's entire discriminating power comes from the P0-1 discard upstream of
> it. Its own 200-character threshold never decides anything.

**What that means in practice.** A brand with one word of website text and two
snippets is admitted on exactly the same footing as one with five thousand words
of crawled content. The threshold reads as a data-volume floor and is not one.

**The decision.** Whether brand needs a real minimum-evidence floor, and if so
what it should measure — crawled word count, snippet count, or evidence length
excluding the boilerplate. Note that `200` was presumably chosen against a
summary that did **not** include the instructions block; if so the intended
threshold may simply need re-basing rather than rethinking.

---

## J-B2 — the P0-1 guard throws, and the router swallows it

**Where:** `researchBrand` (webResearch.ts) throws; `brand.analyze` catches with
a `console.warn`. Replicated as `brandResearchDiscarded`
(`server/phases/brandPhases.ts`), pinned by "the P0-1 discard reproduces the
monolith's degenerate case" in `server/brandIdentity.test.ts`.

**The behaviour.** When a brand has under 100 crawled words **and** no reviews
**and** no mentions **and** fewer than 3 snippets, `researchBrand` throws
`PRECONDITION_FAILED` with an analyst-facing message. That message never reaches
anyone. The router's `try/catch` warns to the console and continues, so every
variable the try block would have assigned keeps its initial value:

| | value after the swallow |
|---|---|
| evidence summary / parts | `undefined` → base becomes `""` |
| `reviewFields`, `symbolFields`, `mentionFields` | `{}` |
| `dataConfidenceLevel`, `semanticWordCount`, `crawledPagesCount` | `undefined` |

The TikTok and Instagram analyses then run anyway and append to that empty base,
so the model receives `"\n\n" + tiktokBlock` and the observation is written with
no review, symbol, mention, confidence or crawl data at all.

**Why it is replicated rather than removed.** The governing constraint for this
program is byte-identical brand evidence, and it does not carve out cases where
existing behaviour is unappealing. Removing the discard would hand the model
`base + tiktokBlock` instead — a different prompt for the same brand, and a
populated observation where the endpoint writes an empty one.

**The decision.** Three plausible readings, and only one of them is what the code
does today:

1. **The throw should reach the analyst** — a brand this thin should be refused,
   and the swallow is a bug.
2. **The continue is intended, the discard is not** — such a brand should be
   analysed from its channels *plus* whatever thin website evidence exists,
   rather than from the channels alone.
3. **Current behaviour is correct** — a brand below the floor has no usable
   self-description, so only independent channel evidence should inform it.

**Removing it later is cheap and deliberately so.** It is one predicate plus
three ternaries in `assembleBrandCollection`, plus the `researchDiscarded` flag
that `buildBrandPersistParams` reads. Delete those four together. The
`REPLICATED, NOT DESIGNED` banner on `brandResearchDiscarded` says the same
thing at the call site, so no archaeology is required.
