# Changelog

Semantic versioning starts here. Womo is **pre-V1**: the `0.x` line is the
internal local-only app as it stands today. **V1.0.0 ships as the signed `.dmg`**
at the end of the phased-architecture program — phased pipelines on all
platforms, the phase queue, and the desktop UI. Every session in that program
bumps the minor version and adds an entry below.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Phased architecture S3a: scheduler and real concurrency bounds

**No interface change.** `creator.analyze` / `creator.reanalyze` stay synchronous:
same response shape, same error codes, same race semantics. A client cannot tell
the difference. Enqueue-and-poll is S3b.

### Fixed
- **The concurrency semaphore bounded nothing.** `analysisConcurrencyLimit =
  pLimit(2)` in `instrumentedRun.ts` was documented as a shared pool that kept
  3+ concurrent runs from exhausting the browser pool. It could not: `workPromise`
  is an IIFE, so `args.work(...)` ran synchronously at construction and the
  limiter was handed a promise that had already started. The callback it deferred
  was only `Promise.race([workPromise, timeoutPromise])` — it gated when a run's
  race was *observed*, never when its work *began*. Concurrent analyses therefore
  all scraped at once, and a run that had already finished could be held back
  waiting for an unrelated run's race to reject.

### Added
- **Per-resource-class admission** (`_core/resourceSlots.ts`) — `fn` is not called
  until a permit is held. Bounded by what the work actually contends for rather
  than by one global number: **browser 2** (capture/augment/transcribe),
  **llm 4** (derive + the inline extraction), compute unbounded. Both env-tunable
  (`PHASE_BROWSER_CONCURRENCY` / `PHASE_LLM_CONCURRENCY`) — starting values to be
  moved against the memory telemetry, not truths. `slotSnapshot()` reports live
  occupancy, queue depth and the peak high-water mark per class.
- **Phase scheduler** (`phases/phaseScheduler.ts`) — retry policy as **data** the
  scheduler reads, not logic inside phases. The phase classifies; the scheduler
  decides: transient → 30s/2m/5m then park; blocked/quota → 5m/15m parks;
  structural → no requeue, parked for attention; genuine_empty → terminate the
  campaign immediately. `decideRetry` is pure (clock and deadline injected), so
  every class is provable without a phase, a database or a browser. A phase's
  **declared** `retry` overrides the table in full — per the S1 contract, "absent
  class = no requeue" means absent, not "fall through to the defaults".
- **Deadline awareness** — a backoff that would land past the campaign's race
  deadline is downgraded from retry to park. The gate is still written to
  `next_earliest_at` as real data for S3b's poller; what does not happen is an
  open request sleeping 15 minutes behind a 5-minute timeout.
- **`execute` seam on the phase runner** — the scheduler plugs in; the runner
  keeps owning order, stop conditions and banked-state semantics. All existing
  runner tests pass unedited.
- **`db.scanReadyWork(now, limit)`** — the "what is ready now?" query
  `aps_ready_idx (status, next_earliest_at)` was created for. Built and proven
  (`integration/phaseScheduler.integration.ts`), **deliberately uncalled**: with a
  synchronous endpoint a rescanned campaign has no caller to return to, and
  `extract_commit` still runs inline in `routers.ts`, so a resumed campaign could
  not reach a commit. S3b wires the loop.
- Ledger writes now carry the real `attempt_count`, the `next_earliest_at` gate,
  and a `running` row before each attempt — the table finally shows work **in
  progress**, not only work that finished. No migration: womo_0009 already had
  every column and index this needs.

### Changed
- The race deadline rides the analysis-run `AsyncLocalStorage` context alongside
  the run id, for the same reason: the scheduler needs it deep inside the phase
  runner, which has no parameter to take it through and no business knowing about
  the endpoint's timeout.

### Invariants worth keeping
- **PERMIT ⊃ CONTEXT, ALWAYS.** Admission precedes `phase.run()`; every
  `getContext()` lives inside it; the permit releases after the phase settles. A
  *waiting* job holds no browser context. This is what keeps the TTL reaper race
  (f04329b) dead: a queued job sitting on a context either stays `busy` and pushes
  pool occupancy past `MAX_CONCURRENT_CONTEXTS` — where `acquireContextPage`
  creates contexts *over* the cap instead of blocking — or outlives
  `CONTEXT_TTL_MS` and gets closed out from under itself.
- **One permit per phase, never nested** — enforced structurally, not documented.
  `withResourceSlot` throws on re-entrant acquisition, so "just grab an LLM slot
  inside transcribe" cannot reintroduce hold-and-wait or deadlock.
- **A permit is never held across a backoff sleep** — release, sleep, re-acquire.

### Known, deliberately unchanged
- `requestGovernor` (`scraping/httpClient.ts`) is per-platform pacing over
  process-global state, **not a mutex**: concurrent callers read the same
  `lastRequestTime` and can wake together. Real concurrency means a bigger
  thundering herd at the platform. Changing it changes scraping behaviour.
- `recordPhaseState` swallows every error by design. Correct while in-memory
  campaign state is authoritative; **must be revisited in S3b**, when the ledger
  becomes the queue of record.

## [Unreleased] — Phased architecture S2

### Added
- **Collection identity harness** (`collectionIdentity.test.ts`) — the
  regression gate for the phased restructuring of collection, which the
  evidence harness is structurally blind to. Replays recorded raw platform
  payloads and asserts pool order, author-guard reject counts, and the exact
  `(id, bucket)` sample sequence. Guards the invisible regression: a merge-order
  or sampling-input change that shifts *which* videos become the corpus.
- **Platform tool seam** (`phases/platformTools.ts`) — `CaptureTool` /
  `AugmentTool` / `TranscribeTool` behind a registry. Adding Instagram or
  YouTube in S4 is an implementation, not an architecture change; an
  unregistered platform throws loudly rather than producing a silently empty
  analysis.
- **Phase units** for capture / augment / transcribe-selection / derive /
  extract_commit, implementing the S1 contract: declared inputs read from
  banked output, durable output, outcome + failure class. `extract_commit` is
  FUSED (assemble → extract → snapshot → persist) so an extraction can never be
  orphaned from its commit.
- **Resume from banked output (M3)** — a campaign whose capture/augment/
  transcribe succeeded but which died at derive or extract_commit can re-run
  ONLY phases 4-5 from the ledger, without re-scraping. This is the failure
  class that lost three historical runs when the LLM key went dead. Triggered
  explicitly via `creator.resumeRun({runId})`; the analyst-facing button is S6
  and automatic requeue is S3.
- **Ledger round-trip guard** (`phaseLedger.integration.ts`) — asserts the
  `output` column is `json`, that a realistic transcript round-trips
  byte-identically, and that re-running a phase replaces only its own row.
- Unit coverage for the 6-3-3 sampler, extracted and testable for the first
  time (the identity harness cannot reach it).

### Changed
- **`analysis_phase_state.output`: `jsonb` → `json`** (womo_0010). Not
  cosmetic: phases read their inputs back from this column and those values
  land in the womo_0007 evidence snapshot, which the identity harness compares
  byte-for-byte. `jsonb` normalizes key order and silently re-serialized every
  transcript. Measured: jsonb round-trip byte-identical **false**, json **true**.
- **`fetchTikTokTranscripts` decomposed** into four stages (API pool collection,
  supplemental search, 6-3-3 sampling, per-video transcription). Statements
  moved verbatim; the shared accumulators are now passed explicitly instead of
  closed over. The hardened internals are untouched.
- Prepared-evidence derivations extracted as pure functions
  (`computeDeriveInputs`, `computeLocalPrepared`), preserving the deliberate
  LLM-concurrency window.

## [Unreleased]

## [0.10.0] — 2026-07-25 — Phased architecture S1: foundation

Foundation session of the phased-analysis program. **No execution semantics
changed**: the monolith still runs end to end in the same order with the same
timing. This session adds structure, state visibility, and the proof harness.

### Added
- **Phase contract** (`server/_core/analysisPhase.ts`) — the `AnalysisPhase`
  interface (capture / augment / transcribe / derive / extract_commit), declared
  inputs read from banked outputs, `PhaseResult` with outcome + failure class +
  per-attempt records. Definition only; nothing executes against it yet.
- **`analysis_phase_state` ledger table** — durable per-phase state
  (status, attempts, failure class, banked output). Additive-only.
- **Shadow banking** — the monolith writes each stage's output to the ledger as
  it runs. Write-only observation: nothing reads it, nothing resumes from it.
- **Identity harness** (`server/evidenceIdentity.test.ts`) — the acceptance
  criterion for the whole program. Byte-equality proof between the frozen
  pre-seam assembly and the banked-struct assembly (evidenceSummary, the whole
  research result, and the womo_0007 snapshot's inputsJson + promptText +
  promptMeta), plus a committed golden-master of the exact evidence bytes. Runs
  over two fixtures: a synthetic one covering every evidence branch, and one
  captured from a real run as a degraded-capture specimen.

### Changed
- **M1 seams** — `researchTikTokCreator` stages now populate an explicit
  `BankedCreatorEvidence` struct that a pure assembly function consumes,
  instead of threading values through in-memory locals. Pure functions
  (`buildCreatorEvidenceSummary`, `extractHashtags`, `extractKeywords`,
  `detectCreatorType`, the 6-3-3 sampler) are untouched — only where their
  inputs come from changed.
- Version reset from a placeholder `1.0.0` to the `0.x` pre-V1 line.

### Fixed
- `extract_commit` was banked on the analyze path only, so a reanalyze produced
  a 4-phase ledger. Found by the S1 acceptance run; reanalyze/analyze parity is
  a standing rule.

### Frozen (unchanged, program-wide constraint)
`fitEngine`, scoring, weights, thresholds, confidence definitions,
transcript-source classification, min-data thresholds. The golden suite is the
proof and remains green and untouched.

## [0.9.0] — pre-V1 baseline (retroactive)

The state of the app before the phased-architecture program began, recorded
here so the `0.x` line has a floor. Highlights of how it got here:

### Added
- Local-only internal Mac app: hosting scaffolding (Railway/Vercel/Docker,
  CORS, trust proxy, health endpoint, production build path) and the entire
  PIN/HMAC auth system removed. `pnpm start:local` is the only run mode.
- Electron wrapper spike (`electron/main.cjs`) — de-risking only: proves the
  unchanged app and Playwright scraping both work inside a desktop window.
- Scraper reliability: named strategy chains for TikTok profile capture and
  search, a bounded empty-capture retry with a transient-vs-genuine
  discriminator, a per-run capture-health signal (reporting only), and
  reanalyze brought to full parity with analyze via a shared instrumented-run
  wrapper.
- Provenance and review: run correlation ids on every scrape event and LLM
  invocation, evidence snapshots per run, the analyst review gate, and the run
  diagnostics panel.

### Removed (with evidence — do not restore)
- TikTok search HTML-parse fallback: 0 successes in 38 lifetime attempts.
- Google webcache profile leg: 3/12 lifetime, then permanently 429-walled.
