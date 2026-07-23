-- Mirror of Supabase migration womo_0007_evidence_snapshots (applied 2026-07-23).
-- Reference only — this DB is Supabase-migration-managed; drizzle-kit is never run
-- against it (see docs/STORAGE_MODEL.md).

-- Evidence snapshot storage in the EXISTING semantic_documents table (no new
-- table). One snapshot set per analysis run, keyed by run_id; history
-- accumulates (append-only), never replaced.
--
-- document_type vocabulary (womo_0007):
--   creator_evidence_inputs   — JSON of the structured inputs used to build the
--                               extraction prompt (content_text = JSON string)
--   creator_extraction_prompt — the exact user-prompt string sent to the LLM;
--                               metadata jsonb carries { systemPrompt, model,
--                               purpose, temperature } so the messages array is
--                               reconstructable byte-identically
--   brand_evidence_inputs / brand_extraction_prompt — reserved for Session 8.

ALTER TABLE semantic_documents ADD COLUMN run_id uuid;

COMMENT ON COLUMN semantic_documents.run_id IS
  'Analysis-run correlation id (womo_0006 family). Snapshot documents are keyed by (run_id, document_type). NULL = document not tied to a run.';

CREATE INDEX sd_run_idx ON semantic_documents (run_id);

CREATE UNIQUE INDEX sd_run_doc_unique
  ON semantic_documents (run_id, document_type)
  WHERE run_id IS NOT NULL;
