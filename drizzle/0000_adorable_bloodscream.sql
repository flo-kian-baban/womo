CREATE TYPE "public"."archetype" AS ENUM('The Sage', 'The Hero', 'The Outlaw', 'The Explorer', 'The Magician', 'The Ruler', 'The Caregiver', 'The Lover', 'The Jester', 'The Innocent', 'The Everyman', 'The Creator');--> statement-breakpoint
CREATE TYPE "public"."audience_relationship" AS ENUM('Friend', 'Mentor', 'Authority');--> statement-breakpoint
CREATE TYPE "public"."brand_archetype" AS ENUM('Trust', 'Community', 'Momentum');--> statement-breakpoint
CREATE TYPE "public"."campaign_type" AS ENUM('Heritage/Luxury', 'Trend-First', 'Long-Term Ambassador', 'Product Launch', 'Community/Local', 'Awareness/Consideration');--> statement-breakpoint
CREATE TYPE "public"."confidence_level" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."cultural_capital" AS ENUM('Produce', 'Relay');--> statement-breakpoint
CREATE TYPE "public"."cultural_velocity" AS ENUM('Focusing', 'Drifting', 'Insufficient Data');--> statement-breakpoint
CREATE TYPE "public"."drift_signal" AS ENUM('Zero Change', 'Minor Drift', 'Significant Drift', 'Full Pivot');--> statement-breakpoint
CREATE TYPE "public"."engagement_tier" AS ENUM('nano', 'micro', 'mid', 'macro', 'mega');--> statement-breakpoint
CREATE TYPE "public"."fit_status" AS ENUM('Green Light', 'Proceed with Caution', 'Do Not Proceed');--> statement-breakpoint
CREATE TYPE "public"."goffman_consistency" AS ENUM('Consistent', 'Minor Gap', 'Significant Gap');--> statement-breakpoint
CREATE TYPE "public"."hall_decoding" AS ENUM('Dominant', 'Negotiated', 'Oppositional');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_phase" AS ENUM('Emergence', 'Growth', 'Maturity', 'Decline');--> statement-breakpoint
CREATE TYPE "public"."liminal_phase" AS ENUM('Pre-Liminal', 'Liminal', 'Post-Liminal Reintegration');--> statement-breakpoint
CREATE TYPE "public"."niche_position" AS ENUM('Ahead', 'Consistent', 'Behind');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('tiktok', 'instagram', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."pronouns" AS ENUM('she/her', 'he/him', 'they/them', 'not specified');--> statement-breakpoint
CREATE TYPE "public"."rogers_stage" AS ENUM('Innovators', 'Early Adopters', 'Early Majority', 'Late Majority', 'Laggards');--> statement-breakpoint
CREATE TYPE "public"."scrape_method" AS ENUM('tiktok_desktop_http', 'tiktok_mobile_http', 'tiktok_playwright', 'tiktok_google_cache', 'tiktok_search_xhr', 'tiktok_search_html', 'instagram_playwright', 'instagram_picuki', 'instagram_oembed', 'youtube_api', 'youtube_html', 'google_maps_api', 'google_search', 'website_crawl', 'whisper_transcription', 'manual_entry');--> statement-breakpoint
CREATE TYPE "public"."sentiment" AS ENUM('positive', 'mixed', 'negative', 'insufficient_data');--> statement-breakpoint
CREATE TYPE "public"."signal_confidence" AS ENUM('Verified', 'Estimated', 'Insufficient Data');--> statement-breakpoint
CREATE TYPE "public"."signal_domain" AS ENUM('keyword', 'hashtag', 'content_theme', 'theme', 'visual_language', 'symbolic_vocabulary', 'music_title', 'music_artist', 'identity_claim', 'status_signal', 'community_reference', 'aspiration_driver', 'audience_language');--> statement-breakpoint
CREATE TYPE "public"."subject_type" AS ENUM('creator', 'brand');--> statement-breakpoint
CREATE TYPE "public"."warning_type" AS ENUM('Low Alignment', 'Archetype Tension', 'Identity Instability', 'Low Pulse', 'Trajectory Divergence', 'Low Social Engagement', 'Negative Audience Sentiment');--> statement-breakpoint
CREATE TABLE "archetype_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"from_archetype" "archetype" NOT NULL,
	"to_archetype" "archetype" NOT NULL,
	"from_observation_id" uuid NOT NULL,
	"to_observation_id" uuid NOT NULL,
	"days_between" integer,
	"engagement_delta" real,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"observation_id" uuid,
	"platform" "platform" NOT NULL,
	"mention_video_id" varchar(255),
	"author_handle_hash" text,
	"caption" text,
	"sentiment" "sentiment",
	"view_count" integer,
	"like_count" integer,
	"comment_count" integer,
	"share_count" integer,
	"save_count" integer,
	"music_title" varchar(512),
	"music_artist" varchar(255),
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observation_id" uuid NOT NULL,
	"brand_archetype_classification" "brand_archetype",
	"archetype" "archetype",
	"emotional_promise" text,
	"audience_tribe" text,
	"cultural_tension" text,
	"brand_tone" text,
	"barthes_myth" text,
	"brand_cultural_capital" "cultural_capital",
	"brand_goffman_consistency" "goffman_consistency",
	"brand_drift_signal" "drift_signal",
	"brand_hall_decoding" "hall_decoding",
	"brand_rogers_stage" "rogers_stage",
	"brand_liminal_phase" "liminal_phase",
	"brand_lifecycle_phase" "lifecycle_phase",
	"brand_barthes_niche_meaning" text,
	"brand_audience_decoding_split" boolean,
	"weight_alpha" real,
	"weight_beta" real,
	"weight_gamma" real,
	"weight_priority" text,
	"google_rating" real,
	"google_review_count" integer,
	"yelp_rating" real,
	"yelp_review_count" integer,
	"overall_rating" real,
	"total_reviews" integer,
	"tiktok_handle" varchar(255),
	"tiktok_follower_count" integer,
	"tiktok_engagement_rate" real,
	"mention_total_count" integer,
	"mention_unique_authors" integer,
	"mention_sentiment" "sentiment",
	"mention_sentiment_confidence" "confidence_level",
	"mention_audience_summary" text,
	"symbolic_summary" text,
	"ai_summary" text,
	CONSTRAINT "brand_observations_observation_id_unique" UNIQUE("observation_id")
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"observation_id" uuid,
	"platform" "platform" NOT NULL,
	"platform_video_id" varchar(255),
	"video_url" text,
	"caption" text,
	"transcript_text" text,
	"transcript_source" varchar(32),
	"transcript_word_count" integer,
	"video_duration" real,
	"create_time" timestamp with time zone,
	"region" varchar(128),
	"temporal_bucket" varchar(16),
	"like_count" integer,
	"comment_count" integer,
	"share_count" integer,
	"view_count" integer,
	"save_count" integer,
	"music_title" varchar(512),
	"music_artist" varchar(255),
	"is_original_audio" boolean,
	"status" varchar(32) DEFAULT 'sampled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observation_id" uuid NOT NULL,
	"total_likes" integer,
	"video_count" integer,
	"total_views" integer,
	"avg_views" integer,
	"avg_video_duration" real,
	"primary_region" varchar(255),
	"archetype" "archetype",
	"tone_register" text,
	"parasocial_bond_strength" real,
	"audience_relationship_type" "audience_relationship",
	"barthes_myth" text,
	"cultural_capital" "cultural_capital",
	"goffman_stage_consistency" "goffman_consistency",
	"drift_signal" "drift_signal",
	"stuart_hall_decoding" "hall_decoding",
	"niche_id" uuid,
	"niche_topic_node" text,
	"underground_density" boolean,
	"mainstream_bleed" boolean,
	"remix_rate" boolean,
	"brand_saturation" boolean,
	"rogers_adopter_stage" "rogers_stage",
	"creator_niche_position" "niche_position",
	"lifecycle_phase" "lifecycle_phase",
	"barthes_niche_meaning" text,
	"turner_liminal_phase" "liminal_phase",
	"cultural_velocity" "cultural_velocity",
	"engagement_quality_score" real,
	"engagement_quality_confidence" "signal_confidence",
	"symbolic_summary" text,
	"ai_summary" text,
	CONSTRAINT "creator_observations_observation_id_unique" UNIQUE("observation_id")
);
--> statement-breakpoint
CREATE TABLE "decoded_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"category" "signal_domain" NOT NULL,
	"phrase" text NOT NULL,
	"meaning" text NOT NULL,
	"informs_fields" text[],
	"source" varchar(32)
);
--> statement-breakpoint
CREATE TABLE "llm_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observation_id" uuid,
	"match_score_id" uuid,
	"subject_id" uuid,
	"purpose" varchar(64) NOT NULL,
	"model" varchar(128) NOT NULL,
	"prompt_version" varchar(32),
	"temperature" real,
	"input_tokens" integer,
	"output_tokens" integer,
	"response_json" jsonb,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_content_directions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_score_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"rationale" text NOT NULL,
	"example_angle" text NOT NULL,
	"rank" integer
);
--> statement-breakpoint
CREATE TABLE "match_narratives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_score_id" uuid NOT NULL,
	"narrative_summary" text,
	"alignment_narrative" text,
	"synergy_narrative" text,
	"cultural_borrowing_summary" text,
	"archetype_analysis" text,
	"myth_alignment" text,
	"audience_overlap" text,
	"cultural_momentum" text,
	"identity_stability" text,
	"recommendation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_overlaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_score_id" uuid NOT NULL,
	"domain" "signal_domain" NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_subject_id" uuid NOT NULL,
	"brand_subject_id" uuid NOT NULL,
	"creator_observation_id" uuid,
	"brand_observation_id" uuid,
	"alignment_score_raw" real,
	"pulse_score_raw" real,
	"stability_score_raw" real,
	"archetype_match_score" real,
	"myth_alignment_score" real,
	"trib_match_score" real,
	"decoding_modifier" real,
	"rogers_base_score" real,
	"liminal_adjustment" real,
	"goffman_score" real,
	"drift_score" real,
	"weight_alpha" real,
	"weight_beta" real,
	"weight_gamma" real,
	"fit_score" real,
	"fit_status" "fit_status",
	"parr_score" integer,
	"parr_label" varchar(64),
	"parr_tribe_overlap" real,
	"parr_decoding_acceptance" real,
	"parr_archetype_resonance" real,
	"parr_symbolic_overlap" real,
	"parr_persona_consistency" real,
	"symbolic_overlap_score" real,
	"qov_score" real,
	"creative_integrity_signal" real,
	"creative_integrity_confidence" "signal_confidence",
	"performance_consistency_signal" real,
	"performance_consistency_confidence" "signal_confidence",
	"community_quality_signal" real,
	"community_quality_confidence" "signal_confidence",
	"audience_receptivity_signal" real,
	"audience_receptivity_confidence" "signal_confidence",
	"brand_trust_signal" real,
	"brand_trust_confidence" "signal_confidence",
	"cultural_identity_signal" real,
	"cultural_identity_confidence" "signal_confidence",
	"cultural_momentum_signal" real,
	"cultural_momentum_confidence" "signal_confidence",
	"partnership_stability_signal" real,
	"partnership_stability_confidence" "signal_confidence",
	"music_overlap_strength" varchar(16),
	"mention_sentiment_penalty" real,
	"mention_vocab_boost" real,
	"cultural_velocity" "cultural_velocity",
	"data_confidence_level" "confidence_level",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_warnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_score_id" uuid NOT NULL,
	"warning_type" "warning_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "niche_taxonomy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(128) NOT NULL,
	"label" text NOT NULL,
	"parent_id" uuid,
	"level" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "niche_taxonomy_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"is_latest" boolean DEFAULT true NOT NULL,
	"follower_count" integer,
	"following_count" integer,
	"engagement_rate" real,
	"bio" text,
	"data_confidence_level" "confidence_level",
	"transcript_count" integer DEFAULT 0,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_type" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"total_items" integer DEFAULT 0,
	"completed_items" integer DEFAULT 0,
	"failed_items" integer DEFAULT 0,
	"error_log" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_handles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"handle" varchar(255) NOT NULL,
	"profile_url" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observation_id" uuid,
	"subject_id" uuid,
	"platform" "platform",
	"scrape_method" "scrape_method" NOT NULL,
	"url_requested" text,
	"http_status" integer,
	"response_size_bytes" integer,
	"silent_failure_detected" boolean DEFAULT false,
	"failure_reason" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "semantic_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"observation_id" uuid,
	"document_type" varchar(64) NOT NULL,
	"content_text" text NOT NULL,
	"token_count" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"domain" "signal_domain" NOT NULL,
	"signal_key" varchar(512) NOT NULL,
	"signal_value" text,
	"confidence" real,
	"source" varchar(64),
	"rank" integer
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" "subject_type" NOT NULL,
	"display_name" text,
	"primary_handle" varchar(255),
	"primary_platform" "platform",
	"profile_url" text,
	"website_url" text,
	"pronouns" "pronouns",
	"latest_archetype" "archetype",
	"latest_brand_archetype" "brand_archetype",
	"brand_type" varchar(255),
	"brand_category" text,
	"campaign_type" "campaign_type",
	"engagement_tier" "engagement_tier",
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"open_id" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"login_method" varchar(64),
	"role" varchar(16) DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_signed_in" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_open_id_unique" UNIQUE("open_id")
);
--> statement-breakpoint
ALTER TABLE "archetype_transitions" ADD CONSTRAINT "archetype_transitions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archetype_transitions" ADD CONSTRAINT "archetype_transitions_from_observation_id_observations_id_fk" FOREIGN KEY ("from_observation_id") REFERENCES "public"."observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archetype_transitions" ADD CONSTRAINT "archetype_transitions_to_observation_id_observations_id_fk" FOREIGN KEY ("to_observation_id") REFERENCES "public"."observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_mentions" ADD CONSTRAINT "audience_mentions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_mentions" ADD CONSTRAINT "audience_mentions_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_observations" ADD CONSTRAINT "brand_observations_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_observations" ADD CONSTRAINT "creator_observations_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_observations" ADD CONSTRAINT "creator_observations_niche_id_niche_taxonomy_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niche_taxonomy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decoded_signals" ADD CONSTRAINT "decoded_signals_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decoded_signals" ADD CONSTRAINT "decoded_signals_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_invocations" ADD CONSTRAINT "llm_invocations_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_invocations" ADD CONSTRAINT "llm_invocations_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_content_directions" ADD CONSTRAINT "match_content_directions_match_score_id_match_scores_id_fk" FOREIGN KEY ("match_score_id") REFERENCES "public"."match_scores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_narratives" ADD CONSTRAINT "match_narratives_match_score_id_match_scores_id_fk" FOREIGN KEY ("match_score_id") REFERENCES "public"."match_scores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_overlaps" ADD CONSTRAINT "match_overlaps_match_score_id_match_scores_id_fk" FOREIGN KEY ("match_score_id") REFERENCES "public"."match_scores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_scores" ADD CONSTRAINT "match_scores_creator_subject_id_subjects_id_fk" FOREIGN KEY ("creator_subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_scores" ADD CONSTRAINT "match_scores_brand_subject_id_subjects_id_fk" FOREIGN KEY ("brand_subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_scores" ADD CONSTRAINT "match_scores_creator_observation_id_observations_id_fk" FOREIGN KEY ("creator_observation_id") REFERENCES "public"."observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_scores" ADD CONSTRAINT "match_scores_brand_observation_id_observations_id_fk" FOREIGN KEY ("brand_observation_id") REFERENCES "public"."observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_warnings" ADD CONSTRAINT "match_warnings_match_score_id_match_scores_id_fk" FOREIGN KEY ("match_score_id") REFERENCES "public"."match_scores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_handles" ADD CONSTRAINT "platform_handles_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_events" ADD CONSTRAINT "scrape_events_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_events" ADD CONSTRAINT "scrape_events_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic_documents" ADD CONSTRAINT "semantic_documents_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic_documents" ADD CONSTRAINT "semantic_documents_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_values" ADD CONSTRAINT "signal_values_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_values" ADD CONSTRAINT "signal_values_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "at_subject_idx" ON "archetype_transitions" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "at_transition_idx" ON "archetype_transitions" USING btree ("from_archetype","to_archetype");--> statement-breakpoint
CREATE INDEX "am_subject_sentiment_idx" ON "audience_mentions" USING btree ("subject_id","sentiment");--> statement-breakpoint
CREATE INDEX "am_subject_time_idx" ON "audience_mentions" USING btree ("subject_id","collected_at");--> statement-breakpoint
CREATE INDEX "am_observation_idx" ON "audience_mentions" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "bo_observation_idx" ON "brand_observations" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "bo_brand_arch_idx" ON "brand_observations" USING btree ("brand_archetype_classification");--> statement-breakpoint
CREATE INDEX "bo_sentiment_idx" ON "brand_observations" USING btree ("mention_sentiment");--> statement-breakpoint
CREATE INDEX "ci_subject_idx" ON "content_items" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "ci_observation_idx" ON "content_items" USING btree ("observation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ci_platform_video_idx" ON "content_items" USING btree ("platform","platform_video_id","subject_id");--> statement-breakpoint
CREATE INDEX "ci_status_idx" ON "content_items" USING btree ("subject_id","status");--> statement-breakpoint
CREATE INDEX "ci_time_idx" ON "content_items" USING btree ("subject_id","create_time");--> statement-breakpoint
CREATE INDEX "co_observation_idx" ON "creator_observations" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "co_archetype_idx" ON "creator_observations" USING btree ("archetype");--> statement-breakpoint
CREATE INDEX "co_rogers_idx" ON "creator_observations" USING btree ("rogers_adopter_stage");--> statement-breakpoint
CREATE INDEX "co_lifecycle_idx" ON "creator_observations" USING btree ("lifecycle_phase");--> statement-breakpoint
CREATE INDEX "co_niche_idx" ON "creator_observations" USING btree ("niche_id");--> statement-breakpoint
CREATE INDEX "ds_subject_idx" ON "decoded_signals" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "ds_observation_idx" ON "decoded_signals" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "ds_category_idx" ON "decoded_signals" USING btree ("category");--> statement-breakpoint
CREATE INDEX "ds_phrase_idx" ON "decoded_signals" USING btree ("phrase");--> statement-breakpoint
CREATE INDEX "llm_observation_idx" ON "llm_invocations" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "llm_purpose_idx" ON "llm_invocations" USING btree ("purpose");--> statement-breakpoint
CREATE INDEX "llm_model_idx" ON "llm_invocations" USING btree ("model");--> statement-breakpoint
CREATE INDEX "mcd_match_idx" ON "match_content_directions" USING btree ("match_score_id");--> statement-breakpoint
CREATE INDEX "mn_match_idx" ON "match_narratives" USING btree ("match_score_id");--> statement-breakpoint
CREATE INDEX "mo_match_idx" ON "match_overlaps" USING btree ("match_score_id");--> statement-breakpoint
CREATE INDEX "mo_domain_idx" ON "match_overlaps" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "ms_creator_idx" ON "match_scores" USING btree ("creator_subject_id");--> statement-breakpoint
CREATE INDEX "ms_brand_idx" ON "match_scores" USING btree ("brand_subject_id");--> statement-breakpoint
CREATE INDEX "ms_fit_score_idx" ON "match_scores" USING btree ("fit_score");--> statement-breakpoint
CREATE INDEX "ms_brand_fit_idx" ON "match_scores" USING btree ("brand_subject_id","fit_score");--> statement-breakpoint
CREATE INDEX "ms_creator_fit_idx" ON "match_scores" USING btree ("creator_subject_id","fit_score");--> statement-breakpoint
CREATE UNIQUE INDEX "ms_pair_idx" ON "match_scores" USING btree ("creator_subject_id","brand_subject_id","created_at");--> statement-breakpoint
CREATE INDEX "mw_match_idx" ON "match_warnings" USING btree ("match_score_id");--> statement-breakpoint
CREATE INDEX "mw_type_idx" ON "match_warnings" USING btree ("warning_type");--> statement-breakpoint
CREATE UNIQUE INDEX "nt_slug_idx" ON "niche_taxonomy" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "nt_parent_idx" ON "niche_taxonomy" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "nt_level_idx" ON "niche_taxonomy" USING btree ("level");--> statement-breakpoint
CREATE INDEX "obs_subject_idx" ON "observations" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "obs_latest_idx" ON "observations" USING btree ("subject_id","is_latest");--> statement-breakpoint
CREATE INDEX "obs_time_idx" ON "observations" USING btree ("subject_id","observed_at");--> statement-breakpoint
CREATE INDEX "pr_status_idx" ON "pipeline_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "handles_subject_idx" ON "platform_handles" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "handles_lookup_idx" ON "platform_handles" USING btree ("platform","handle");--> statement-breakpoint
CREATE INDEX "se_observation_idx" ON "scrape_events" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "se_method_idx" ON "scrape_events" USING btree ("scrape_method");--> statement-breakpoint
CREATE INDEX "se_failure_idx" ON "scrape_events" USING btree ("silent_failure_detected");--> statement-breakpoint
CREATE INDEX "sd_subject_idx" ON "semantic_documents" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "sd_type_idx" ON "semantic_documents" USING btree ("document_type");--> statement-breakpoint
CREATE INDEX "sd_observation_idx" ON "semantic_documents" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "sv_subject_domain_idx" ON "signal_values" USING btree ("subject_id","domain");--> statement-breakpoint
CREATE INDEX "sv_observation_idx" ON "signal_values" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "sv_key_idx" ON "signal_values" USING btree ("signal_key");--> statement-breakpoint
CREATE INDEX "sv_domain_key_idx" ON "signal_values" USING btree ("domain","signal_key");--> statement-breakpoint
CREATE INDEX "subjects_type_idx" ON "subjects" USING btree ("subject_type");--> statement-breakpoint
CREATE INDEX "subjects_handle_idx" ON "subjects" USING btree ("primary_handle");--> statement-breakpoint
CREATE INDEX "subjects_archetype_idx" ON "subjects" USING btree ("latest_archetype");--> statement-breakpoint
CREATE INDEX "subjects_brand_arch_idx" ON "subjects" USING btree ("latest_brand_archetype");--> statement-breakpoint
CREATE INDEX "subjects_tier_idx" ON "subjects" USING btree ("engagement_tier");--> statement-breakpoint
CREATE INDEX "subjects_matching_idx" ON "subjects" USING btree ("subject_type","latest_archetype","engagement_tier","primary_platform");