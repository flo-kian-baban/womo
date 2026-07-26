# Changelog

Semantic versioning starts here. Womo is **pre-V1**: the `0.x` line is the
internal local-only app as it stands today. **V1.0.0 ships as the signed `.dmg`**
at the end of the phased-architecture program — phased pipelines on all
platforms, the phase queue, and the desktop UI. Every session in that program
bumps the minor version and adds an entry below.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Phased architecture S3b: the queue is the single entry point

**This is the client-visible interface change the program has been building
toward.** Every analysis is enqueued and processed from the queue. There is no
synchronous bypass, no direct-to-pipeline path, no "run now" shortcut. A single
creator is a queue of one — submission and queue submission are the same
operation.

### Why one entry point
`analyze`, `reanalyze` and `bulkAnalyze` were three copies of the same
orchestration, and they drifted. `bulkAnalyze` ended up with **no timeout, no
memory tracker, no terminal `pipeline_runs` telemetry, no extraction retry, and
it dropped `followingCount`** — and it had no client surface at all. One entry
point cannot drift from itself.

### Added
- **`creator.submit({ handles, platform })`** — n handles or one, same path.
  Returns as soon as the campaigns are DURABLY enqueued. The duplicate gate runs
  **before** enqueue, so the analyst confirms before anything is queued.
- **`creator.queueStatus({ runId? })`** — one campaign or all. Reports real
  ledger state: current phase, per-phase status and attempt count, parks with
  their next-attempt time, terminal outcome.
- **`server/queue/analysisQueue.ts`** — the worker. Polls `scanReadyWork`,
  reclaims heartbeat-dead phases, drives unfinished campaigns, and resumes on
  boot whatever the last process left behind.
- **`server/phases/creatorCampaign.ts`** — a campaign that completes end to end
  with nobody watching.
- Heartbeat + **10-minute** stale-`running` reclaim, and a **24-hour** bound on
  what counts as resumable.

### Changed
- **`extract_commit` runs in the phase runner** (was inline in `routers.ts`).
  The ledger is now 5 runner rows, not 4 plus a hand-written shadow row. The
  fabrication guard, the extraction retry and the `researchData` mapping moved
  into injected deps verbatim; the manual `withResourceSlot("llm", …)` wrap was
  **deleted**, because the scheduler already admits the phase against the llm
  bound and wrapping twice trips S3a's nesting guard.
- **The lost-work class is closed structurally.** The old defence was in-race
  salvage, which only worked while the process survived; a crash between
  extraction and commit lost the work. extract_commit is now a ledger phase, so a
  campaign killed after collection re-runs only phase 5, from banked evidence,
  with no re-scraping.
- **`recordPhaseState` throws; `recordPhaseObservation` is best-effort.** Queue
  state must be durable — a swallowed enqueue is a campaign nobody will run and
  nobody can see. Observation stays best-effort: losing a banked output costs one
  phase, losing the enqueue row costs the campaign.
- **The client never blocks**, including for one creator. The time-based phase
  estimator is gone — it advanced a highlight on hardcoded elapsed-time marks and
  kept guessing while the run did something else. Real phase state or nothing.
- `creator.reanalyze` is a submission. `creator.resumeRun` is now just "clear the
  backoff and run it now"; the boot loop resumes automatically.

### Removed
- `creator.bulkAnalyze`, `bulk.getJobProgress`, and `server/bulkAnalysisJobs.ts`.
  Bulk is not a concept: it is n submissions.

### Explicitly OUT OF SCOPE — read before extending the rule
- **The brand path (`brand.analyze` / `brand.reanalyze`) is NOT queued.** It has
  no phase model, no platform toolset and no ledger, so forcing it through the
  queue would mean building the brand phase model first. That is **S5**, and it
  needs its own work order. The no-bypass test is deliberately scoped to the
  creator router for this reason.
- **`creator.ingestSupplementalVideo` is NOT queued.** It fetches one transcript
  for one already-analyzed video and writes a content row. It is not a campaign:
  no phases, no observation, nothing to resume.

### Found by running it, not by the tests
- A campaign that could not complete never left the queue (no terminal row), so
  it showed as "queued" forever with no reason.
- Boot resumption was unbounded in time and replayed campaigns whose banked
  output predated the current phase schema — **phase outputs carry no schema
  version**, which is worth knowing before widening the window.
- `scanReadyWork` returned structural failures, so a permanently-failed phase was
  retried on every tick — contradicting the S1 contract's `isRequeueable`.

## [Unreleased] — content_items observation attribution (blocks S3b)

### Fixed
- **A re-analysis attributed ZERO content_items to its own observation**, and
  **silently overwrote the previous observation's stored evidence.**
  `content_items`' unique key was `(platform, platform_video_id, subject_id)` —
  no `observation_id` — so every repeated video collided, `DO UPDATE` refreshed
  the row in place, and the row kept pointing at the *first* observation that
  stored it. Postgres raised nothing, so `persistence_status.content_items`
  recorded `success` and the run reported `success`.

  Meanwhile `updateContentItemTranscript` matched subject-wide, so it wired
  transcripts onto the *older* observation's rows and counted them as this run's
  successes — which is how an observation holding **no content at all** still
  reported `transcript_count: 8` at `data_confidence_level: high`. That is the
  confidently-wrong-stored-data class the project spent six sessions removing.

  Measured: **0 of 20 first analyses affected, 15 of 23 re-analyses (65%)**. Not
  intermittent — deterministic in proportion to how much of a creator's back
  catalogue is already stored. 15 observations affected; 1 accepted and feeding
  a match.

### Added
- **Migration `womo_0011`** — `ci_platform_video_obs_idx (platform,
  platform_video_id, subject_id, observation_id) NULLS NOT DISTINCT`. Each
  observation owns its own content snapshot; storage grows with re-analyses,
  accepted knowingly because per-observation snapshots *are* the version history.
- `insertContentItems` returns `{ attributed, collided }` instead of `void`,
  which is what made the failure observable at all. It stays as the assertion
  that the fix holds: a non-zero `collided` now means something re-introduced
  cross-observation sharing.
- `runEnrichment` accepts a returned report, so a component whose write
  *completed* but did not accomplish its purpose can say so without inventing an
  exception.
- `server/integration/contentAttribution.integration.ts`, including the
  append-only proof: a prior observation's rows are untouched by a re-analysis.

### Changed
- **`updateContentItemTranscript` takes a REQUIRED `observationId`** and filters
  on it. Required, not optional, so a caller cannot silently get the old
  behaviour back — unscoped it would now rewrite *every* observation's copy.
- **BEHAVIOUR CHANGE — the read model resolves ONE observation** (newest
  accepted, else current) instead of the `accepted OR current` union. With
  per-observation rows that union returns each shared video once *per visible*
  observation, and 3 of 34 subjects have two visible observations. **Some
  profiles now show less content than before, and that is correct:** the union
  was backfilling an observation's missing evidence with an older observation's
  rows. One subject changed in practice (`holycao23`, 3 → 0 items) — exactly the
  profile whose own observation held nothing.
- The diagnostics panel no longer reports "no videos captured" when a full pool
  was captured and merely misattributed; it reads `persistence_status`.

### Known — logged for the brand session, not fixed here
- **The brand paths synthesise content ids by POSITION** —
  `brand-video-${i}` ([routers.ts](server/routers.ts)) and
  `ig-post-${handle}-${i}`. These are independently unsound: a re-analysis
  regenerates the same keys, so video #3 of the new run overwrites video #3 of
  the old one *even when they are different videos*. womo_0011 contains the
  damage to within a single observation, but the ids should be derived from
  something stable (the platform's own id, or a content hash).

### Not done
- **`signal_values` / `decoded_signals` still use the permissive union** in the
  profile getter, and unlike `content_items` they have always accumulated one row
  set per observation. A subject with two accepted observations may therefore
  show duplicated keywords/themes today. Same shape, different table — out of
  this work order's scope, flagged rather than silently changed.

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
  and a live status marker per attempt: **`pending` while the phase queues for a
  permit, `running` once admitted**. The table finally shows work in progress,
  and distinguishes waiting from working — reporting a queued phase as "running"
  would misdescribe exactly the state this session introduced. No migration:
  womo_0009 already had every column and index this needs.
- **Monotonic ledger writes.** A phase now writes its row up to three times and
  every write is fire-and-forget, so nothing orders them. `recordPhaseState`
  refuses a write older than the row it would overwrite, so a late marker can
  never leave a finished phase reading `running` with the wrong attempt count.
- **`system.concurrency`** — a read-only tRPC query returning the live bounds,
  per-class in-flight/queued/peak occupancy, browser-pool state and one memory
  sample. The bounds are explicitly starting values to be tuned against
  telemetry, which is only honest if the telemetry is visible while work runs;
  `pipeline_runs.error_log.memory` shows per-run peaks after the fact but cannot
  show what is **queued**.

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
