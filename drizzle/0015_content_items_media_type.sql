-- womo_0015 — content_items.media_type
--
-- REFERENCE COPY of the migration applied to production via Supabase
-- `apply_migration` (version 20260731…, name womo_0015_content_items_media_type).
-- This file is the repo's record of it; drizzle-kit does not run these — see
-- docs/STORAGE_MODEL.md and the `db:push` guard in package.json.
--
-- Instagram parses `photo | video | reel | carousel` for every post
-- (instagram/profileScraper.ts:904, :1113, :1321) and dropped it one function
-- later at instagramPostToPoolItem, where PoolVideoItem had no such field.
-- Outside test files it was read NOWHERE.
--
-- The cost of that: after persist, nothing could tell "this post yielded no
-- transcript because it is a photograph" — a fact about the POST — from "this
-- reel's transcription failed" — a fact about our CAPTURE. Measured
-- 2026-07-30: natgeo transcribed 5 of 12 posts and rachael.pazan 2 of 12, and
-- the stored rows could not say which of the two explanations applied to any
-- of the misses.
--
-- Nullable and unconstrained on purpose. TikTok has no equivalent distinction
-- and writes NULL; a CHECK would freeze a vocabulary that belongs to
-- Instagram's parser, not to this schema.
ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS media_type varchar(16);

COMMENT ON COLUMN public.content_items.media_type IS
  'Instagram post kind (photo|video|reel|carousel) as parsed at capture. NULL on TikTok, which has no such distinction, and NULL on rows written before womo_0015. Distinguishes a post that CANNOT yield speech from one whose transcription failed.';
