-- Mirror of Supabase migration womo_0009_analysis_phase_state (applied 2026-07-26).
-- Reference only — this DB is Supabase-migration-managed; drizzle-kit is never run
-- against it (see docs/STORAGE_MODEL.md).

-- Phased-architecture S1. Durable per-phase state for an analysis campaign.
-- ADDITIVE ONLY: creates one new table. No existing table, column, index,
-- constraint, or row is touched.
--
-- run_id is a CORRELATION id, deliberately NOT a foreign key: pipeline_runs
-- rows are written only at terminal time (recordRunOutcome), so during phases
-- 1-4 no parent row exists. Same pattern as scrape_events.run_id,
-- llm_invocations.run_id, semantic_documents.run_id (zero run_id FKs in this
-- schema).

CREATE TABLE analysis_phase_state (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL,
  subject_hint    varchar(160) NOT NULL,
  phase           varchar(32)  NOT NULL,
  tool            varchar(64),
  status          varchar(24)  NOT NULL DEFAULT 'pending',
  attempt_count   integer      NOT NULL DEFAULT 0,
  failure_class   varchar(24),
  next_earliest_at timestamptz,
  output          jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE analysis_phase_state IS
  'Phased-architecture ledger (womo_0009): one row per (analysis run, phase). Durable phase output + retry state. run_id is a correlation id, not an FK - pipeline_runs is written only at terminal time.';
COMMENT ON COLUMN analysis_phase_state.subject_hint IS
  'handle+platform, so an in-flight campaign is findable before a subject row exists.';
COMMENT ON COLUMN analysis_phase_state.output IS
  'Durable banked output of this phase; the input later phases read instead of in-memory threading.';

-- One row per phase per run; also serves as the run_id lookup index.
CREATE UNIQUE INDEX aps_run_phase_unique ON analysis_phase_state (run_id, phase);

-- Scheduler scan (S3): "what is ready to run now?"
CREATE INDEX aps_ready_idx ON analysis_phase_state (status, next_earliest_at);
