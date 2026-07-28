-- womo_0012 — M1 item 3: persist score degradation on the match record.
-- Reference copy; applied to Supabase project Womo via apply_migration
-- (ledger name: womo_0012_match_score_degradation). See docs/STORAGE_MODEL.md.
--
-- WHY: fit.calculate marks results that rest on fallback values instead of a
-- real computation (myth/tribe LLM failed, or barthes_myth missing → both
-- default to 3.0). That marker was returned to the client and DROPPED — never
-- stored, never rendered — so a degraded match record was indistinguishable
-- from a computed one. Additive only; match_scores had 0 rows at apply time.
--
--   score_degraded       — true when any score component is a fallback, not a
--                          computation. NOT a quality judgement of the match;
--                          a statement about the CALCULATION.
--   degradation_reasons  — the verbatim reason strings recorded at calc time,
--                          as a json array. NULL for non-degraded matches.
ALTER TABLE match_scores
  ADD COLUMN score_degraded boolean NOT NULL DEFAULT false,
  ADD COLUMN degradation_reasons json;
