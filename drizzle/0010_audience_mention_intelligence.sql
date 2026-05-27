-- Migration: Audience Mention Intelligence + Music Overlap + Cultural Exchange
-- Phase 6: TikTok audience mention data, music signals, and cultural exchange report columns

-- brand_profiles: Audience Mention Intelligence columns
ALTER TABLE `brand_profiles`
  ADD COLUMN `mentionDecodedSymbols` json,
  ADD COLUMN `mentionRawKeywords` json,
  ADD COLUMN `mentionHashtagCloud` json,
  ADD COLUMN `mentionSentiment` varchar(32),
  ADD COLUMN `mentionSentimentConfidence` varchar(16),
  ADD COLUMN `mentionMusicSignals` json,
  ADD COLUMN `mentionMusicArtists` json,
  ADD COLUMN `mentionTotalCount` int DEFAULT 0,
  ADD COLUMN `mentionUniqueAuthors` int DEFAULT 0,
  ADD COLUMN `mentionAudienceSummary` text;

-- match_records: Music Overlap + Cultural Exchange columns
ALTER TABLE `match_records`
  ADD COLUMN `musicOverlap` json,
  ADD COLUMN `culturalBorrowingSummary` text;
