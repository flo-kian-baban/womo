# WOMO — Storage Model & Data Dictionary

**Authoritative storage reference.** Live database introspected read-only via the Supabase MCP on **2026-07-22**; code paths at commit **`5a7ff17`**. Supabase project ref **`smvflfoxnkghkiuamkmi`** (PostgreSQL 17.6, `aws-1-us-east-2` pooler).

**Convention:** every claim is **[FACT]** (returned by a live query or read from a cited `file:line`) or **[INFERENCE]** (interpretation). `drizzle/schema.ts` is the TYPE source of truth; the live catalog was cross-checked column-by-column against it (312 columns, 21 tables — **zero drift**).

> ⚠️ **This database is Supabase-migration-managed. Do NOT run `drizzle-kit` (migrate / push / generate) against it.** See [§8 Migration State of Record](#8-migration-state-of-record) and [§11 Governance Guardrails](#11-governance-guardrails).

---

## 1. Core data-model pattern

**[FACT]** The schema is a **stable-registry + append-only-observation** model:

```
                         subjects  (1 stable row per creator/brand; PII zone)
                            │  id (uuid)
        ┌───────────────────┼───────────────────────────────────────┐
        │ 1:N (cascade)     │ 1:N (cascade)                          │ 1:N (cascade)
   platform_handles     observations  ────────────────────┐    match_scores (creator_subject_id, brand_subject_id)
   (platform,handle)    (one per analysis run;             │         │  id (uuid)
                         is_latest flag marks current)     │         ├── match_narratives   (1:N cascade)
                            │                              │         ├── match_warnings     (1:N cascade)
        ┌───────────────────┼───────────────┐             │         ├── match_overlaps     (1:N cascade)
        │ 1:1 (unique)      │ 1:1 (unique)  │ 1:N         │         └── match_content_directions (1:N cascade)
   creator_observations  brand_observations │             │
   (creator profile)     (brand profile)    │             │
                                             │             │
        ┌───────────────┬────────────────────┼─────────────┤   (all FK subject_id/observation_id)
   signal_values   decoded_signals   content_items   audience_mentions
   (EAV signals)   (symbol decoder)  (videos/       (brand mention
                                      transcripts)   videos)

   PROVENANCE (append-only, per run):  scrape_events · llm_invocations
   UNUSED / EMPTY:  niche_taxonomy · archetype_transitions · semantic_documents · pipeline_runs · users
```

- **[FACT]** A single `subjects` row is the durable identity (survives anonymization via `anonymized_at`). Each analysis appends a new `observations` row; `is_latest = true` marks the current snapshot (`schema.ts:209`). Reads resolve the latest observation and join the subtype table (`creator_observations` **or** `brand_observations`, 1:1 unique on `observation_id`).
- **[FACT]** All list/categorical data is normalized into `signal_values` (EAV: `domain` + `signal_key` + `signal_value`) and `decoded_signals` (symbol-decoder phrases). Per-video data lives in `content_items`.
- **[FACT]** A `match_scores` row pairs a creator subject × brand subject and fans out to four child tables (narratives/warnings/overlaps/content_directions).
- **[FACT]** Provenance is captured out-of-band per run: `scrape_events` (one per HTTP fetch), `llm_invocations` (one per Gemini call).

---

## 2. Table catalog (all 21) — purpose, live rows, activity

**[FACT]** Row counts queried 2026-07-22. "Activity" from the write-path/read-path map ([§9](#9-write-path--read-path-map)).

| # | Table | Purpose (one line) | Live rows | Activity |
|---|---|---|---|---|
| 1 | `subjects` | Stable entity registry (creator/brand identity) | 29 | **written + read** |
| 2 | `platform_handles` | Multi-platform handle map for a subject | 20 | **written + read** |
| 3 | `observations` | Per-run snapshot; `is_latest` marks current | 33 | **written + read** |
| 4 | `creator_observations` | Creator cultural profile (1:1 with observation) | 23 | **written + read** |
| 5 | `brand_observations` | Brand cultural profile (1:1 with observation) | 10 | **written + read** |
| 6 | `signal_values` | Normalized EAV for list/categorical signals | 1 880 | **written + read** |
| 7 | `decoded_signals` | Structured symbol-decoder output (phrase→meaning) | 495 | **written + read** |
| 8 | `content_items` | Individual videos, transcripts, media, metrics | 509 | **written + read** |
| 9 | `audience_mentions` | Individual brand-mention videos | **0** | writer exists (`routers.ts:341`), **empty, never read** ⚠️ |
| 10 | `niche_taxonomy` | Hierarchical niche classification (FK target) | **0** | **no writer** ⚠️ (empty) |
| 11 | `archetype_transitions` | Longitudinal archetype-change tracking | **0** | **no writer** ⚠️ (empty) |
| 12 | `llm_invocations` | Provenance/cost for every LLM call | 217 | **written + read** |
| 13 | `scrape_events` | Provenance for every HTTP scrape | 333 | **written + read** |
| 14 | `match_scores` | F.I.T./Cultural-Match calculations (creator×brand) | 16 | **written + read + deleted** |
| 15 | `match_narratives` | AI-generated narrative text per match | 16 | **written + read** |
| 16 | `match_warnings` | Normalized radar warnings per match | 7 | **written + read** |
| 17 | `match_overlaps` | Shared signals per match | 7 | **written + read** |
| 18 | `match_content_directions` | Content recommendations per match | 48 | **written + read** |
| 19 | `semantic_documents` | pgvector store (embedding column NOT created) | **0** | **no writer** ⚠️ (dormant) |
| 20 | `pipeline_runs` | Persistent batch-job tracking | **0** | **no writer** ⚠️ (bulk jobs use in-memory `Map` instead) |
| 21 | `users` | Legacy auth table (openId/role) | **0** | writer+reader exist but **zero callers** ⚠️ (orphaned) |

**[FACT] Empty tables (6):** `audience_mentions`, `niche_taxonomy`, `archetype_transitions`, `semantic_documents`, `pipeline_runs`, `users`. **[FACT] No-writer tables (4):** `niche_taxonomy`, `archetype_transitions`, `semantic_documents`, `pipeline_runs` (grep of `db.ts` finds no `insert()` for these table objects). See [§10](#10-integrity--usage-gaps).

---

## 3. Column dictionary — per table (exhaustive)

**[FACT]** Types are live (`information_schema` / `udt_name`); nullability and defaults are live and agree 1:1 with `schema.ts` (cross-checked, zero surprises). `PK` = primary key; all UUID PKs default `gen_random_uuid()`. Timestamps are `timestamptz` defaulting `now()` unless noted.

### 1. `subjects` (17 cols) — `schema.ts:146`
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| subject_type | enum `subject_type` | **no** | — | `creator` \| `brand` |
| display_name | text | yes | — | public name (PII; nullable for anonymization) |
| primary_handle | varchar(255) | yes | — | main platform handle |
| primary_platform | enum `platform` | yes | — | tiktok/instagram/youtube/google_maps/yelp |
| profile_url | text | yes | — | profile URL |
| website_url | text | yes | — | brand website |
| pronouns | enum `pronouns` | yes | — | she/her, he/him, they/them, not specified |
| latest_archetype | enum `archetype` | yes | — | most recent creator archetype (denormalized) |
| latest_brand_archetype | enum `brand_archetype` | yes | — | Trust/Community/Momentum (denormalized) |
| brand_type | varchar(255) | yes | — | brand type key (drives weight table) |
| brand_category | text | yes | — | brand category |
| campaign_type | enum `campaign_type` | yes | — | Heritage/Luxury … Awareness/Consideration |
| engagement_tier | enum `engagement_tier` | yes | — | nano/micro/mid/macro/mega |
| anonymized_at | timestamptz | yes | — | set when PII scrubbed |
| created_at | timestamptz | no | now() | |
| updated_at | timestamptz | no | now() | |

### 2. `platform_handles` (7 cols) — `schema.ts:188`
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| subject_id | uuid | **no** | — | FK→subjects (cascade) |
| platform | enum `platform` | **no** | — | platform |
| handle | varchar(255) | **no** | — | handle on that platform |
| profile_url | text | yes | — | |
| is_primary | boolean | **no** | false | |
| discovered_at | timestamptz | no | now() | |
Unique: `(platform, handle)`.

### 3. `observations` (11 cols) — `schema.ts:206`
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| subject_id | uuid | **no** | — | FK→subjects (cascade) |
| is_latest | boolean | **no** | true | marks current snapshot |
| follower_count | **bigint** | yes | — | follower count |
| following_count | **bigint** | yes | — | following count |
| engagement_rate | real | yes | — | percentage (0–100) |
| bio | text | yes | — | |
| data_confidence_level | enum `confidence_level` | yes | — | high/medium/low |
| transcript_count | integer | yes | 0 | # transcripts fetched |
| observed_at | timestamptz | no | now() | |
| created_at | timestamptz | no | now() | |

### 4. `creator_observations` (33 cols) — `schema.ts:255`
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| observation_id | uuid | **no** | — | FK→observations (cascade), **UNIQUE** (1:1) |
| total_likes | **bigint** | yes | — | cumulative likes |
| video_count | integer | yes | — | # videos |
| total_views | **bigint** | yes | — | cumulative views |
| avg_views | integer | yes | — | avg views/video |
| avg_video_duration | real | yes | — | seconds |
| primary_region | varchar(255) | yes | — | |
| archetype | enum `archetype` | yes | — | Jungian archetype |
| tone_register | text | yes | — | 2–3-word voice |
| parasocial_bond_strength | real | yes | — | 1–5 |
| audience_relationship_type | enum `audience_relationship` | yes | — | Friend/Mentor/Authority |
| barthes_myth | text | yes | — | normalized belief |
| cultural_capital | enum `cultural_capital` | yes | — | Produce/Relay (Bourdieu) |
| goffman_stage_consistency | enum `goffman_consistency` | yes | — | Consistent/Minor Gap/Significant Gap |
| drift_signal | enum `drift_signal` | yes | — | Zero Change…Full Pivot |
| stuart_hall_decoding | enum `hall_decoding` | yes | — | Dominant/Negotiated/Oppositional |
| niche_id | uuid | yes | — | FK→niche_taxonomy (set null) — **always null in practice** ([§10](#10-integrity--usage-gaps)) |
| niche_topic_node | text | yes | — | free-text niche (used instead of niche_id) |
| underground_density | boolean | yes | — | |
| mainstream_bleed | boolean | yes | — | |
| remix_rate | boolean | yes | — | |
| brand_saturation | boolean | yes | — | already heavily sponsored? |
| rogers_adopter_stage | enum `rogers_stage` | yes | — | Innovators…Laggards |
| creator_niche_position | enum `niche_position` | yes | — | Ahead/Consistent/Behind |
| lifecycle_phase | enum `lifecycle_phase` | yes | — | Emergence…Decline |
| barthes_niche_meaning | text | yes | — | |
| turner_liminal_phase | enum `liminal_phase` | yes | — | Pre-/Liminal/Post-Liminal |
| cultural_velocity | enum `cultural_velocity` | yes | — | Focusing/Drifting/Insufficient Data |
| engagement_quality_score | real | yes | — | 0–1 (feature dormant; scorer module was dead code, removed Session 2) |
| engagement_quality_confidence | enum `signal_confidence` | yes | — | Verified/Estimated/Insufficient Data |
| symbolic_summary | text | yes | — | |
| ai_summary | text | yes | — | |

### 5. `brand_observations` (42 cols) — `schema.ts:313`
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| observation_id | uuid | **no** | — | FK→observations (cascade), **UNIQUE** (1:1) |
| brand_archetype_classification | enum `brand_archetype` | yes | — | Trust/Community/Momentum |
| archetype | enum `archetype` | yes | — | Jungian |
| emotional_promise | text | yes | — | |
| audience_tribe | text | yes | — | |
| cultural_tension | text | yes | — | |
| brand_tone | text | yes | — | |
| barthes_myth | text | yes | — | |
| brand_cultural_capital | enum `cultural_capital` | yes | — | Produce/Relay |
| brand_goffman_consistency | enum `goffman_consistency` | yes | — | |
| brand_drift_signal | enum `drift_signal` | yes | — | |
| brand_hall_decoding | enum `hall_decoding` | yes | — | |
| brand_rogers_stage | enum `rogers_stage` | yes | — | |
| brand_liminal_phase | enum `liminal_phase` | yes | — | |
| brand_lifecycle_phase | enum `lifecycle_phase` | yes | — | |
| brand_barthes_niche_meaning | text | yes | — | |
| brand_audience_decoding_split | boolean | yes | — | |
| weight_alpha | real | yes | — | Alignment weight α |
| weight_beta | real | yes | — | Pulse weight β |
| weight_gamma | real | yes | — | Stability weight γ |
| weight_priority | text | yes | — | weight-priority label |
| google_rating | real | yes | — | |
| google_review_count | integer | yes | — | |
| google_review_excerpts | text | yes | — | *(added by migration `womo_0001`)* |
| yelp_rating | real | yes | — | |
| yelp_review_count | integer | yes | — | |
| yelp_review_excerpts | text | yes | — | *(added by `womo_0002`)* |
| overall_rating | real | yes | — | weighted avg |
| total_reviews | integer | yes | — | |
| tiktok_handle | varchar(255) | yes | — | brand TikTok handle |
| tiktok_follower_count | integer | yes | — | |
| tiktok_engagement_rate | real | yes | — | |
| mention_total_count | integer | yes | — | # audience mention videos |
| mention_unique_authors | integer | yes | — | |
| mention_sentiment | enum `sentiment` | yes | — | positive/mixed/negative/insufficient_data |
| mention_sentiment_confidence | enum `confidence_level` | yes | — | |
| mention_audience_summary | text | yes | — | |
| symbolic_summary | text | yes | — | |
| ai_summary | text | yes | — | |
| semantic_word_count | integer | yes | — | crawl word count *(added by `womo_0002`)* |
| crawled_pages_count | integer | yes | — | *(added by `womo_0002`)* |

### 6. `signal_values` (9 cols) — `schema.ts:383`
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| subject_id | uuid | **no** | — | FK→subjects (cascade) |
| observation_id | uuid | **no** | — | FK→observations (cascade) |
| domain | enum `signal_domain` | **no** | — | keyword/hashtag/theme/music_title/… (13 values) |
| signal_key | varchar(512) | **no** | — | the signal string |
| signal_value | text | yes | — | optional value/weight |
| confidence | real | yes | — | |
| source | varchar(64) | yes | — | |
| rank | integer | yes | — | ordering |

### 7. `decoded_signals` (8 cols) — `schema.ts:405`
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| subject_id | uuid | **no** | — | FK→subjects (cascade) |
| observation_id | uuid | **no** | — | FK→observations (cascade) |
| category | enum `signal_domain` | **no** | — | identity_claim/status_signal/… |
| phrase | text | **no** | — | decoded phrase |
| meaning | text | **no** | — | interpreted meaning |
| informs_fields | **text[]** (`_text`) | yes | — | which profile fields this informs (the **only ARRAY column** in the DB) |
| source | varchar(32) | yes | — | |

### 8. `content_items` (24 cols) — `schema.ts:426`
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| subject_id | uuid | **no** | — | FK→subjects (cascade) |
| observation_id | uuid | yes | — | FK→observations (**set null**) |
| platform | enum `platform` | **no** | — | |
| platform_video_id | varchar(255) | yes | — | platform's video id |
| video_url | text | yes | — | |
| caption | text | yes | — | |
| transcript_text | text | yes | — | full transcript |
| transcript_source | varchar(32) | yes | — | captions/whisper/playwright-webvtt/… |
| transcript_word_count | integer | yes | — | |
| video_duration | real | yes | — | seconds |
| create_time | timestamptz | yes | — | original post time |
| region | varchar(128) | yes | — | |
| temporal_bucket | varchar(16) | yes | — | recent/mid/anchor (6-3-3 sampling) |
| like_count | **bigint** | yes | — | |
| comment_count | **bigint** | yes | — | |
| share_count | **bigint** | yes | — | |
| view_count | **bigint** | yes | — | |
| save_count | **bigint** | yes | — | |
| music_title | varchar(512) | yes | — | |
| music_artist | varchar(255) | yes | — | |
| is_original_audio | boolean | yes | — | |
| status | varchar(32) | **no** | `'sampled'` | sampled/ingested state |
| created_at | timestamptz | no | now() | |
Unique: `(platform, platform_video_id, subject_id)`.

### 9. `audience_mentions` (16 cols) — `schema.ts:493` — **empty; counts are `integer` (not bigint)**
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| subject_id | uuid | **no** | — | FK→subjects (cascade) |
| observation_id | uuid | yes | — | FK→observations (**set null**) |
| platform | enum `platform` | **no** | — | |
| mention_video_id | varchar(255) | yes | — | |
| author_handle_hash | text | yes | — | SHA-256 of author handle (privacy) |
| caption | text | yes | — | |
| sentiment | enum `sentiment` | yes | — | |
| view_count | **integer** | yes | — | ⚠️ integer vs content_items bigint |
| like_count | **integer** | yes | — | ⚠️ |
| comment_count | **integer** | yes | — | ⚠️ |
| share_count | **integer** | yes | — | ⚠️ |
| save_count | **integer** | yes | — | ⚠️ |
| music_title | varchar(512) | yes | — | |
| music_artist | varchar(255) | yes | — | |
| collected_at | timestamptz | no | now() | |

### 10. `niche_taxonomy` (6 cols) — `schema.ts:236` — **no writer; empty**
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| slug | varchar(128) | **no** | — | **UNIQUE** |
| label | text | **no** | — | |
| parent_id | uuid | yes | — | self-referential hierarchy (no FK constraint) |
| level | integer | **no** | — | |
| created_at | timestamptz | no | now() | |

### 11. `archetype_transitions` (9 cols) — `schema.ts:473` — **no writer; empty**
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| subject_id | uuid | **no** | — | FK→subjects (cascade) |
| from_archetype | enum `archetype` | **no** | — | |
| to_archetype | enum `archetype` | **no** | — | |
| from_observation_id | uuid | **no** | — | FK→observations (cascade) |
| to_observation_id | uuid | **no** | — | FK→observations (cascade) |
| days_between | integer | yes | — | |
| engagement_delta | real | yes | — | |
| detected_at | timestamptz | no | now() | |

### 12. `llm_invocations` (13 cols) — `schema.ts:530` — see [§8 Provenance](#8-provenance--cost-tables-detail)
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| observation_id | uuid | yes | — | FK→observations (**set null**) |
| match_score_id | uuid | yes | — | FK→match_scores (**set null**, added by `womo_0004`) — **always null** (never written) |
| subject_id | uuid | yes | — | FK→subjects (**set null**) |
| purpose | varchar(64) | **no** | — | call purpose label |
| model | varchar(128) | **no** | — | e.g. `gemini-2.5-flash` |
| prompt_version | varchar(32) | yes | — | written as `"1.0"` |
| temperature | real | yes | — | **never written** (always null) |
| input_tokens | integer | yes | — | |
| output_tokens | integer | yes | — | |
| response_json | jsonb | yes | — | **never written** (always null) |
| duration_ms | integer | yes | — | |
| created_at | timestamptz | no | now() | |

### 13. `scrape_events` (12 cols) — `schema.ts:558` — see [§8 Provenance](#8-provenance--cost-tables-detail)
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| observation_id | uuid | yes | — | FK→observations (**set null**) |
| subject_id | uuid | yes | — | FK→subjects (**set null**) |
| platform | enum `platform` | yes | — | |
| scrape_method | enum `scrape_method` | **no** | — | 17 methods (tiktok_playwright, …, google_maps_http) |
| url_requested | text | yes | — | |
| http_status | integer | yes | — | |
| response_size_bytes | integer | yes | — | |
| silent_failure_detected | boolean | yes | false | soft-block heuristic — **written+indexed, never aggregated/alerted** |
| failure_reason | text | yes | — | |
| duration_ms | integer | yes | — | |
| created_at | timestamptz | no | now() | |

### 14. `match_scores` (52 cols) — `schema.ts:584`
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| creator_subject_id | uuid | **no** | — | FK→subjects (**cascade**) |
| brand_subject_id | uuid | **no** | — | FK→subjects (**cascade**) |
| creator_observation_id | uuid | yes | — | FK→observations (**NO ACTION**) ⚠️ |
| brand_observation_id | uuid | yes | — | FK→observations (**NO ACTION**) ⚠️ |
| alignment_score_raw / pulse_score_raw / stability_score_raw | real ×3 | yes | — | sub-scores (0–10) |
| archetype_match_score, myth_alignment_score, trib_match_score, decoding_modifier, rogers_base_score, liminal_adjustment, goffman_score, drift_score | real ×8 | yes | — | sub-score components |
| weight_alpha / weight_beta / weight_gamma | real ×3 | yes | — | weights used |
| fit_score | real | yes | — | final Cultural Match Score (0–10) |
| fit_status | enum `fit_status` | yes | — | Green Light/Proceed with Caution/Do Not Proceed |
| parr_score | integer | yes | — | PARR (0–100) |
| parr_label | varchar(64) | yes | — | |
| parr_tribe_overlap, parr_decoding_acceptance, parr_archetype_resonance, parr_symbolic_overlap, parr_persona_consistency | real ×5 | yes | — | PARR breakdown |
| symbolic_overlap_score | real | yes | — | |
| qov_score | real | yes | — | Quality of View (%) |
| creative_integrity_signal (+ _confidence enum), performance_consistency_signal (+_conf), community_quality_signal (+_conf), audience_receptivity_signal (+_conf), brand_trust_signal (+_conf) | real + enum ×5 pairs | yes | — | **5 Performance Signals** (0–100) + confidence |
| cultural_identity_signal (+_conf), cultural_momentum_signal (+_conf), partnership_stability_signal (+_conf) | real + enum ×3 pairs | yes | — | **3 Cultural Signals — DEPRECATED: never written/read** (`schema.ts:641-649`) ⚠️ |
| music_overlap_strength | varchar(16) | yes | — | strong/moderate/none |
| mention_sentiment_penalty | real | yes | — | |
| mention_vocab_boost | real | yes | — | |
| cultural_velocity | enum `cultural_velocity` | yes | — | |
| data_confidence_level | enum `confidence_level` | yes | — | |
| created_at | timestamptz | no | now() | |
Unique: `(creator_subject_id, brand_subject_id, created_at)`.

### 15. `match_narratives` (13 cols) — `schema.ts:677`
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| match_score_id | uuid | **no** | — | FK→match_scores (cascade) |
| narrative_summary, alignment_narrative, synergy_narrative, cultural_borrowing_summary, archetype_analysis, myth_alignment, audience_overlap, cultural_momentum, identity_stability, recommendation | text ×10 | yes | — | AI narrative fields |
| created_at | timestamptz | no | now() | |

### 16. `match_warnings` (3 cols) — `schema.ts:703`
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| match_score_id | uuid | **no** | — | FK→match_scores (cascade) |
| warning_type | enum `warning_type` | **no** | — | Low Alignment … Negative Audience Sentiment (7) |

### 17. `match_overlaps` (4 cols) — `schema.ts:717`
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| match_score_id | uuid | **no** | — | FK→match_scores (cascade) |
| domain | enum `signal_domain` | **no** | — | |
| value | text | **no** | — | shared signal value |

### 18. `match_content_directions` (6 cols) — `schema.ts:732`
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| match_score_id | uuid | **no** | — | FK→match_scores (cascade) |
| title | varchar(255) | **no** | — | |
| rationale | text | **no** | — | |
| example_angle | text | **no** | — | |
| rank | integer | yes | — | |

### 19. `semantic_documents` (8 cols) — `schema.ts:751` — **embedding column NOT present**
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| subject_id | uuid | **no** | — | FK→subjects (cascade) |
| observation_id | uuid | yes | — | FK→observations (set null) |
| document_type | varchar(64) | **no** | — | |
| content_text | text | **no** | — | |
| token_count | integer | yes | — | |
| metadata | jsonb | yes | — | |
| created_at | timestamptz | no | now() | |
**[FACT]** The `embedding vector(1536)` column + ivfflat index described in the `schema.ts:747-749` comment are **NOT created** in the live DB (verified: table has exactly these 8 columns). pgvector is installed but this feature is dormant.

### 20. `pipeline_runs` (10 cols) — `schema.ts:773` — **no writer; empty**
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| run_type | varchar(64) | **no** | — | |
| status | varchar(32) | **no** | `'pending'` | |
| total_items | integer | yes | 0 | |
| completed_items | integer | yes | 0 | |
| failed_items | integer | yes | 0 | |
| error_log | jsonb | yes | — | |
| started_at | timestamptz | yes | — | |
| completed_at | timestamptz | yes | — | |
| created_at | timestamptz | no | now() | |
**[INFERENCE]** Intended to persist bulk-analysis jobs, but `bulkAnalysisJobs.ts` uses an in-memory `Map` instead — this table is never written.

### 21. `users` (9 cols) — `schema.ts:793` — **orphaned; empty**
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | **integer** (serial) | no | `nextval('users_id_seq')` | PK (the lone non-UUID PK) |
| open_id | varchar(64) | **no** | — | **UNIQUE** (legacy OAuth openId) |
| name | text | yes | — | |
| email | varchar(320) | yes | — | |
| login_method | varchar(64) | yes | — | |
| role | varchar(16) | **no** | `'user'` | |
| created_at / updated_at / last_signed_in | timestamptz ×3 | no | now() | |
**[FACT]** `db.ts` helpers `upsertUser` (`db.ts:57`) / `getUserByOpenId` (`db.ts:86`) exist but have **zero callers** — their only callers (`_core/oauth.ts`, `_core/sdk.ts`) were deleted in Session 2. Live auth is PIN→HMAC-cookie, which uses no DB.

---

## 4. Enum types (24) — full value sets

**[FACT]** From `schema.ts:28-139` (verified against live `pg_enum`).

| Enum | Values |
|---|---|
| `platform` | tiktok, instagram, youtube, google_maps, yelp |
| `subject_type` | creator, brand |
| `archetype` | The Sage, The Hero, The Outlaw, The Explorer, The Magician, The Ruler, The Caregiver, The Lover, The Jester, The Innocent, The Everyman, The Creator |
| `brand_archetype` | Trust, Community, Momentum |
| `campaign_type` | Heritage/Luxury, Trend-First, Long-Term Ambassador, Product Launch, Community/Local, Awareness/Consideration |
| `audience_relationship` | Friend, Mentor, Authority |
| `cultural_capital` | Produce, Relay |
| `goffman_consistency` | Consistent, Minor Gap, Significant Gap |
| `drift_signal` | Zero Change, Minor Drift, Significant Drift, Full Pivot |
| `hall_decoding` | Dominant, Negotiated, Oppositional |
| `rogers_stage` | Innovators, Early Adopters, Early Majority, Late Majority, Laggards |
| `niche_position` | Ahead, Consistent, Behind |
| `lifecycle_phase` | Emergence, Growth, Maturity, Decline |
| `liminal_phase` | Pre-Liminal, Liminal, Post-Liminal Reintegration |
| `pronouns` | she/her, he/him, they/them, not specified |
| `cultural_velocity` | Focusing, Drifting, Insufficient Data |
| `confidence_level` | high, medium, low |
| `fit_status` | Green Light, Proceed with Caution, Do Not Proceed |
| `sentiment` | positive, mixed, negative, insufficient_data |
| `signal_confidence` | Verified, Estimated, Insufficient Data |
| `signal_domain` | keyword, hashtag, content_theme, theme, visual_language, symbolic_vocabulary, music_title, music_artist, identity_claim, status_signal, community_reference, aspiration_driver, audience_language |
| `scrape_method` | tiktok_desktop_http, tiktok_mobile_http, tiktok_playwright, tiktok_google_cache, tiktok_search_xhr, tiktok_search_html, instagram_playwright, instagram_picuki, instagram_oembed, youtube_api, youtube_html, google_maps_api, google_maps_http, google_search, website_crawl, whisper_transcription, manual_entry |
| `warning_type` | Low Alignment, Archetype Tension, Identity Instability, Low Pulse, Trajectory Divergence, Low Social Engagement, Negative Audience Sentiment |
| `engagement_tier` | nano, micro, mid, macro, mega |

---

## 5. Keys, foreign keys & delete behavior

**[FACT]** From live `information_schema.table_constraints` + `referential_constraints`.

**Primary keys:** every table has a single-column `id` PK (UUID everywhere except `users.id` serial/integer).

**Unique constraints:** `platform_handles(platform,handle)`, `creator_observations(observation_id)`, `brand_observations(observation_id)`, `content_items(platform,platform_video_id,subject_id)`, `match_scores(creator_subject_id,brand_subject_id,created_at)`, `niche_taxonomy(slug)`, `users(open_id)`.

**Foreign keys (child.column → parent, ON DELETE):**
| Child.column | → Parent | ON DELETE |
|---|---|---|
| observations.subject_id | subjects | CASCADE |
| platform_handles.subject_id | subjects | CASCADE |
| creator_observations.observation_id | observations | CASCADE |
| creator_observations.niche_id | niche_taxonomy | SET NULL |
| brand_observations.observation_id | observations | CASCADE |
| signal_values.subject_id / observation_id | subjects / observations | CASCADE / CASCADE |
| decoded_signals.subject_id / observation_id | subjects / observations | CASCADE / CASCADE |
| content_items.subject_id / observation_id | subjects / observations | CASCADE / **SET NULL** |
| audience_mentions.subject_id / observation_id | subjects / observations | CASCADE / SET NULL |
| archetype_transitions.subject_id / from_observation_id / to_observation_id | subjects / observations / observations | CASCADE / CASCADE / CASCADE |
| llm_invocations.observation_id / match_score_id / subject_id | observations / match_scores / subjects | SET NULL / **SET NULL** (new in `0004`) / SET NULL |
| scrape_events.observation_id / subject_id | observations / subjects | SET NULL / SET NULL |
| semantic_documents.subject_id / observation_id | subjects / observations | CASCADE / SET NULL |
| match_scores.creator_subject_id / brand_subject_id | subjects / subjects | CASCADE / CASCADE |
| match_scores.creator_observation_id / brand_observation_id | observations / observations | **NO ACTION** / **NO ACTION** ⚠️ |
| match_narratives / match_warnings / match_overlaps / match_content_directions .match_score_id | match_scores | CASCADE (all) |

**Indexes** — **[FACT]** 82 indexes total; every FK column is indexed for lookups, plus composite filters (`obs_latest_idx(subject_id,is_latest)`, `subjects_matching_idx`, `ms_pair_idx` unique, `ci_platform_video_idx` unique, `sv_subject_domain_idx`, etc.). **[FACT] The duplicate index `nt_slug_idx` is GONE** (dropped by `womo_0004`; only `niche_taxonomy_slug_unique` remains on `slug`). **[FACT]** No trigram (`gin_trgm_ops`) or vector (`ivfflat`) index exists on any table.

---

## 6. Extensions — installed vs used

**[FACT]** Installed (non-null `installed_version`): `pgcrypto` 1.3, `uuid-ossp` 1.1, `pg_trgm` 1.6, `vector` 0.8.0, `pg_stat_statements` 1.11, `supabase_vault` 0.3.1, `plpgsql` 1.0. The three the schema comment names (`vector`, `uuid-ossp`, `pg_trgm`) are installed but **currently dormant/unused**:

| Extension | Schema | Status |
|---|---|---|
| `pgcrypto` | extensions | **used** — `gen_random_uuid()` powers every UUID PK default. **[INFERENCE]** (also available in PG core ≥13) |
| `uuid-ossp` | extensions | **installed but UNUSED** — its `uuid_generate_v4()` is not referenced; PKs use `gen_random_uuid()` |
| `pg_trgm` | public | **installed but UNUSED** — no `gin_trgm_ops` index exists |
| `vector` (pgvector) | public | **installed but DORMANT** — `semantic_documents.embedding` column + ivfflat index never created; table empty |
| `pg_stat_statements`, `supabase_vault`, `plpgsql` | — | Supabase platform defaults (not app-specific) |

---

## 7. Provenance & cost tables — detail

**[FACT] `scrape_events`** — written by `insertScrapeEvent` (`db.ts:687`), called ~10× from the scraping layer (`scraping/httpClient.ts`, `webResearch.ts`, `reviewResearch.ts`). Read by `getProvenance` (`db.ts:1044`, used by `creator.getProvenance`). All fields are populated per fetch. **Gap:** `silent_failure_detected` is written **and** indexed (`se_failure_idx`) but is only ever returned row-by-row via `getProvenance` — **no query aggregates or alerts on it**, so soft-block rate is invisible operationally.

**[FACT] `llm_invocations`** — written by `insertLlmInvocation` (`db.ts:721`), called only from `_core/llm.ts` (once per successful Gemini call; **not written on failure**, so failed calls leave no row). Read by `getLlmTokenUsageBySubject` (`db.ts:757`), `getLlmTokenUsageByTimeWindow` (`db.ts:784`), and `getProvenance`. **Populated:** purpose, model, prompt_version(`"1.0"`), input/output_tokens, duration_ms, observation_id/subject_id. **Always NULL (defined but never written):** `temperature`, `response_json`, `match_score_id` (the new `0004` FK column is never populated — verified: 0 non-null `match_score_id` rows). **Cost:** token columns are read to compute a per-analysis `pipelineMetrics.tokens` figure that is **returned to the client and discarded** — there is no persisted cost rollup, no `$` conversion, and no historical spend view.

---

## 8. Migration State of Record

**[FACT] This database is managed exclusively by Supabase migrations. `drizzle-kit` is NOT used and MUST NOT be run against it.** There is **no `drizzle` schema and no `drizzle.__drizzle_migrations` ledger** (verified: `to_regclass('drizzle.__drizzle_migrations')` → null). `drizzle/schema.ts` is the **TYPE source only** — it generates TypeScript row/insert types for the app; it is not the migration source.

**[FACT] 8 tracked Supabase migrations** (`supabase_migrations.schema_migrations`, all applied 2026-06-19 except `0004` on 2026-07-22):

| Version | Name |
|---|---|
| 20260619162935 | enable_extensions |
| 20260619163208 | womo_0000_enums_and_tables |
| 20260619163456 | womo_0000_fk_constraints |
| 20260619163620 | womo_0000_indexes |
| 20260619164011 | womo_0001_google_review_excerpts |
| 20260619164022 | womo_0002_brand_audit_columns |
| 20260619164032 | womo_0003_schema_audit_fixes |
| 20260722070910 | **womo_0004_db_hardening** (RLS on all tables, `llm_invocations.match_score_id` FK, drop duplicate `nt_slug_idx`) |

> *Note:* the original work order referenced "7 migrations"; there are now **8** — `womo_0004_db_hardening` was applied in a prior session. This doc reflects the live state.

### Procedure for a future schema change (do this)
1. Write the SQL for the change (DDL).
2. Apply it via the **Supabase migration system** — `apply_migration` (MCP) or the Supabase CLI (`supabase migration new …` + `supabase db push`). This records it in `supabase_migrations.schema_migrations`.
3. **Mirror** the change into `drizzle/schema.ts` so the generated TypeScript types stay aligned (types only — this does not touch the DB).
4. Re-run `get_advisors` (security) after any table/RLS change.

### What NOT to do (and why)
- ❌ **`pnpm db:push`** — now neutralized (prints a BLOCKED message + exits 1). Its old command (`drizzle-kit generate && drizzle-kit migrate`) is preserved as `pnpm db:push:UNSAFE` for knowing use against a **non-production** DB only.
- ❌ **`drizzle-kit migrate`**, ❌ **`drizzle-kit push`**, ❌ **`drizzle-kit generate`** against this DB. **Why:** with no `__drizzle_migrations` ledger, drizzle-kit treats the entire schema as unapplied and attempts to **recreate every enum/table/constraint**, which errors (or partially/doubly applies DDL) and can corrupt the live schema.

---

## 9. Write-path / read-path map

**[FACT]** `db.ts` helper → table(s) it touches → who calls it. (Line numbers are `db.ts` unless noted.)

| Table | Writer helper(s) `@db.ts` | Reader helper(s) `@db.ts` | Called from |
|---|---|---|---|
| subjects | upsertSubject `:179` | listCreatorProfiles `:1091`, listBrandProfiles `:1502`, (joins in profile/match getters); delete via deleteCreatorProfile `:1145`/deleteBrandProfile `:1554` | `routers.ts` (persist*, list, delete) |
| platform_handles | upsertPlatformHandle `:292` | getBrandProfileById `:1304` (join) | `routers.ts` |
| observations | insertObservation `:328`, updateObservationTranscriptCount `:664` | getLatestObservationId `:372`, getProvenance/profile joins | `routers.ts` (persist*) |
| creator_observations | insertCreatorObservation `:390`, updateCreatorObservationAvgDuration `:469` | getCreatorProfileById `:820` | `routers.ts` (persistCreatorToV2), `performanceSignals.ts` (reads profile) |
| brand_observations | insertBrandObservation `:1158` | getBrandProfileById `:1304` | `routers.ts` (persistBrandToV2), `performanceSignals.ts` |
| signal_values | insertSignalValues `:483` | getCreatorProfileById/getBrandProfileById subqueries | `routers.ts` |
| decoded_signals | insertDecodedSignals `:519` | profile getters | `routers.ts` |
| content_items | insertContentItems `:551`, updateContentItemTranscript `:629` | getContentItemsBySubject `:1008`, profile getters | `routers.ts` (persist* + ingestSupplementalVideo) |
| audience_mentions | insertAudienceMentions `:1257` | **none** | `routers.ts:341` (persistBrandToV2) — **table empty** |
| llm_invocations | insertLlmInvocation `:721` | getLlmTokenUsageBySubject `:757`, getLlmTokenUsageByTimeWindow `:784`, getProvenance `:1044` | `_core/llm.ts` (write); `routers.ts` (read: pipeline metrics/provenance) |
| scrape_events | insertScrapeEvent `:687` | getProvenance `:1044` | `scraping/httpClient.ts`, `webResearch.ts`, `reviewResearch.ts` (write); `routers.ts` (read) |
| match_scores | insertMatchScore `:1567` | listMatchRecords `:1769`, getMatchWithProfiles `:1827`, getComparablePartnerships `:1906`; delete deleteMatchRecord `:1821` | `routers.ts` (fit.calculate / fit.get / fit.list / fit.comparable / fit.delete) |
| match_narratives | insertMatchNarrative `:1669` | getMatchWithProfiles `:1827` | `routers.ts` |
| match_warnings | insertMatchWarnings `:1707` | getMatchWithProfiles `:1827` | `routers.ts` |
| match_overlaps | insertMatchOverlaps `:1726` | getMatchWithProfiles `:1827` | `routers.ts` |
| match_content_directions | insertMatchContentDirections `:1746` | getMatchWithProfiles `:1827` | `routers.ts` |
| **niche_taxonomy** | **none** | (FK target only) | — |
| **archetype_transitions** | **none** | none | — |
| **semantic_documents** | **none** | none | — |
| **pipeline_runs** | **none** | none | — |
| **users** | upsertUser `:57`, — | getUserByOpenId `:86` | **zero callers** (orphaned) |

---

## 10. Integrity & usage gaps

| # | Sev | Gap | Evidence |
|---|---|---|---|
| 1 | **low-med** | **Count-type split.** `audience_mentions.{view,like,comment,share,save}_count` are `integer` (max ~2.1B) while the same metrics on `content_items` are `bigint`. Viral mention metrics could overflow. Mitigated today only because `audience_mentions` is empty. | `schema.ts:504-508` vs `:445-449` |
| 2 | **low** | **`match_scores → observations` FKs are `NO ACTION`** (not cascade/set-null). Deleting an `observation` directly that a match references would be blocked. Not hit in practice (observations are only deleted via `subjects` cascade, which also cascades the match rows). | live FK query |
| 3 | **low** | **`niche_taxonomy` has no writer** → `creator_observations.niche_id` is always NULL; niche is stored as free-text `niche_topic_node` instead. `niche_taxonomy` FK/hierarchy is dead structure. | `db.ts` (no insert); `schema.ts:279` |
| 4 | **low** | **`semantic_documents.embedding` documented but not created** (comment-only, `schema.ts:747`); pgvector dormant. Semantic search is non-functional. | live column list (8 cols, no embedding) |
| 5 | **low** | **`pipeline_runs` never written** — bulk jobs use an in-memory `Map` (`bulkAnalysisJobs.ts`), lost on restart; the durable table is unused. | `db.ts` (no insert) |
| 6 | **info** | **`users` table orphaned** (0 rows, 0 callers) — legacy OAuth artifact; live auth is DB-less PIN→HMAC. | `db.ts:57,86` callers = none |
| 7 | **info** | **Dead columns:** `match_scores` 3 Cultural-Signal pairs (`cultural_identity/_momentum/partnership_stability` ± confidence) are never written/read; `llm_invocations.{temperature,response_json,match_score_id}` are never written. No data-loss risk; schema clutter. | `schema.ts:641-649`; `_core/llm.ts` |
| 8 | **info** | **No "written-but-unmigrated" columns.** Live schema == `schema.ts` == applied migrations (zero drift). The only comment-only DDL (`embedding`) is written by neither code nor a migration. | column cross-check |

---

## 11. Governance guardrails (this doc's companion changes)

Applied at commit time (see the commit that adds this doc):
1. **`package.json`** — `db:push` neutralized to `echo 'BLOCKED …' && exit 1`; original command preserved as **`db:push:UNSAFE`**.
2. **`drizzle/schema.ts`** and **`drizzle.config.ts`** — "TYPES ONLY — Supabase-migration-managed; do not run drizzle-kit against production" banner added at the top, pointing here.
3. No schema definition or migration was changed by this task.

---
*End of storage model. Regenerate the live sections (`§2`–`§7`) after any Supabase migration.*
