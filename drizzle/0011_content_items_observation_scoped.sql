-- Mirror of Supabase migration womo_0011_content_items_observation_scoped.
-- Reference only — this DB is Supabase-migration-managed; drizzle-kit is never run
-- against it (see docs/STORAGE_MODEL.md).

-- Make content_items OBSERVATION-SCOPED.
--
-- THE DEFECT. The unique key was (platform, platform_video_id, subject_id) — no
-- observation_id. insertContentItems upserts against it, and observation_id is
-- deliberately absent from the DO UPDATE set (re-pointing a row would strip
-- evidence from an older ACCEPTED observation, which is strictly worse). So on a
-- RE-ANALYSIS every repeated video collided, DO UPDATE refreshed the existing
-- row in place, and the row kept pointing at the FIRST observation that stored
-- it. Postgres raised nothing.
--
-- Two silent consequences:
--   (a) the new observation was attributed ZERO content rows while still
--       reporting transcripts and high confidence — 15 observations in
--       production, 0 of 20 first analyses but 15 of 23 re-analyses (65%);
--   (b) the earlier observation's stored evidence (view counts, transcripts)
--       was OVERWRITTEN, breaking the append-only guarantee the rest of this
--       schema assumes: a historical observation records what was true when it
--       was taken.
--
-- ATOMIC SWAP, deliberately. The two indexes cannot coexist: while the old one
-- exists it still forbids a second observation's copy of the same video. DDL is
-- transactional in Postgres, so the drop and create land together or not at all.
--
-- SHIPS WITH ITS CODE. The moment the old index is gone, an unpatched client's
-- ON CONFLICT (platform, platform_video_id, subject_id) fails with "no unique or
-- exclusion constraint matching the ON CONFLICT specification". That is a loud
-- failure rather than silent corruption, but analysts must pull.
--
-- Pre-flight on production before applying: 1069 rows, 0 with a null
-- observation_id, and distinct(new key) = distinct(old key) = 1069 — the new
-- index cannot fail on existing data. The new key is strictly more specific than
-- the old one, so anything the old index permitted the new one permits too.
--
-- NULLS NOT DISTINCT (PG15+; this is 17.6) preserves the old dedup behaviour for
-- legacy rows whose observation_id is null. There are none today, but the column
-- is nullable and the read model still handles them.

BEGIN;

DROP INDEX ci_platform_video_idx;

CREATE UNIQUE INDEX ci_platform_video_obs_idx
  ON content_items (platform, platform_video_id, subject_id, observation_id)
  NULLS NOT DISTINCT;

COMMENT ON INDEX ci_platform_video_obs_idx IS
  'womo_0011: one row per video PER OBSERVATION. The predecessor omitted observation_id, so a re-analysis silently attributed zero rows to its new observation and overwrote the previous one''s evidence.';

COMMIT;
