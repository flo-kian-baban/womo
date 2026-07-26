# Changelog

Semantic versioning starts here. Womo is **pre-V1**: the `0.x` line is the
internal local-only app as it stands today. **V1.0.0 ships as the signed `.dmg`**
at the end of the phased-architecture program — phased pipelines on all
platforms, the phase queue, and the desktop UI. Every session in that program
bumps the minor version and adds an entry below.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  pre-seam assembly and the banked-struct assembly, plus a committed
  golden-master of the exact evidence bytes.

### Changed
- **M1 seams** — `researchTikTokCreator` stages now populate an explicit
  `BankedCreatorEvidence` struct that a pure assembly function consumes,
  instead of threading values through in-memory locals. Pure functions
  (`buildCreatorEvidenceSummary`, `extractHashtags`, `extractKeywords`,
  `detectCreatorType`, the 6-3-3 sampler) are untouched — only where their
  inputs come from changed.
- Version reset from a placeholder `1.0.0` to the `0.x` pre-V1 line.

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
