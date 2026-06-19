-- Schema Audit Fix Migration (C1, C3, C4, I7)
-- Generated for WOMO_SCHEMA_AUDIT.md fixes

-- ═══════════════════════════════════════════════════════════════════════════════
-- C3: Add google_maps and yelp to platform enum
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TYPE "platform" ADD VALUE IF NOT EXISTS 'google_maps';
ALTER TYPE "platform" ADD VALUE IF NOT EXISTS 'yelp';

-- ═══════════════════════════════════════════════════════════════════════════════
-- C4: Add google_maps_http to scrape_method enum
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TYPE "scrape_method" ADD VALUE IF NOT EXISTS 'google_maps_http';

-- ═══════════════════════════════════════════════════════════════════════════════
-- C1: Add onDelete CASCADE to match_scores subject foreign keys
-- Drop existing constraints and re-add with CASCADE
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE "match_scores" DROP CONSTRAINT IF EXISTS "match_scores_creator_subject_id_subjects_id_fk";
ALTER TABLE "match_scores" DROP CONSTRAINT IF EXISTS "match_scores_brand_subject_id_subjects_id_fk";

ALTER TABLE "match_scores"
  ADD CONSTRAINT "match_scores_creator_subject_id_subjects_id_fk"
  FOREIGN KEY ("creator_subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE;

ALTER TABLE "match_scores"
  ADD CONSTRAINT "match_scores_brand_subject_id_subjects_id_fk"
  FOREIGN KEY ("brand_subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- I7: Change integer to bigint for overflow-prone count columns
-- ═══════════════════════════════════════════════════════════════════════════════

-- observations table
ALTER TABLE "observations" ALTER COLUMN "follower_count" TYPE bigint;
ALTER TABLE "observations" ALTER COLUMN "following_count" TYPE bigint;

-- creator_observations table
ALTER TABLE "creator_observations" ALTER COLUMN "total_likes" TYPE bigint;
ALTER TABLE "creator_observations" ALTER COLUMN "total_views" TYPE bigint;

-- content_items table
ALTER TABLE "content_items" ALTER COLUMN "view_count" TYPE bigint;
ALTER TABLE "content_items" ALTER COLUMN "like_count" TYPE bigint;
ALTER TABLE "content_items" ALTER COLUMN "comment_count" TYPE bigint;
ALTER TABLE "content_items" ALTER COLUMN "share_count" TYPE bigint;
ALTER TABLE "content_items" ALTER COLUMN "save_count" TYPE bigint;
