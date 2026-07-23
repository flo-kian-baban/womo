-- Mirror of Supabase migration womo_0005_persistence_completeness (applied 2026-07-23).
-- Reference only — this DB is Supabase-migration-managed; drizzle-kit is never run
-- against it (see docs/STORAGE_MODEL.md). Local numbering tracks womo numbering;
-- 0004 is intentionally absent (womo_0004_db_hardening — RLS enablement, an FK,
-- and an index drop — was applied without a local mirror file).

-- ── 1. observations.persistence_status ───────────────────────────────────────
-- Per-component enrichment persistence outcomes for the observation run that
-- created the row.
--   Shape: { "<component>": { "status": <status>, "reason": <text|null>, "at": <ISO-8601 UTC> } }
--   Status vocabulary:
--     success               — the component's write completed
--     failed                — the write was attempted and errored (reason = error)
--     skipped_no_data       — pipeline legitimately had no data for this subject
--                             (a fact about the subject, e.g. no reviews exist)
--     skipped_not_attempted — the write was never attempted due to our setup
--                             (a gap in configuration, e.g. missing API key / feature off)
--   NULL = row predates persistence tracking (pre-womo_0005).
ALTER TABLE observations
  ADD COLUMN persistence_status jsonb
  CHECK (persistence_status IS NULL OR jsonb_typeof(persistence_status) = 'object');

COMMENT ON COLUMN observations.persistence_status IS
  'Per-component enrichment persistence outcomes for this observation run: {component: {status, reason, at}}. Status vocabulary: success | failed | skipped_no_data (subject genuinely has no such data) | skipped_not_attempted (write not attempted — config/feature gap). NULL = row predates womo_0005 tracking.';

-- ── 2. llm_invocations: allow failure records ────────────────────────────────
-- All pre-existing rows are successes (failures were never written), so the
-- DEFAULT backfill is factually correct. duration_ms already exists and is
-- populated on the failure path by application code.
ALTER TABLE llm_invocations
  ADD COLUMN status varchar(16) NOT NULL DEFAULT 'success'
  CHECK (status IN ('success', 'failed')),
  ADD COLUMN error_message text;

CREATE INDEX llm_status_failed_idx ON llm_invocations (status) WHERE status = 'failed';

-- ── 3. scrape_events: intentionally unchanged ────────────────────────────────
-- failure_reason, silent_failure_detected, and http_status already exist.
