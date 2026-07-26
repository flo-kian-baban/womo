-- Mirror of Supabase migration womo_0010_phase_state_output_json (applied 2026-07-26).
-- Reference only — this DB is Supabase-migration-managed; drizzle-kit is never run
-- against it (see docs/STORAGE_MODEL.md).

-- The phase ledger's output must round-trip BYTE-EXACTLY: phases read their
-- inputs back from it, and those values land in the womo_0007 evidence
-- snapshot, which is byte-compared by the identity harness. jsonb normalizes
-- key order (length-then-bytewise); json preserves the exact text.
-- Safe: the column holds payloads, never query targets. The scheduler (S3)
-- filters on status / phase / next_earliest_at, which are separate columns.
--
-- Verified before applying:
--   jsonb round-trip byte-identical? false
--   json  round-trip byte-identical? true
-- Guarded permanently by the ledger round-trip test in the identity harness.

ALTER TABLE analysis_phase_state ALTER COLUMN output TYPE json USING output::json;

COMMENT ON COLUMN analysis_phase_state.output IS
  'Durable banked output of this phase; the input later phases read instead of in-memory threading. Type is json (NOT jsonb) deliberately: jsonb normalizes key order, which would alter the byte-exact evidence snapshot the identity harness asserts.';
