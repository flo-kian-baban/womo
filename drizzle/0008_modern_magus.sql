ALTER TABLE `match_records` ADD `verifiedFITScore` int;--> statement-breakpoint
ALTER TABLE `match_records` ADD `verifiedFITLabel` varchar(64);--> statement-breakpoint
ALTER TABLE `match_records` ADD `verifiedFITSignalBreakdown` json;--> statement-breakpoint
ALTER TABLE `match_records` ADD `symbolicOverlapScore` float;--> statement-breakpoint
ALTER TABLE `match_records` ADD `sharedKeywords` json;--> statement-breakpoint
ALTER TABLE `match_records` ADD `sharedThemes` json;--> statement-breakpoint
ALTER TABLE `match_records` ADD `synergyNarrative` text;--> statement-breakpoint
ALTER TABLE `match_records` ADD `contentDirections` json;