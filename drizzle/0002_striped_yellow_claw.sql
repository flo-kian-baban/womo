ALTER TABLE `creator_profiles` MODIFY COLUMN `platform` enum('TikTok','YouTube','Multi') NOT NULL;--> statement-breakpoint
ALTER TABLE `creator_profiles` ADD `followerCount` int;--> statement-breakpoint
ALTER TABLE `creator_profiles` ADD `totalLikes` int;--> statement-breakpoint
ALTER TABLE `creator_profiles` ADD `videoCount` int;--> statement-breakpoint
ALTER TABLE `creator_profiles` ADD `totalViews` int;--> statement-breakpoint
ALTER TABLE `creator_profiles` ADD `avgViews` int;--> statement-breakpoint
ALTER TABLE `creator_profiles` ADD `engagementRate` float;--> statement-breakpoint
ALTER TABLE `creator_profiles` ADD `location` text;--> statement-breakpoint
ALTER TABLE `creator_profiles` ADD `rawKeywords` json;--> statement-breakpoint
ALTER TABLE `creator_profiles` ADD `contentThemeLabels` json;--> statement-breakpoint
ALTER TABLE `creator_profiles` ADD `topHashtags` json;--> statement-breakpoint
ALTER TABLE `creator_profiles` ADD `recentVideoTitles` json;