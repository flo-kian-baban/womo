-- womo_0013: durable storage for operator-submitted run inputs.
--
-- Reference copy of the migration applied via Supabase (apply_migration). This
-- database is Supabase-migration-managed and has no __drizzle_migrations
-- ledger; drizzle-kit push is BLOCKED against it (see package.json db:push).
-- This file exists so the change is readable in the repo, not to be run.
--
-- WHY. Submitted locators (Google Maps url, Instagram handle, TikTok channel)
-- travelled ONLY inside analysis_phase_state.subject_hint, a varchar(160)
-- IDENTITY key, url-encoded as a suffix. Six brand runs truncated at exactly
-- 160 chars; decodeSubject's JSON.parse then failed and its catch returned the
-- subject with NO extras -- silently. Every brand lost every locator before
-- phase one ran, and persistence recorded "no Instagram handle provided" for
-- inputs the operator had supplied. That catch is CORRECT for an identity key
-- (a corrupt suffix must not make a campaign unreadable) and wrong for inputs.
-- This table separates the two jobs so the catch is no longer load-bearing.
--
-- run_id is PRIMARY KEY and deliberately NOT a foreign key, matching the
-- womo_0009 ledger convention: run_id is a correlation id, pipeline_runs is
-- written only at terminal time, and a brand's subjects row does not exist at
-- enqueue -- it is created during persistence. One row per run, written once
-- at enqueue, read once when the campaign starts.
--
-- text throughout, no length ceilings: a length ceiling on operator data is
-- the entire defect this table exists to remove.
--
-- submitted_subject is NOT NULL (the url-or-name as typed). Everything else is
-- nullable and NULL means GENUINELY ABSENT -- which is what lets "this brand
-- has no TikTok" be recorded as a fact rather than as a capture failure.
CREATE TABLE public.run_inputs (
  run_id             uuid PRIMARY KEY,
  submitted_subject  text        NOT NULL,
  google_maps_url    text,
  instagram_handle   text,
  tiktok_channel_url text,
  brand_name         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.run_inputs IS
  'Operator-submitted inputs per analysis run (womo_0013). Keyed by run_id, no FK -- same convention as analysis_phase_state. NULL in a locator column means the operator supplied none, not that capture failed.';
