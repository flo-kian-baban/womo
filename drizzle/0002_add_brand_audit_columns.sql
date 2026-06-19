ALTER TABLE "brand_observations" ADD COLUMN IF NOT EXISTS "yelp_review_excerpts" text;
ALTER TABLE "brand_observations" ADD COLUMN IF NOT EXISTS "semantic_word_count" integer;
ALTER TABLE "brand_observations" ADD COLUMN IF NOT EXISTS "crawled_pages_count" integer;
