# Brand pipeline — open questions for Jason

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
