ALTER TABLE `creator_profiles` MODIFY COLUMN `platform` enum('TikTok','Instagram','YouTube','Multi') NOT NULL;--> statement-breakpoint
ALTER TABLE `creator_profiles` ADD `transcriptCount` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `creator_profiles` ADD `transcriptExcerpts` text;