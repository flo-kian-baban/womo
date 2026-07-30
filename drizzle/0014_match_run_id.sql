-- womo_0014: give a match its campaign correlation id.
--
-- Applied to the Womo Supabase project via apply_migration (this file is the
-- repo-side record; the database is Supabase-migration-managed, drizzle-kit
-- push is blocked against it — see docs/STORAGE_MODEL.md).
--
-- WHY: matching is being converted from a synchronous mutation into a queue
-- campaign (S6). A campaign is keyed by run_id, and without this column a
-- persisted match cannot be found from the run that produced it — which is the
-- reconnect path the whole conversion exists to provide, and also what makes
-- the `persist` phase idempotent under retry.
--
-- NO FOREIGN KEY, deliberately. This follows the convention already stated for
-- analysis_phase_state.run_id and run_inputs.run_id: run_id is a correlation
-- id, not a relationship. pipeline_runs is written only at terminal time, so an
-- FK would make a match row un-writable before its run finished.
--
-- NULLABLE, so the rows written by the synchronous path stay valid as-is.
ALTER TABLE public.match_scores ADD COLUMN IF NOT EXISTS run_id uuid;

-- Idempotency for the `persist` phase. PARTIAL so the pre-existing NULL rows
-- are untouched and remain legal; without the WHERE clause Postgres treats
-- every NULL as distinct anyway, but stating it makes the intent explicit.
--
-- This is what stops a retried persist from appending a SECOND match_scores
-- row: the phase can re-run safely because the run it belongs to can claim its
-- row exactly once.
CREATE UNIQUE INDEX IF NOT EXISTS ms_run_unique
  ON public.match_scores (run_id)
  WHERE run_id IS NOT NULL;

COMMENT ON COLUMN public.match_scores.run_id IS
  'womo_0014: the campaign that produced this match. Correlation id, no FK (same convention as analysis_phase_state.run_id). NULL for rows written by the pre-S6 synchronous fit.calculate path.';
