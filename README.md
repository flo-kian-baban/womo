# Womo — Cultural Fit Engine

Womo analyzes TikTok/Instagram/YouTube creators and brands (scraping →
transcript capture → LLM cultural extraction → scored F.I.T. matching) and
stores every run, with full provenance, in a shared cloud Supabase database.

**The app is local-only**: each analyst runs the whole app on their own laptop
against the shared database. There is no hosted deployment and no login — the
app opens directly.

## Run it

→ **[docs/LOCAL_RUNBOOK.md](docs/LOCAL_RUNBOOK.md)** — clone → `pnpm install` →
`pnpm exec playwright install chromium` → `.env` from
[.env.example](.env.example) → **`pnpm start:local`** → open
<http://localhost:3000>.

## How it's put together

```
client/src/pages/        UI (React 19 + Tailwind 4; tRPC hooks)
server/routers.ts        tRPC procedures — analyze / reanalyze / review / match
server/webResearch.ts    creator & brand research pipelines (6-3-3 sampling)
server/scraping/         Playwright scraping stack (profile, search, transcripts)
server/aiExtraction.ts   Gemini extraction (creator/brand cultural profiles)
server/fitEngine.ts      scoring — FROZEN; changes require explicit approval
server/db.ts             query helpers + run diagnostics read model
drizzle/schema.ts        types mirror of the Supabase schema (see below)
docs/                    the real documentation (see pointers below)
```

- **Auth:** none — internal local-only app; every tRPC procedure is public.
- **Database:** one shared cloud Supabase for all analysts. **Schema changes go
  through reviewed Supabase migrations only** — `pnpm db:push` is intentionally
  blocked (no drizzle ledger exists); mirror applied migrations into
  `drizzle/schema.ts` for types. Details: [docs/STORAGE_MODEL.md](docs/STORAGE_MODEL.md).
- **Provenance:** every analysis run writes `scrape_events`, `llm_invocations`,
  a `pipeline_runs` terminal outcome, and evidence snapshots — the Review panel
  is built from these.

## Commands

| Command | What |
|---|---|
| `pnpm start:local` | run the app (THE run command; alias of `dev`) |
| `pnpm check` | typecheck |
| `pnpm test` | unit tests (includes the frozen-scoring golden suite) |
| `pnpm test:db:up` / `pnpm test:integration` / `pnpm test:db:down` | integration tests against a disposable Docker Postgres |

## Versioning

Womo is **pre-V1** (`0.x`). **V1.0.0 ships as the signed `.dmg`** at the end of
the phased-architecture program — phased pipelines on all platforms, the phase
queue, and the desktop UI. Each session in that program bumps the minor version
and adds an entry to [CHANGELOG.md](CHANGELOG.md).

## Documentation map

| Doc | What |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | version history; what shipped in each session |
| [docs/LOCAL_RUNBOOK.md](docs/LOCAL_RUNBOOK.md) | zero-to-running local setup (start here) |
| [docs/STORAGE_MODEL.md](docs/STORAGE_MODEL.md) | every table, writer/reader, migration policy |
| [docs/CREATOR_PIPELINE_AUDIT.md](docs/CREATOR_PIPELINE_AUDIT.md) | the pipeline, stage by stage, plus every fix session |
| [DATA_POINTS_REFERENCE.md](DATA_POINTS_REFERENCE.md) / [TECHNICAL_CALCULATIONS.md](TECHNICAL_CALCULATIONS.md) | scoring inputs & formulas |

## Intelligence layer (Phase 1.5 summary)

**Implemented:** creator 6-3-3 longitudinal sampling (6 recent / 3 mid / 3
anchor videos with transcripts), recursive brand semantic crawl, Google Maps
top-50 review ingestion, semantic word cloud, alignment narrative, cultural
velocity indicator, and data-confidence warnings.

- **Cultural Velocity** — from the 6-3-3 sample: "Focusing" = consistent niche
  identity across all three periods; "Drifting" = significant divergence
  between anchor and recent content. Surfaced in the F.I.T. Report.
- **Data confidence** — `high`: brand crawl 2,000+ words AND complete 12-video
  creator sample · `medium`: partial · `low`: below threshold (scores
  directionally valid, flagged in the UI).
- **Validation strategy** — PARR is a predictive cultural-receptivity metric;
  future iterations add hooks to track actual watch-time/ER for active
  campaigns to empirically harden the PARR and QoV formulas.
