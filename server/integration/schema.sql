--
-- PostgreSQL database dump
--

\restrict h2Z30PzQjP5cv8HDUKyrENPscVzySjJqUmJ90qACE9ntTychGUZbMb7QlqQe6k1

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: archetype; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.archetype AS ENUM (
    'The Sage',
    'The Hero',
    'The Outlaw',
    'The Explorer',
    'The Magician',
    'The Ruler',
    'The Caregiver',
    'The Lover',
    'The Jester',
    'The Innocent',
    'The Everyman',
    'The Creator'
);


--
-- Name: audience_relationship; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.audience_relationship AS ENUM (
    'Friend',
    'Mentor',
    'Authority'
);


--
-- Name: brand_archetype; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.brand_archetype AS ENUM (
    'Trust',
    'Community',
    'Momentum'
);


--
-- Name: campaign_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.campaign_type AS ENUM (
    'Heritage/Luxury',
    'Trend-First',
    'Long-Term Ambassador',
    'Product Launch',
    'Community/Local',
    'Awareness/Consideration'
);


--
-- Name: confidence_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.confidence_level AS ENUM (
    'high',
    'medium',
    'low'
);


--
-- Name: cultural_capital; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cultural_capital AS ENUM (
    'Produce',
    'Relay'
);


--
-- Name: cultural_velocity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cultural_velocity AS ENUM (
    'Focusing',
    'Drifting',
    'Insufficient Data'
);


--
-- Name: drift_signal; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.drift_signal AS ENUM (
    'Zero Change',
    'Minor Drift',
    'Significant Drift',
    'Full Pivot'
);


--
-- Name: engagement_tier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.engagement_tier AS ENUM (
    'nano',
    'micro',
    'mid',
    'macro',
    'mega'
);


--
-- Name: fit_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.fit_status AS ENUM (
    'Green Light',
    'Proceed with Caution',
    'Do Not Proceed'
);


--
-- Name: goffman_consistency; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.goffman_consistency AS ENUM (
    'Consistent',
    'Minor Gap',
    'Significant Gap'
);


--
-- Name: hall_decoding; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.hall_decoding AS ENUM (
    'Dominant',
    'Negotiated',
    'Oppositional'
);


--
-- Name: lifecycle_phase; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.lifecycle_phase AS ENUM (
    'Emergence',
    'Growth',
    'Maturity',
    'Decline'
);


--
-- Name: liminal_phase; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.liminal_phase AS ENUM (
    'Pre-Liminal',
    'Liminal',
    'Post-Liminal Reintegration'
);


--
-- Name: niche_position; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.niche_position AS ENUM (
    'Ahead',
    'Consistent',
    'Behind'
);


--
-- Name: platform; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.platform AS ENUM (
    'tiktok',
    'instagram',
    'youtube',
    'google_maps',
    'yelp'
);


--
-- Name: pronouns; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.pronouns AS ENUM (
    'she/her',
    'he/him',
    'they/them',
    'not specified'
);


--
-- Name: rogers_stage; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.rogers_stage AS ENUM (
    'Innovators',
    'Early Adopters',
    'Early Majority',
    'Late Majority',
    'Laggards'
);


--
-- Name: scrape_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.scrape_method AS ENUM (
    'tiktok_desktop_http',
    'tiktok_mobile_http',
    'tiktok_playwright',
    'tiktok_google_cache',
    'tiktok_search_xhr',
    'tiktok_search_html',
    'instagram_playwright',
    'instagram_picuki',
    'instagram_oembed',
    'youtube_api',
    'youtube_html',
    'google_maps_api',
    'google_search',
    'website_crawl',
    'whisper_transcription',
    'manual_entry',
    'google_maps_http'
);


--
-- Name: sentiment; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sentiment AS ENUM (
    'positive',
    'mixed',
    'negative',
    'insufficient_data'
);


--
-- Name: signal_confidence; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.signal_confidence AS ENUM (
    'Verified',
    'Estimated',
    'Insufficient Data'
);


--
-- Name: signal_domain; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.signal_domain AS ENUM (
    'keyword',
    'hashtag',
    'content_theme',
    'theme',
    'visual_language',
    'symbolic_vocabulary',
    'music_title',
    'music_artist',
    'identity_claim',
    'status_signal',
    'community_reference',
    'aspiration_driver',
    'audience_language'
);


--
-- Name: subject_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subject_type AS ENUM (
    'creator',
    'brand'
);


--
-- Name: warning_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.warning_type AS ENUM (
    'Low Alignment',
    'Archetype Tension',
    'Identity Instability',
    'Low Pulse',
    'Trajectory Divergence',
    'Low Social Engagement',
    'Negative Audience Sentiment'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: archetype_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.archetype_transitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    from_archetype public.archetype NOT NULL,
    to_archetype public.archetype NOT NULL,
    from_observation_id uuid NOT NULL,
    to_observation_id uuid NOT NULL,
    days_between integer,
    engagement_delta real,
    detected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audience_mentions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audience_mentions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    observation_id uuid,
    platform public.platform NOT NULL,
    mention_video_id character varying(255),
    author_handle_hash text,
    caption text,
    sentiment public.sentiment,
    view_count integer,
    like_count integer,
    comment_count integer,
    share_count integer,
    save_count integer,
    music_title character varying(512),
    music_artist character varying(255),
    collected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: brand_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    observation_id uuid NOT NULL,
    brand_archetype_classification public.brand_archetype,
    archetype public.archetype,
    emotional_promise text,
    audience_tribe text,
    cultural_tension text,
    brand_tone text,
    barthes_myth text,
    brand_cultural_capital public.cultural_capital,
    brand_goffman_consistency public.goffman_consistency,
    brand_drift_signal public.drift_signal,
    brand_hall_decoding public.hall_decoding,
    brand_rogers_stage public.rogers_stage,
    brand_liminal_phase public.liminal_phase,
    brand_lifecycle_phase public.lifecycle_phase,
    brand_barthes_niche_meaning text,
    brand_audience_decoding_split boolean,
    weight_alpha real,
    weight_beta real,
    weight_gamma real,
    weight_priority text,
    google_rating real,
    google_review_count integer,
    yelp_rating real,
    yelp_review_count integer,
    overall_rating real,
    total_reviews integer,
    tiktok_handle character varying(255),
    tiktok_follower_count integer,
    tiktok_engagement_rate real,
    mention_total_count integer,
    mention_unique_authors integer,
    mention_sentiment public.sentiment,
    mention_sentiment_confidence public.confidence_level,
    mention_audience_summary text,
    symbolic_summary text,
    ai_summary text,
    google_review_excerpts text,
    yelp_review_excerpts text,
    semantic_word_count integer,
    crawled_pages_count integer
);


--
-- Name: content_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    observation_id uuid,
    platform public.platform NOT NULL,
    platform_video_id character varying(255),
    video_url text,
    caption text,
    transcript_text text,
    transcript_source character varying(32),
    transcript_word_count integer,
    video_duration real,
    create_time timestamp with time zone,
    region character varying(128),
    temporal_bucket character varying(16),
    like_count bigint,
    comment_count bigint,
    share_count bigint,
    view_count bigint,
    save_count bigint,
    music_title character varying(512),
    music_artist character varying(255),
    is_original_audio boolean,
    status character varying(32) DEFAULT 'sampled'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: creator_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.creator_observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    observation_id uuid NOT NULL,
    total_likes bigint,
    video_count integer,
    total_views bigint,
    avg_views integer,
    avg_video_duration real,
    primary_region character varying(255),
    archetype public.archetype,
    tone_register text,
    parasocial_bond_strength real,
    audience_relationship_type public.audience_relationship,
    barthes_myth text,
    cultural_capital public.cultural_capital,
    goffman_stage_consistency public.goffman_consistency,
    drift_signal public.drift_signal,
    stuart_hall_decoding public.hall_decoding,
    niche_id uuid,
    niche_topic_node text,
    underground_density boolean,
    mainstream_bleed boolean,
    remix_rate boolean,
    brand_saturation boolean,
    rogers_adopter_stage public.rogers_stage,
    creator_niche_position public.niche_position,
    lifecycle_phase public.lifecycle_phase,
    barthes_niche_meaning text,
    turner_liminal_phase public.liminal_phase,
    cultural_velocity public.cultural_velocity,
    engagement_quality_score real,
    engagement_quality_confidence public.signal_confidence,
    symbolic_summary text,
    ai_summary text
);


--
-- Name: decoded_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decoded_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    observation_id uuid NOT NULL,
    category public.signal_domain NOT NULL,
    phrase text NOT NULL,
    meaning text NOT NULL,
    informs_fields text[],
    source character varying(32)
);


--
-- Name: llm_invocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_invocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    observation_id uuid,
    match_score_id uuid,
    subject_id uuid,
    purpose character varying(64) NOT NULL,
    model character varying(128) NOT NULL,
    prompt_version character varying(32),
    temperature real,
    input_tokens integer,
    output_tokens integer,
    response_json jsonb,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(16) DEFAULT 'success'::character varying NOT NULL,
    error_message text,
    run_id uuid,
    CONSTRAINT llm_invocations_status_check CHECK (((status)::text = ANY ((ARRAY['success'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: match_content_directions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_content_directions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    match_score_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    rationale text NOT NULL,
    example_angle text NOT NULL,
    rank integer
);


--
-- Name: match_narratives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_narratives (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    match_score_id uuid NOT NULL,
    narrative_summary text,
    alignment_narrative text,
    synergy_narrative text,
    cultural_borrowing_summary text,
    archetype_analysis text,
    myth_alignment text,
    audience_overlap text,
    cultural_momentum text,
    identity_stability text,
    recommendation text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: match_overlaps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_overlaps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    match_score_id uuid NOT NULL,
    domain public.signal_domain NOT NULL,
    value text NOT NULL
);


--
-- Name: match_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_subject_id uuid NOT NULL,
    brand_subject_id uuid NOT NULL,
    creator_observation_id uuid,
    brand_observation_id uuid,
    alignment_score_raw real,
    pulse_score_raw real,
    stability_score_raw real,
    archetype_match_score real,
    myth_alignment_score real,
    trib_match_score real,
    decoding_modifier real,
    rogers_base_score real,
    liminal_adjustment real,
    goffman_score real,
    drift_score real,
    weight_alpha real,
    weight_beta real,
    weight_gamma real,
    fit_score real,
    fit_status public.fit_status,
    parr_score integer,
    parr_label character varying(64),
    parr_tribe_overlap real,
    parr_decoding_acceptance real,
    parr_archetype_resonance real,
    parr_symbolic_overlap real,
    parr_persona_consistency real,
    symbolic_overlap_score real,
    qov_score real,
    creative_integrity_signal real,
    creative_integrity_confidence public.signal_confidence,
    performance_consistency_signal real,
    performance_consistency_confidence public.signal_confidence,
    community_quality_signal real,
    community_quality_confidence public.signal_confidence,
    audience_receptivity_signal real,
    audience_receptivity_confidence public.signal_confidence,
    brand_trust_signal real,
    brand_trust_confidence public.signal_confidence,
    cultural_identity_signal real,
    cultural_identity_confidence public.signal_confidence,
    cultural_momentum_signal real,
    cultural_momentum_confidence public.signal_confidence,
    partnership_stability_signal real,
    partnership_stability_confidence public.signal_confidence,
    music_overlap_strength character varying(16),
    mention_sentiment_penalty real,
    mention_vocab_boost real,
    cultural_velocity public.cultural_velocity,
    data_confidence_level public.confidence_level,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: match_warnings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_warnings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    match_score_id uuid NOT NULL,
    warning_type public.warning_type NOT NULL
);


--
-- Name: niche_taxonomy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.niche_taxonomy (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(128) NOT NULL,
    label text NOT NULL,
    parent_id uuid,
    level integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    is_latest boolean DEFAULT true NOT NULL,
    follower_count bigint,
    following_count bigint,
    engagement_rate real,
    bio text,
    data_confidence_level public.confidence_level,
    transcript_count integer DEFAULT 0,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    persistence_status jsonb,
    review_status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by character varying(64),
    run_id uuid,
    CONSTRAINT observations_persistence_status_check CHECK (((persistence_status IS NULL) OR (jsonb_typeof(persistence_status) = 'object'::text))),
    CONSTRAINT observations_review_status_check CHECK (((review_status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'declined'::character varying])::text[])))
);


--
-- Name: COLUMN observations.persistence_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.observations.persistence_status IS 'Per-component enrichment persistence outcomes for this observation run: {component: {status, reason, at}}. Status vocabulary: success | failed | skipped_no_data (subject genuinely has no such data) | skipped_not_attempted (write not attempted — config/feature gap). NULL = row predates womo_0005 tracking.';


--
-- Name: COLUMN observations.review_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.observations.review_status IS 'Analyst review gate (womo_0006): pending (awaiting review) | accepted (in corpus, matchable) | declined (archived — hidden from library/matching but retained with full provenance; never hard-deleted). Rows created before womo_0006 were backfilled to accepted (they predate the gate).';


--
-- Name: COLUMN observations.reviewed_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.observations.reviewed_by IS 'Free-text analyst name (two analysts, PIN auth carries no identity — no user system).';


--
-- Name: COLUMN observations.run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.observations.run_id IS 'Correlation id for the analysis run that produced this observation (womo_0006). Joins scrape_events.run_id and llm_invocations.run_id for exact per-run diagnostics. NULL = row predates run tracking.';


--
-- Name: pipeline_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_type character varying(64) NOT NULL,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    total_items integer DEFAULT 0,
    completed_items integer DEFAULT 0,
    failed_items integer DEFAULT 0,
    error_log jsonb,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_handles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_handles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    platform public.platform NOT NULL,
    handle character varying(255) NOT NULL,
    profile_url text,
    is_primary boolean DEFAULT false NOT NULL,
    discovered_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scrape_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scrape_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    observation_id uuid,
    subject_id uuid,
    platform public.platform,
    scrape_method public.scrape_method NOT NULL,
    url_requested text,
    http_status integer,
    response_size_bytes integer,
    silent_failure_detected boolean DEFAULT false,
    failure_reason text,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    run_id uuid
);


--
-- Name: semantic_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.semantic_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    observation_id uuid,
    document_type character varying(64) NOT NULL,
    content_text text NOT NULL,
    token_count integer,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: signal_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signal_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    observation_id uuid NOT NULL,
    domain public.signal_domain NOT NULL,
    signal_key character varying(512) NOT NULL,
    signal_value text,
    confidence real,
    source character varying(64),
    rank integer
);


--
-- Name: subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subjects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type public.subject_type NOT NULL,
    display_name text,
    primary_handle character varying(255),
    primary_platform public.platform,
    profile_url text,
    website_url text,
    pronouns public.pronouns,
    latest_archetype public.archetype,
    latest_brand_archetype public.brand_archetype,
    brand_type character varying(255),
    brand_category text,
    campaign_type public.campaign_type,
    engagement_tier public.engagement_tier,
    anonymized_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    open_id character varying(64) NOT NULL,
    name text,
    email character varying(320),
    login_method character varying(64),
    role character varying(16) DEFAULT 'user'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_signed_in timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: archetype_transitions archetype_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archetype_transitions
    ADD CONSTRAINT archetype_transitions_pkey PRIMARY KEY (id);


--
-- Name: audience_mentions audience_mentions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audience_mentions
    ADD CONSTRAINT audience_mentions_pkey PRIMARY KEY (id);


--
-- Name: brand_observations brand_observations_observation_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_observations
    ADD CONSTRAINT brand_observations_observation_id_unique UNIQUE (observation_id);


--
-- Name: brand_observations brand_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_observations
    ADD CONSTRAINT brand_observations_pkey PRIMARY KEY (id);


--
-- Name: content_items content_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_items
    ADD CONSTRAINT content_items_pkey PRIMARY KEY (id);


--
-- Name: creator_observations creator_observations_observation_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creator_observations
    ADD CONSTRAINT creator_observations_observation_id_unique UNIQUE (observation_id);


--
-- Name: creator_observations creator_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creator_observations
    ADD CONSTRAINT creator_observations_pkey PRIMARY KEY (id);


--
-- Name: decoded_signals decoded_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decoded_signals
    ADD CONSTRAINT decoded_signals_pkey PRIMARY KEY (id);


--
-- Name: llm_invocations llm_invocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_invocations
    ADD CONSTRAINT llm_invocations_pkey PRIMARY KEY (id);


--
-- Name: match_content_directions match_content_directions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_content_directions
    ADD CONSTRAINT match_content_directions_pkey PRIMARY KEY (id);


--
-- Name: match_narratives match_narratives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_narratives
    ADD CONSTRAINT match_narratives_pkey PRIMARY KEY (id);


--
-- Name: match_overlaps match_overlaps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_overlaps
    ADD CONSTRAINT match_overlaps_pkey PRIMARY KEY (id);


--
-- Name: match_scores match_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_scores
    ADD CONSTRAINT match_scores_pkey PRIMARY KEY (id);


--
-- Name: match_warnings match_warnings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_warnings
    ADD CONSTRAINT match_warnings_pkey PRIMARY KEY (id);


--
-- Name: niche_taxonomy niche_taxonomy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niche_taxonomy
    ADD CONSTRAINT niche_taxonomy_pkey PRIMARY KEY (id);


--
-- Name: niche_taxonomy niche_taxonomy_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niche_taxonomy
    ADD CONSTRAINT niche_taxonomy_slug_unique UNIQUE (slug);


--
-- Name: observations observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_pkey PRIMARY KEY (id);


--
-- Name: pipeline_runs pipeline_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_pkey PRIMARY KEY (id);


--
-- Name: platform_handles platform_handles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_handles
    ADD CONSTRAINT platform_handles_pkey PRIMARY KEY (id);


--
-- Name: scrape_events scrape_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scrape_events
    ADD CONSTRAINT scrape_events_pkey PRIMARY KEY (id);


--
-- Name: semantic_documents semantic_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.semantic_documents
    ADD CONSTRAINT semantic_documents_pkey PRIMARY KEY (id);


--
-- Name: signal_values signal_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_values
    ADD CONSTRAINT signal_values_pkey PRIMARY KEY (id);


--
-- Name: subjects subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_pkey PRIMARY KEY (id);


--
-- Name: users users_open_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_open_id_unique UNIQUE (open_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: am_observation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX am_observation_idx ON public.audience_mentions USING btree (observation_id);


--
-- Name: am_subject_sentiment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX am_subject_sentiment_idx ON public.audience_mentions USING btree (subject_id, sentiment);


--
-- Name: am_subject_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX am_subject_time_idx ON public.audience_mentions USING btree (subject_id, collected_at);


--
-- Name: at_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX at_subject_idx ON public.archetype_transitions USING btree (subject_id);


--
-- Name: at_transition_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX at_transition_idx ON public.archetype_transitions USING btree (from_archetype, to_archetype);


--
-- Name: bo_brand_arch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bo_brand_arch_idx ON public.brand_observations USING btree (brand_archetype_classification);


--
-- Name: bo_observation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bo_observation_idx ON public.brand_observations USING btree (observation_id);


--
-- Name: bo_sentiment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bo_sentiment_idx ON public.brand_observations USING btree (mention_sentiment);


--
-- Name: ci_observation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ci_observation_idx ON public.content_items USING btree (observation_id);


--
-- Name: ci_platform_video_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ci_platform_video_idx ON public.content_items USING btree (platform, platform_video_id, subject_id);


--
-- Name: ci_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ci_status_idx ON public.content_items USING btree (subject_id, status);


--
-- Name: ci_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ci_subject_idx ON public.content_items USING btree (subject_id);


--
-- Name: ci_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ci_time_idx ON public.content_items USING btree (subject_id, create_time);


--
-- Name: co_archetype_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX co_archetype_idx ON public.creator_observations USING btree (archetype);


--
-- Name: co_lifecycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX co_lifecycle_idx ON public.creator_observations USING btree (lifecycle_phase);


--
-- Name: co_niche_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX co_niche_idx ON public.creator_observations USING btree (niche_id);


--
-- Name: co_observation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX co_observation_idx ON public.creator_observations USING btree (observation_id);


--
-- Name: co_rogers_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX co_rogers_idx ON public.creator_observations USING btree (rogers_adopter_stage);


--
-- Name: ds_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ds_category_idx ON public.decoded_signals USING btree (category);


--
-- Name: ds_observation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ds_observation_idx ON public.decoded_signals USING btree (observation_id);


--
-- Name: ds_phrase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ds_phrase_idx ON public.decoded_signals USING btree (phrase);


--
-- Name: ds_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ds_subject_idx ON public.decoded_signals USING btree (subject_id);


--
-- Name: handles_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX handles_lookup_idx ON public.platform_handles USING btree (platform, handle);


--
-- Name: handles_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX handles_subject_idx ON public.platform_handles USING btree (subject_id);


--
-- Name: llm_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX llm_model_idx ON public.llm_invocations USING btree (model);


--
-- Name: llm_observation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX llm_observation_idx ON public.llm_invocations USING btree (observation_id);


--
-- Name: llm_purpose_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX llm_purpose_idx ON public.llm_invocations USING btree (purpose);


--
-- Name: llm_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX llm_run_idx ON public.llm_invocations USING btree (run_id);


--
-- Name: llm_status_failed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX llm_status_failed_idx ON public.llm_invocations USING btree (status) WHERE ((status)::text = 'failed'::text);


--
-- Name: mcd_match_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcd_match_idx ON public.match_content_directions USING btree (match_score_id);


--
-- Name: mn_match_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mn_match_idx ON public.match_narratives USING btree (match_score_id);


--
-- Name: mo_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mo_domain_idx ON public.match_overlaps USING btree (domain);


--
-- Name: mo_match_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mo_match_idx ON public.match_overlaps USING btree (match_score_id);


--
-- Name: ms_brand_fit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ms_brand_fit_idx ON public.match_scores USING btree (brand_subject_id, fit_score);


--
-- Name: ms_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ms_brand_idx ON public.match_scores USING btree (brand_subject_id);


--
-- Name: ms_creator_fit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ms_creator_fit_idx ON public.match_scores USING btree (creator_subject_id, fit_score);


--
-- Name: ms_creator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ms_creator_idx ON public.match_scores USING btree (creator_subject_id);


--
-- Name: ms_fit_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ms_fit_score_idx ON public.match_scores USING btree (fit_score);


--
-- Name: ms_pair_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ms_pair_idx ON public.match_scores USING btree (creator_subject_id, brand_subject_id, created_at);


--
-- Name: mw_match_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mw_match_idx ON public.match_warnings USING btree (match_score_id);


--
-- Name: mw_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mw_type_idx ON public.match_warnings USING btree (warning_type);


--
-- Name: nt_level_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX nt_level_idx ON public.niche_taxonomy USING btree (level);


--
-- Name: nt_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX nt_parent_idx ON public.niche_taxonomy USING btree (parent_id);


--
-- Name: obs_latest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX obs_latest_idx ON public.observations USING btree (subject_id, is_latest);


--
-- Name: obs_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX obs_review_idx ON public.observations USING btree (review_status);


--
-- Name: obs_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX obs_run_idx ON public.observations USING btree (run_id);


--
-- Name: obs_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX obs_subject_idx ON public.observations USING btree (subject_id);


--
-- Name: obs_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX obs_time_idx ON public.observations USING btree (subject_id, observed_at);


--
-- Name: pr_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pr_status_idx ON public.pipeline_runs USING btree (status);


--
-- Name: sd_observation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sd_observation_idx ON public.semantic_documents USING btree (observation_id);


--
-- Name: sd_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sd_subject_idx ON public.semantic_documents USING btree (subject_id);


--
-- Name: sd_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sd_type_idx ON public.semantic_documents USING btree (document_type);


--
-- Name: se_failure_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX se_failure_idx ON public.scrape_events USING btree (silent_failure_detected);


--
-- Name: se_method_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX se_method_idx ON public.scrape_events USING btree (scrape_method);


--
-- Name: se_observation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX se_observation_idx ON public.scrape_events USING btree (observation_id);


--
-- Name: se_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX se_run_idx ON public.scrape_events USING btree (run_id);


--
-- Name: subjects_archetype_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subjects_archetype_idx ON public.subjects USING btree (latest_archetype);


--
-- Name: subjects_brand_arch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subjects_brand_arch_idx ON public.subjects USING btree (latest_brand_archetype);


--
-- Name: subjects_handle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subjects_handle_idx ON public.subjects USING btree (primary_handle);


--
-- Name: subjects_matching_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subjects_matching_idx ON public.subjects USING btree (subject_type, latest_archetype, engagement_tier, primary_platform);


--
-- Name: subjects_tier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subjects_tier_idx ON public.subjects USING btree (engagement_tier);


--
-- Name: subjects_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subjects_type_idx ON public.subjects USING btree (subject_type);


--
-- Name: sv_domain_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sv_domain_key_idx ON public.signal_values USING btree (domain, signal_key);


--
-- Name: sv_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sv_key_idx ON public.signal_values USING btree (signal_key);


--
-- Name: sv_observation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sv_observation_idx ON public.signal_values USING btree (observation_id);


--
-- Name: sv_subject_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sv_subject_domain_idx ON public.signal_values USING btree (subject_id, domain);


--
-- Name: archetype_transitions archetype_transitions_from_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archetype_transitions
    ADD CONSTRAINT archetype_transitions_from_observation_id_observations_id_fk FOREIGN KEY (from_observation_id) REFERENCES public.observations(id) ON DELETE CASCADE;


--
-- Name: archetype_transitions archetype_transitions_subject_id_subjects_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archetype_transitions
    ADD CONSTRAINT archetype_transitions_subject_id_subjects_id_fk FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- Name: archetype_transitions archetype_transitions_to_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archetype_transitions
    ADD CONSTRAINT archetype_transitions_to_observation_id_observations_id_fk FOREIGN KEY (to_observation_id) REFERENCES public.observations(id) ON DELETE CASCADE;


--
-- Name: audience_mentions audience_mentions_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audience_mentions
    ADD CONSTRAINT audience_mentions_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id) ON DELETE SET NULL;


--
-- Name: audience_mentions audience_mentions_subject_id_subjects_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audience_mentions
    ADD CONSTRAINT audience_mentions_subject_id_subjects_id_fk FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- Name: brand_observations brand_observations_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_observations
    ADD CONSTRAINT brand_observations_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id) ON DELETE CASCADE;


--
-- Name: content_items content_items_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_items
    ADD CONSTRAINT content_items_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id) ON DELETE SET NULL;


--
-- Name: content_items content_items_subject_id_subjects_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_items
    ADD CONSTRAINT content_items_subject_id_subjects_id_fk FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- Name: creator_observations creator_observations_niche_id_niche_taxonomy_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creator_observations
    ADD CONSTRAINT creator_observations_niche_id_niche_taxonomy_id_fk FOREIGN KEY (niche_id) REFERENCES public.niche_taxonomy(id) ON DELETE SET NULL;


--
-- Name: creator_observations creator_observations_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.creator_observations
    ADD CONSTRAINT creator_observations_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id) ON DELETE CASCADE;


--
-- Name: decoded_signals decoded_signals_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decoded_signals
    ADD CONSTRAINT decoded_signals_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id) ON DELETE CASCADE;


--
-- Name: decoded_signals decoded_signals_subject_id_subjects_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decoded_signals
    ADD CONSTRAINT decoded_signals_subject_id_subjects_id_fk FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- Name: llm_invocations llm_invocations_match_score_id_match_scores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_invocations
    ADD CONSTRAINT llm_invocations_match_score_id_match_scores_id_fk FOREIGN KEY (match_score_id) REFERENCES public.match_scores(id) ON DELETE SET NULL;


--
-- Name: llm_invocations llm_invocations_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_invocations
    ADD CONSTRAINT llm_invocations_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id) ON DELETE SET NULL;


--
-- Name: llm_invocations llm_invocations_subject_id_subjects_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_invocations
    ADD CONSTRAINT llm_invocations_subject_id_subjects_id_fk FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE SET NULL;


--
-- Name: match_content_directions match_content_directions_match_score_id_match_scores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_content_directions
    ADD CONSTRAINT match_content_directions_match_score_id_match_scores_id_fk FOREIGN KEY (match_score_id) REFERENCES public.match_scores(id) ON DELETE CASCADE;


--
-- Name: match_narratives match_narratives_match_score_id_match_scores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_narratives
    ADD CONSTRAINT match_narratives_match_score_id_match_scores_id_fk FOREIGN KEY (match_score_id) REFERENCES public.match_scores(id) ON DELETE CASCADE;


--
-- Name: match_overlaps match_overlaps_match_score_id_match_scores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_overlaps
    ADD CONSTRAINT match_overlaps_match_score_id_match_scores_id_fk FOREIGN KEY (match_score_id) REFERENCES public.match_scores(id) ON DELETE CASCADE;


--
-- Name: match_scores match_scores_brand_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_scores
    ADD CONSTRAINT match_scores_brand_observation_id_observations_id_fk FOREIGN KEY (brand_observation_id) REFERENCES public.observations(id);


--
-- Name: match_scores match_scores_brand_subject_id_subjects_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_scores
    ADD CONSTRAINT match_scores_brand_subject_id_subjects_id_fk FOREIGN KEY (brand_subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- Name: match_scores match_scores_creator_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_scores
    ADD CONSTRAINT match_scores_creator_observation_id_observations_id_fk FOREIGN KEY (creator_observation_id) REFERENCES public.observations(id);


--
-- Name: match_scores match_scores_creator_subject_id_subjects_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_scores
    ADD CONSTRAINT match_scores_creator_subject_id_subjects_id_fk FOREIGN KEY (creator_subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- Name: match_warnings match_warnings_match_score_id_match_scores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_warnings
    ADD CONSTRAINT match_warnings_match_score_id_match_scores_id_fk FOREIGN KEY (match_score_id) REFERENCES public.match_scores(id) ON DELETE CASCADE;


--
-- Name: observations observations_subject_id_subjects_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_subject_id_subjects_id_fk FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- Name: platform_handles platform_handles_subject_id_subjects_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_handles
    ADD CONSTRAINT platform_handles_subject_id_subjects_id_fk FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- Name: scrape_events scrape_events_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scrape_events
    ADD CONSTRAINT scrape_events_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id) ON DELETE SET NULL;


--
-- Name: scrape_events scrape_events_subject_id_subjects_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scrape_events
    ADD CONSTRAINT scrape_events_subject_id_subjects_id_fk FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE SET NULL;


--
-- Name: semantic_documents semantic_documents_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.semantic_documents
    ADD CONSTRAINT semantic_documents_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id) ON DELETE SET NULL;


--
-- Name: semantic_documents semantic_documents_subject_id_subjects_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.semantic_documents
    ADD CONSTRAINT semantic_documents_subject_id_subjects_id_fk FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- Name: signal_values signal_values_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_values
    ADD CONSTRAINT signal_values_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id) ON DELETE CASCADE;


--
-- Name: signal_values signal_values_subject_id_subjects_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_values
    ADD CONSTRAINT signal_values_subject_id_subjects_id_fk FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- Name: archetype_transitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.archetype_transitions ENABLE ROW LEVEL SECURITY;

--
-- Name: audience_mentions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audience_mentions ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_observations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_observations ENABLE ROW LEVEL SECURITY;

--
-- Name: content_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;

--
-- Name: creator_observations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.creator_observations ENABLE ROW LEVEL SECURITY;

--
-- Name: decoded_signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.decoded_signals ENABLE ROW LEVEL SECURITY;

--
-- Name: llm_invocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.llm_invocations ENABLE ROW LEVEL SECURITY;

--
-- Name: match_content_directions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_content_directions ENABLE ROW LEVEL SECURITY;

--
-- Name: match_narratives; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_narratives ENABLE ROW LEVEL SECURITY;

--
-- Name: match_overlaps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_overlaps ENABLE ROW LEVEL SECURITY;

--
-- Name: match_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: match_warnings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_warnings ENABLE ROW LEVEL SECURITY;

--
-- Name: niche_taxonomy; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.niche_taxonomy ENABLE ROW LEVEL SECURITY;

--
-- Name: observations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.observations ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_handles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_handles ENABLE ROW LEVEL SECURITY;

--
-- Name: scrape_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scrape_events ENABLE ROW LEVEL SECURITY;

--
-- Name: semantic_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.semantic_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: signal_values; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.signal_values ENABLE ROW LEVEL SECURITY;

--
-- Name: subjects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict h2Z30PzQjP5cv8HDUKyrENPscVzySjJqUmJ90qACE9ntTychGUZbMb7QlqQe6k1

