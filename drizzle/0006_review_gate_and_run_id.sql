-- Mirror of Supabase migration womo_0006_review_gate_and_run_id (applied 2026-07-23).
-- Reference only — this DB is Supabase-migration-managed; drizzle-kit is never run
-- against it (see docs/STORAGE_MODEL.md).

-- ── 1. Review gate on observations ───────────────────────────────────────────
-- Added with DEFAULT 'accepted' so all pre-gate rows (35 at apply time) were
-- backfilled to accepted in the same statement — they predate the gate. The
-- default was then flipped to 'pending' for every future row.
ALTER TABLE observations
  ADD COLUMN review_status varchar(16) NOT NULL DEFAULT 'accepted'
  CHECK (review_status IN ('pending', 'accepted', 'declined')),
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by varchar(64);

ALTER TABLE observations ALTER COLUMN review_status SET DEFAULT 'pending';

COMMENT ON COLUMN observations.review_status IS
  'Analyst review gate (womo_0006): pending (awaiting review) | accepted (in corpus, matchable) | declined (archived — hidden from library/matching but retained with full provenance; never hard-deleted). Rows created before womo_0006 were backfilled to accepted (they predate the gate).';

COMMENT ON COLUMN observations.reviewed_by IS
  'Free-text analyst name (two analysts, PIN auth carries no identity — no user system).';

-- ── 2. Analysis-run correlation id ───────────────────────────────────────────
-- App-generated UUID, no runs table, no FK. Nullable everywhere: existing rows
-- predate it. scrape_events/llm_invocations rows are written BEFORE the
-- observation exists, so run_id is the only reliable key joining a full run.
ALTER TABLE observations    ADD COLUMN run_id uuid;
ALTER TABLE scrape_events   ADD COLUMN run_id uuid;
ALTER TABLE llm_invocations ADD COLUMN run_id uuid;

COMMENT ON COLUMN observations.run_id IS
  'Correlation id for the analysis run that produced this observation (womo_0006). Joins scrape_events.run_id and llm_invocations.run_id for exact per-run diagnostics. NULL = row predates run tracking.';

-- ── 3. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX obs_review_idx ON observations (review_status);
CREATE INDEX obs_run_idx    ON observations (run_id);
CREATE INDEX se_run_idx     ON scrape_events (run_id);
CREATE INDEX llm_run_idx    ON llm_invocations (run_id);
