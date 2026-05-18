ALTER TABLE `brand_profiles` ADD `yelpRating` float;--> statement-breakpoint
ALTER TABLE `brand_profiles` ADD `yelpReviewCount` int;--> statement-breakpoint
ALTER TABLE `brand_profiles` ADD `yelpReviewExcerpts` text;--> statement-breakpoint
ALTER TABLE `brand_profiles` ADD `googleRating` float;--> statement-breakpoint
ALTER TABLE `brand_profiles` ADD `googleReviewCount` int;--> statement-breakpoint
ALTER TABLE `brand_profiles` ADD `googleReviewExcerpts` text;--> statement-breakpoint
ALTER TABLE `brand_profiles` ADD `combinedReviewText` text;--> statement-breakpoint
ALTER TABLE `brand_profiles` ADD `overallRating` float;--> statement-breakpoint
ALTER TABLE `brand_profiles` ADD `totalReviews` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `creator_profiles` ADD `pronouns` enum('she/her','he/him','they/them','not specified');