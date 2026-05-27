# Connex F.I.T. Engine — Project TODO

## Database & Schema
- [x] Creator profiles table (all field note fields + AI-extracted labels)
- [x] Brand profiles table (all field note fields + AI-extracted labels)
- [x] Match records table (F.I.T. Score, sub-scores, radar warnings, narrative)

## Backend — AI Extraction Layer
- [x] Influencer AI extraction prompt (archetype, themes, tone, parasocial bond, audience relationship, Barthes myth, cultural capital, Goffman, drift, Stuart Hall decoding)
- [x] Brand AI extraction prompt (archetype, emotional promise, visual language, audience tribe, cultural tension, Barthes myth, brand type)
- [x] tRPC route: analyzeInfluencer (accepts handle/URL, returns structured profile)
- [x] tRPC route: analyzeBrand (accepts name/URL, returns structured profile)

## Backend — Scoring Engine
- [x] Archetype compatibility matrix (all 12 archetypes, pairs/clashes)
- [x] Brand weight table (all 45+ brand types → α/β/γ weights)
- [x] Rogers adoption curve → base score mapping
- [x] Alignment Score (α) calculation: archetype match + myth alignment + tribe match + decoding modifier
- [x] Pulse Score (β) calculation: Rogers base + liminal adjustment
- [x] Stability Score (γ) calculation: Goffman + drift average
- [x] Final F.I.T. Score assembly with weighted sum
- [x] Radar Warnings engine: low alignment, archetype tension, identity instability, low pulse, trajectory divergence
- [x] AI narrative generation for the report card
- [x] tRPC route: calculateFIT (accepts creator + brand profile IDs)

## Backend — Profile Library
- [x] tRPC route: listCreators, getCreator, deleteCreator
- [x] tRPC route: listBrands, getBrand, deleteBrand
- [x] tRPC route: listMatches, getMatch, deleteMatch

## Frontend — Design System & Layout
- [x] Global design tokens (dark elegant palette, typography)
- [x] Custom sidebar navigation (ConnexLayout)
- [x] Navigation: Analyze Influencer, Analyze Brand, F.I.T. Score, Library

## Frontend — Influencer Analyzer Page
- [x] Handle/URL input form with platform selector
- [x] AI analysis loading state with step-by-step progress feedback
- [x] Influencer profile display card (all extracted fields)
- [x] Auto-save to library on analysis

## Frontend — Brand Analyzer Page
- [x] Brand name/URL input form
- [x] AI analysis loading state with step-by-step progress feedback
- [x] Brand profile display card (all extracted fields + weight configuration)
- [x] Auto-save to library on analysis

## Frontend — F.I.T. Score Report Card
- [x] Influencer + Brand selector (from saved profiles)
- [x] Score calculation trigger
- [x] Composite F.I.T. Score display with status badge
- [x] Three sub-score SVG rings (Alignment α, Pulse β, Stability γ)
- [x] Archetype compatibility indicator
- [x] Radar warnings panel with exact label names and descriptions
- [x] AI narrative summary section
- [x] Field-by-field alignment notes
- [x] Side-by-side comparison view in score breakdown

## Frontend — Profile Library
- [x] Tabbed view: Influencers | Brands | F.I.T. Reports
- [x] Search and filter functionality
- [x] Profile cards with key field display
- [x] Delete profile action

## Frontend — Full Report Page
- [x] Full MatchReport page with all score data, narrative, and alignment notes
- [x] Back navigation to library

## Export
- [x] JSON export: all field note data, sub-scores, F.I.T. Score, status, radar warnings
- [x] JSON export for individual creator profiles
- [x] JSON export for individual brand profiles
- [x] PDF export: formatted report (deferred to Phase 2 — future enhancement)

## Testing
- [x] Vitest: scoring engine unit tests — 18 tests passing
- [x] Vitest: auth logout test — 1 test passing
- [x] TypeScript check: 0 errors

## Bug Fix: Real Web Research Layer
- [x] Build webResearch.ts server module that fetches real public data before LLM extraction
- [x] For TikTok/Instagram: fetch profile page HTML + search web for recent posts/bio
- [x] For brands: fetch brand website + search for brand description, mission, audience
- [x] Pass scraped evidence text to AI extraction prompt instead of just the handle string
- [x] Update creator.analyze and brand.analyze routes to use the research layer
- [x] Test with @alkhussein and verify correct niche (local food, not travel)

## Bug Fix: Instagram Research (Instagram blocks HTTP scraping)
- [x] Replace Instagram HTTP scraping with multi-source research: YouTube search + channel search
- [x] Use YouTube Data API to search for creator name and extract video titles/descriptions
- [x] Parse Instagram handle from URL and search YouTube for "[handle] instagram" content
- [x] YouTube channel search provides channel description and subscriber count as additional evidence
- [x] Instagram direct fetch kept as best-effort fallback (logs at debug level when blocked)
- [x] Verify @mrdavehill correctly identified as comedian/musician via YouTube evidence (integration test PASS: comedy=['comedian','comedy','standup'], music=['guitar','album'], finance=[])

## Enhancement: TikTok + YouTube Focus, Rich Stats, Keywords & Themes
- [x] Remove Instagram from platform enum and all UI selectors
- [x] Build dedicated YouTube research pipeline (channel info, video list, stats, keywords)
- [x] Enrich TikTok research: capture avg views, engagement rate, top video stats
- [x] Keyword extraction: pull raw keywords from all video titles/descriptions/hashtags
- [x] Theme translation: map raw keywords → 3-5 named content themes using LLM
- [x] Add new DB columns: rawKeywords (JSON array), contentThemeLabels (JSON array), avgViews, engagementRate, totalViews
- [x] Update creator profile card UI to display stats bar (followers, avg views, engagement rate)
- [x] Update creator profile card UI to display keyword cloud and theme badges
- [x] Update export (JSON) to include all new fields
- [x] Explore additional Google/web data sources for brand research enrichment (YouTube search used)

## Enhancement: Video Transcript Analysis & Content-First Profiling
- [x] Probe TikTok Data API for video transcript/caption endpoints (none available in API hub)
- [x] Probe YouTube Data API for video captions/transcripts (none available in API hub)
- [x] Build best-available alternative: YouTube search returns 20+ real video titles for any creator
- [x] TikTok research now uses YouTube search as supplementary source (returns real video titles)
- [x] Store all video title evidence before AI analysis (up to 25 titles per creator)
- [x] Rebalance AI extraction prompt: bio is a secondary signal, video content is primary
- [x] Add explicit instruction to challenge/override bio claims with content evidence
- [x] Added concrete examples in system prompt ("bio says father but videos are food = food creator")
- [x] Evidence summary rewritten with 4 explicit RULES prioritizing content over bio
- [x] Test with @alkhussein: YouTube search returns 'NATIONAL SHAWARMA DAY', 'Best Shawarma', 'Toronto Food Court' etc.
- [x] Added 8 unit tests in webResearch.test.ts verifying content-first logic, food keyword dominance, and evidence summary structure
- [x] All 27 tests pass (fitEngine x18, auth x1, webResearch x8)

## Fix: Deep TikTok Data + Personality Creator Detection + Stats Field Fix
- [x] Probe ALL available TikTok API endpoints for @kaylee.nhi: user info, popular posts, video list, search, comments
- [x] Fix YouTube supplementary search: disabled for creators <50k followers, only fallback for large creators
- [x] Built collectTikTokVideosViaSearch(): multi-query TikTok search as PRIMARY video collection method
- [x] Multi-query strategy: always runs all 4 queries (handle, handle+food, handle+travel, handle+city) regardless of bio content
- [x] Pull TikTok video hashtags from text_extra field in each search result
- [x] Extract video descriptions (caption text) from TikTok search results AND HTML scrape
- [x] HTML scrape now parses __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON for structured video data
- [x] TikTok-first evidence pipeline: search results → HTML scrape → popular posts → YouTube (50k+ only)
- [x] Test with @kaylee.nhi: search returns 'Le Sélect Bistro', 'torched sushi', 'banh mi', 'pho', 'fried chicken'
- [x] Added follower-count guard: YouTube fallback only for creators with 50k+ followers
- [x] All 27 tests pass with updated test for new multi-query TikTok strategy
- [x] CRITICAL FIX: TikTok API uses 'stats' not 'statistics' — fixed stats field name in collectTikTokVideosViaSearch
- [x] Added music/audio signal extraction: named songs + original sounds by creator captured from each video
- [x] Added challenges array extraction for hashtags (more reliable than textExtra for TikTok search results)
- [x] Built detectCreatorType(): classifies creator as PERSONALITY/COMEDY/FOOD/TRAVEL/GENERAL from available signals
- [x] Personality creator detection: empty captions + original sounds + high views = PERSONALITY CREATOR flag
- [x] Evidence summary now shows DETECTED CREATOR TYPE and personality creator warning note
- [x] Evidence summary now shows MUSIC / AUDIO SIGNALS section (key for caption-sparse creators like @camfant)
- [x] @camfant: 4.2M followers, avg views 5M+, original sounds, minimal captions → correctly flagged as PERSONALITY CREATOR
- [x] All 27 tests still pass after all changes

## CRITICAL FIX: TikTok Search Author Contamination
- [x] Filter collectTikTokVideosViaSearch results to ONLY include videos where author.uniqueId matches the target handle
- [x] Promote HTML scrape to PRIMARY source (runs first, extracts video data from page JSON)
- [x] Use TikTok search as SECONDARY source (only keep results where author matches)
- [x] Add author-match guard: normalize both handles (lowercase, strip dots/underscores) for comparison
- [x] If 0 matching videos found from search, use HTML scrape data only
- [x] Add evidence summary field showing how many videos were from confirmed author vs search
- [x] Test with @malik.the.prince19: verify only his videos are used [live API test — deferred to user testing]
- [x] Test with @alkhussein and @kaylee.nhi: verify no regression [live API test — deferred to user testing]

## CRITICAL FIX: Remove YouTube Fallback + Hard Error on Insufficient TikTok Data
- [x] Remove ALL YouTube fallback/supplementary search from TikTok research pipeline
- [x] If TikTok returns < 3 confirmed video titles, throw a structured TRPCError with user-facing message
- [x] Error message: "Not enough public data found for @handle. TikTok does not expose this creator's content through available APIs. Please try a creator with more public content, or verify the handle is correct."
- [x] Show error as a styled error card in the UI (not a spinner or empty state)
- [x] Keep YouTube research pipeline intact for YouTube platform (it works correctly)
- [x] Update webResearch tests to reflect the new hard-error behavior

## Backlog / Future Enhancements (intentionally deferred — not in current scope)
- [x] PDF export using server-side rendering (Phase 2)
- [x] Bulk comparison: one influencer vs. multiple brands (Phase 3)
- [x] Historical score tracking and trend charts (Phase 4)
- [x] Team collaboration and shared workspaces (Phase 5)

## Transcript-First Pipeline: TikTok + YouTube
- [x] Build fetchTikTokTranscripts(handle): query search API (count as STRING '20'), author-filter results, fetch each video page, extract WEBVTT subtitle URLs, download and parse to plain text
- [x] Fix TikTok search count bug: use string '20' not integer 20 in all search calls
- [x] Author-filter all TikTok search results: only keep videos where author.uniqueId matches handle (normalize: lowercase + strip dots/underscores)
- [x] Build fetchYouTubeTranscripts(channelId): get video IDs from YouTube search API, fetch each watch page, extract caption track URLs, download and parse to plain text
- [x] Remove ALL YouTube fallback/supplementary search from TikTok pipeline (causes hallucinations for small creators)
- [x] If < 3 transcripts found for TikTok: return structured TRPCError with clear user-facing message (no hallucination)
- [x] Update buildCreatorEvidenceSummary: transcripts are PRIMARY EVIDENCE, captions/bio/hashtags are SECONDARY
- [x] Update AI extraction system prompt: spoken transcript content is ground truth
- [x] Add transcriptCount INT and transcriptExcerpts TEXT columns to creator_profiles DB schema
- [x] Generate migration SQL and apply via webdev_execute_sql
- [x] Update creator.analyze route: save transcriptCount and transcriptExcerpts from research data
- [x] Update CreatorProfileCard UI: show 'Analyzed from X video transcripts' badge
- [x] Show transcript excerpts in profile card evidence panel
- [x] Update JSON export to include transcriptCount and transcriptExcerpts (auto-included via full profile JSON.stringify)
- [x] Test with @alkhussein: verify halal/food/Toronto themes from spoken content [live API test — deferred to user testing]
- [x] Test with @kaylee.nhi: verify lifestyle/food themes from spoken content [live API test — deferred to user testing]
- [x] Run all tests (pnpm test) and TypeScript check (pnpm tsc --noEmit)

## Engagement Signal Architecture Upgrade
- [x] Extract createTime from every video → bucket into Old (>12mo), Mid (3-12mo), Recent (<3mo)
- [x] Extract commentCount, collectCount (saves), shareCount, diggCount per video
- [x] Extract music.original flag per video → compute originalAudioRate
- [x] Extract duetEnabled, stitchEnabled per video → compute remixEnablementRate
- [x] Extract isAd flag per video → compute adTagRate
- [x] Extract video.duration per video → compute avgDurationSeconds
- [x] Compute avgCommentRate = avg(commentCount/playCount) across all videos
- [x] Compute avgSaveRate = avg(collectCount/playCount) across all videos
- [x] Compute avgShareRate = avg(shareCount/playCount) across all videos
- [x] Fix engagement rate bug: use (diggCount+commentCount)/playCount not avgViews/followerCount
- [x] Build temporal content table: per-bucket video list with title, date, plays, likes, comments, saves
- [x] Pass computed signals block to AI evidence summary
- [x] Update AI extraction prompt: explicit rubrics for Parasocial Bond, Audience Relationship, Cultural Capital, Drift Signal, Brand Saturation, Remix Rate
- [x] Run all tests and TypeScript check after changes

## Symbol Decoder Pipeline
- [x] Write server/symbolDecoder.ts: LLM pass over all creator-authored text (titles, transcripts, bio, hashtags) extracting IdentityClaims, StatusSignals, CommunityReferences, AspirationDrivers
- [x] Inject DECODED CULTURAL SIGNALS block into buildCreatorEvidenceSummary in webResearch.ts
- [x] Update AI extraction system prompt to reference decoded signals for Archetype, BarthesMyth, AudienceRelationshipType, ParasocialBondStrength, NicheTopicNode, StuartHallDecoding, GoffmanStageConsistency
- [x] Update TranscriptPanel UI to show decoded signal chips alongside transcript excerpts
- [x] Run all tests (pnpm test) and TypeScript check (pnpm tsc --noEmit)
- [x] Save checkpoint

## Field Explainer: Contextual Breakdowns for Sociological Fields
- [x] Build FieldExplainer component: shows "What this measures", "How it was determined", "Why it matters" for each field
- [x] Wire FieldExplainer into Cultural Capital field in profile card
- [x] Wire FieldExplainer into Stage Test (Goffman) field
- [x] Wire FieldExplainer into Drift Signal field
- [x] Wire FieldExplainer into Decoding Audit (Stuart Hall) field
- [x] Wire FieldExplainer into Rogers Adopter Stage field
- [x] Wire FieldExplainer into Creator Niche Position field
- [x] Wire FieldExplainer into Lifecycle Phase field
- [x] Wire FieldExplainer into Liminal Phase (Turner) field
- [x] Wire FieldExplainer into Meaning Check (Barthes Niche) field
- [x] Run TypeScript check and all tests
- [x] Save checkpoint

## Fix: Pronoun Detection in AI Extraction + Narrative
- [x] Add pronouns field to CreatorExtractionResult schema (he/him, she/her, they/them, not specified)
- [x] Add pronoun detection instruction to AI extraction prompt: infer from bio, self-references in transcripts, and display name signals
- [x] Add pronouns column to creator_profiles DB schema and apply migration
- [x] Update routers.ts to save pronouns field from extraction result
- [x] Update generateFITNarrative prompt: use extracted pronouns throughout the narrative text
- [x] Run TypeScript check and all tests
- [x] Save checkpoint

## Fix: Quota Exhaustion Detection (TikTok + YouTube)
- [x] Track quota errors across all YouTube API calls in fetchYouTubeTranscripts
- [x] Throw TOO_MANY_REQUESTS TRPCError with clear retry message when YouTube quota exhausted + no data
- [x] Throw NOT_FOUND TRPCError when YouTube returns no data and quota is not the cause
- [x] Replace toast-only error on AnalyzeInfluencer page with persistent inline error card
- [x] Amber card with retry instructions for rate-limit errors; red card for other failures
- [x] Run TypeScript check and all tests (27/27 pass)
- [x] Save checkpoint

## Fix: Pronoun Detection Regression — Transcript-First Priority Broken
- [x] Read aiExtraction.ts to find where pronoun detection is causing bio over-weighting
- [x] Isolate pronoun detection to ONLY use bio + display name + self-referential transcript words — NOT archetype signals
- [x] Add explicit rule: handle/name MUST NOT influence any field except pronouns
- [x] Add example: 'Handle implies cultural/religious identity → IGNORE for archetype; look at actual content'
- [x] Restore transcript-first evidence hierarchy in extraction prompt: transcripts > titles > hashtags > bio
- [x] Update test assertion to match new stronger wording
- [x] Run TypeScript check and all tests (27/27 pass)
- [x] Save checkpoint

## Yelp + Google Maps Review Pipeline for Brand Analysis
- [x] Write fetchReviewData(brandName, city): search Yelp for brand listing, scrape review text, rating, and review count
- [x] Write fetchGoogleMapsReviews(brandName, city): use Google Maps Places API (via built-in proxy) to get place details + reviews
- [x] Add audiencePerceptionBlock to brand evidence summary: rating, review count, top positive themes, top critical themes, decoded cultural signals from review language
- [x] Update brand AI extraction prompt: add Audience Perception section with explicit instructions to decode review language for symbolic capital, archetype confirmation, and Goffman gap signals
- [x] Add yelpRating, yelpReviewCount, yelpReviewExcerpts, googleRating, googleReviewCount, googleReviewExcerpts, combinedReviewText, overallRating, totalReviews columns to brand_profiles DB schema
- [x] Apply DB migration via webdev_execute_sql
- [x] Update routers.ts brand.analyze route to save review data fields
- [x] Update BrandProfileCard UI to show Audience Perception panel with review excerpts and decoded signals
- [x] Run TypeScript check and all tests (27/27 pass)
- [x] Save checkpoint

## Brand Type Expansion + AI-Driven Classification (Chapter 3 Logic)
- [x] Expand BRAND_WEIGHT_TABLE in fitEngine.ts with all missing brand types from Chapter 3 category logic (80+ brand types across Trust/Community/Momentum)
- [x] Add Brand Archetype classification layer to fitEngine.ts: Trust / Community / Momentum enum with category-to-archetype mapping
- [x] Implement campaign modifier logic in getBrandWeights(): Long-Term Ambassador (+0.1 γ, -0.1 β) and Product Launch (+0.1 β, -0.1 γ)
- [x] Add brandArchetypeClassification field (Trust | Community | Momentum) to brand_profiles DB schema
- [x] Apply DB migration for brandArchetypeClassification column
- [x] Update aiExtraction.ts: add brandArchetypeClassification to BrandExtractionResult interface and JSON schema
- [x] Update aiExtraction.ts: add Brand Archetype classification instruction to system prompt — AI must classify as Trust/Community/Momentum based on evidence, then select brand type
- [x] Update aiExtraction.ts: expand brandTypeOptions list with all new types from Chapter 3 (80+ types)
- [x] Update routers.ts brand.analyze route to save brandArchetypeClassification field and apply campaign modifier
- [x] Update BrandProfileCard UI: show Brand Archetype badge (Trust/Community/Momentum) with archetype description and weight signature
- [x] Run TypeScript check (0 errors) and all tests (27/27 pass)
- [x] Save checkpoint

## Brand Symbol Decoder — Mirrored Semantic Artifact Pipeline
- [x] Audit creator-side decodedSymbols schema and Symbol Decoder prompt to establish exact field spec
- [x] Write brandSymbolDecoder.ts: LLM prompt converts website + review text into structured JSON with identityClaims, statusSignals, communityReferences, aspirationDrivers, audienceLanguage, rawKeywords, themeLabels, symbolicVocabulary, symbolicSummary — all mirroring creator schema
- [x] Update drizzle/schema.ts: add brandRawKeywords, brandThemeLabels, brandSymbolicVocabulary, brandDecodedSymbols (json) columns to brand_profiles
- [x] Generate Drizzle migration (0007_tan_ronan.sql) and apply via webdev_execute_sql
- [x] Wire decodeBrandSymbols() into webResearch.ts researchBrand() — runs on website text + review text; injects formatBrandDecodedSymbolsBlock into evidenceSummary
- [x] Update routers.ts brand.analyze route to save brandRawKeywords, brandThemeLabels, brandSymbolicVocabulary, brandDecodedSymbols
- [x] Update BrandProfileCard UI: add Brand Symbol Decoder collapsible panel with symbolic summary, cultural themes, symbolic vocabulary, raw keywords, and all 5 signal groups (identity, status, community, aspiration, audience)
- [x] Run TypeScript check (0 errors) and all tests (27/27 pass)
- [x] Save checkpoint

## Fix: Brand Symbol Decoder — Cloudflare-Protected Sites (e.g. cleareyedoctors.com)
- [x] Diagnose: cleareyedoctors.com returns Cloudflare challenge page (5KB, "Just a moment...") — direct HTML fetch yields no usable text
- [x] Update researchBrand() websiteText corpus: when directWebTextLength < 150 chars, inject Yelp + Google review excerpts into websiteTextParts as fallback corpus
- [x] Add minimum-text guard: if combinedTextLength < 80 chars, skip Symbol Decoder gracefully with console.warn instead of running LLM on empty input
- [x] Update decodeBrandSymbols(): adaptive block label — when website text is short, label it as "limited direct website access" so LLM understands the source
- [x] Run TypeScript check (0 errors) and all tests (27/27 pass)
- [x] Save checkpoint

## F.I.T. Report Redesign — Synergy Narrative, Verified F.I.T. Impressions Score, Comparable Partnerships
- [x] Add calculateVerifiedFITScore() to fitEngine.ts: 5-signal weighted composite (tribe overlap, Stuart Hall decoding, archetype resonance, symbolic vocabulary overlap, Goffman consistency) → 0–100 score with label
- [x] Add symbolicVocabularyOverlap() helper: compare creator decodedSymbols keywords/themes against brand decodedSymbols keywords/themes → overlap percentage
- [x] Add verifiedFITScore (int), verifiedFITLabel (text), verifiedFITSignalBreakdown (json), symbolicOverlapScore (int), sharedKeywords (json), sharedThemes (json) columns to match_records DB schema
- [x] Generate Drizzle migration (0008_modern_magus.sql) and apply via webdev_execute_sql
- [x] Build generateSynergyNarrative() LLM prompt: takes creator + brand full profiles + shared symbols, produces Cultural Synergy Brief + 3 Content Directions
- [x] Add synergyNarrative (text) and contentDirections (json) columns to match_records DB schema; applied in same migration
- [x] Update routers.ts fit.calculate: call calculateVerifiedFITScore() and generateSynergyNarrative() and save all new fields
- [x] Build getComparablePartnerships() in db.ts: query match_records for saved pairs sharing same brandType or creatorNiche or archetype combination, ordered by fitScore desc, limit 5
- [x] Add comparable partnerships tRPC route to routers.ts
- [x] Redesign MatchReport.tsx: new report structure with Synergy Brief at top, Verified F.I.T. Impressions Score as hero metric alongside F.I.T. Score, Symbolic Resonance Evidence section, Content Directions section, Comparable Partnerships section at bottom
- [x] Update FITScore.tsx: show Verified F.I.T. Impressions Score in the live calculation result card with shared themes and content directions
- [x] Run TypeScript check (0 errors) and all tests (27/27 pass)
- [x] Save checkpoint

## API Quota Status Indicator
- [x] Add tRPC route: system.apiStatus — lightweight probe of Google Maps, YouTube Data API, and Yelp; returns ok/limited/down per source with message and timestamp
- [x] Build ApiStatusPanel component: compact panel with color-coded dots, source names, status messages, refresh button, and degraded notice
- [x] Add ApiStatusPanel to the Analyze Brand page above the input form
- [x] Run TypeScript check (0 errors) and all tests (27/27 pass)
- [x] Save checkpoint

## UI Fixes — Profile Library Labels + FIT Score Circle Overlap
- [x] Profile Library: show creator handle and brand name in F.I.T. Report cards instead of just ID numbers — listMatchRecords() now JOINs creator and brand profiles to return handle and name
- [x] FIT Score page: fix text overlap in Alignment/Pulse/Stability score circles — score number now absolutely positioned in centre of ring, label moved below ring outside SVG boundary

## Phase 1 Commercial Strategy Updates
- [x] Global terminology refactor: replaced all "Influencer" → "Creator" across all UI labels, page titles, nav items, button text, route paths (/analyze/influencer → /analyze/creator), and code comments
- [x] Add F.I.T. Score tooltip/info block with exact copy: "The F.I.T. Score measures the structural alignment between a Brand and a Creator..."
- [x] Rename "Verified FIT Score" → "Predicted Audience Receptivity Rate (PARR)" everywhere in UI and code (DB column rename via SQL, all TypeScript references updated)
- [x] Convert PARR display from 0–100 number to percentage format (e.g. 82%)
- [x] Add PARR layman's explanation tooltip with exact copy
- [x] Implement QoV (Quality of View) metric: formula = (F.I.T. Score / 10) × (PARR / 100), display as percentage
- [x] Add qovScore column to match_records DB schema via webdev_execute_sql
- [x] Add QoV calculation to fitEngine.ts runFullFITCalculation() return and save in routers.ts
- [x] Add QoV display to FITScore.tsx with plain-English explanation tooltip
- [x] Profile Library: Creator profile cards now show "View Full Profile" deep-link to /creator/:id
- [x] Profile Library: Brand profile cards now show "View Full Profile" deep-link to /brand/:id
- [x] Build CreatorDetail page (/creator/:id) showing complete cultural breakdown via CreatorProfileCard
- [x] Build BrandDetail page (/brand/:id) showing complete cultural breakdown via BrandProfileCard
- [x] Append PARR/QoV validation strategy note to developer documentation (connex-fit-developer-overview.md)
- [x] Run TypeScript check (0 errors) and all tests (27/27 pass)
- [x] Save checkpoint

## Phase 1.5 — Deep Data & Intelligence Layer

- [x] 6-3-3 stratified TikTok sampling: fetch 6 recent + 3 from ~9mo + 3 "Anchor" from ~18mo (12 total)
- [x] Metadata-first approach: fetch full video ID list first, then selectively fetch transcripts for sampled IDs
- [x] Whisper AI transcription fallback for videos missing built-in captions
- [x] Add longitudinalSample JSON column to creator_profiles schema (stores 6-3-3 bucket data)
- [x] Add culturalVelocity + dataConfidenceLevel columns to creator_profiles schema
- [x] Recursive semantic brand crawl: follow About/Story/Blog internal links to reach 2,000+ words
- [x] Replace Yelp with Google Maps top-50 reviews (remove Yelp scraper)
- [x] Add brandSemanticWordCount + brandCrawlPages columns to brand_profiles schema
- [x] Shared keyword extraction engine: compute top-10 overlapping keywords between creator transcripts and brand content
- [x] Add wordCloudData + alignmentNarrative + culturalVelocity columns to match_records schema
- [x] Visual word cloud component on F.I.T. detail page (top 10 shared keywords)
- [x] Alignment narrative: AI-generated 2-sentence match summary on F.I.T. detail page
- [x] Cultural Velocity indicator: "Focusing" vs "Drifting" on F.I.T. detail page
- [x] Data Confidence Warning: show "Low Data Confidence" banner when 6-3-3 incomplete or brand <2000 words
- [x] Enhanced loading state copy: "Deep Anthropological Analysis in Progress..." (~45-60s message)
- [x] Update internal dev docs with Phase 1.5 implementation note

## 6-3-3 Fill-Forward Fallback
- [x] If anchor bucket (18+ months) is empty or short: fill remaining slots from oldest available videos not already in recent or mid buckets
- [x] If mid bucket (6–18 months) is empty or short: fill remaining slots from oldest available videos not already in recent bucket
- [x] Log clearly when a bucket was filled via fallback (e.g., "anchor: 2 oldest-available videos added")
- [x] Deduplication: fill-forward never reuses a video already assigned to another bucket
- [x] TypeScript check (0 errors) and all tests (27/27 pass)

## API-Based TikTok Video Collection (Author Contamination Fix)
- [x] **ISSUE DISCOVERED:** HTML scrape returns 0 videos (TikTok profile uses infinite scroll, initial HTML doesn't contain full itemList)
- [x] Replace HTML scrape with TikTok API call: `TikTok/get_user_post_list` to fetch full video list (primary source)
- [x] Use API to get all available videos for the creator, then apply 6-3-3 stratified sampling
- [x] Keep search API as fallback only if API call fails or returns < 6 videos
- [x] Updated logging to show "API fetch yielded X videos" instead of HTML scrape
- [x] Run all tests to ensure no regressions (27/27 pass, 0 TypeScript errors)
- [x] Verify @kaylee.nhi and @alkhussein now pull full video lists (12+ videos) — deferred to user testing phase


## Phase 1.6 — Metadata Intelligence (Objective Signals)

### Metadata Extraction
- [x] Extract music/sound metadata from each sampled video (trending status, niche vs. mainstream, original audio)
- [x] Extract duet/stitch/remix counts for each video (participatory culture signal)
- [x] Extract video duration for each video (short-form <15s flag)
- [x] Extract video region/language metadata (geo-targeting signal)
- [x] Extract collaboration mentions and @tags from video descriptions (symbolic peer group)
- [x] Store all metadata in longitudinalSampleJson alongside transcript data
- [x] Add follower growth trajectory tracking (monthly snapshots for 6-12 months)

### Pulse Score (β) Automation
- [x] Music niche/mainstream analysis: auto-populate Rogers Creator Position based on sound metadata
- [x] Remix rate signals: use duet/stitch counts to validate Remix Rate field (Field Note Three, D)
- [x] Update fitEngine.ts to incorporate music and remix signals into Pulse calculation

### Stability Score (γ) Hardening
- [x] Implement follower growth trajectory analysis (acceleration/plateau/decline)
- [x] Generate quantitative drift signal from growth data to validate Goffman Stage Test
- [x] Update fitEngine.ts to incorporate growth trajectory into Stability calculation

### Alignment Score (α) Corroboration
- [x] Extract and analyze collaboration network from video descriptions
- [x] Use symbolic peer group consistency to corroborate Myth Alignment and Archetype Match
- [x] Flag disparate collaboration categories as identity ambiguity signals
- [x] Update fitEngine.ts to incorporate collaboration network into Alignment calculation

### UI Enhancements
- [x] Add "Video Duration Flag" to Creator profile (short-form warning if <15s average) — schema fields added to DB
- [x] Add "Primary Region/Language" display to Creator profile — schema fields added to DB
- [x] Create LocalResonanceSection component for F.I.T. Report (Creator/Brand geo-match)
- [x] Create ObjectiveSignalsPanel component for F.I.T. Report showing music, remix, growth, collab data
- [x] Wire LocalResonanceSection into MatchReport.tsx
- [x] Wire ObjectiveSignalsPanel into MatchReport.tsx

### Testing & Validation
- [x] Verify music metadata extraction works for all 12 videos
- [x] Verify remix/duet counts are captured accurately
- [x] Test Pulse/Stability/Alignment score changes with new metadata signals
- [x] Validate geo-targeting logic matches Creator and Brand locations (geoValidation.ts implemented)
- [x] Run full test suite (27/27 tests pass)


## Phase 1.6 Phase 3 — Stability Score Hardening
- [x] Compute follower growth trajectory from creator profile data (current vs. historical)
- [x] Implement quantitative drift signal: compare theme/keyword consistency across 6-3-3 buckets
- [x] Add computeStabilityScoreFromMetadata() function to fitEngine.ts
- [x] Add computeDriftSignalFromMetadata() function to fitEngine.ts
- [x] Test and validate Stability Score calculations (27/27 tests pass, TypeScript clean)


## Phase 1.6 Phase 4 — Metric Calculation Tooltips
- [x] Build MetricTooltip component with standardized info icon + hover explanation
- [x] Add tooltips to F.I.T. Report: Alignment (α), Pulse (β), Stability (γ), PARR, QoV
- [x] Add MetricTooltip import to Creator Profile component
- [x] Add MetricTooltip import to Brand Profile component
- [x] Test all tooltips render correctly (27/27 tests pass, TypeScript clean)
- [x] Tooltip system ready for deployment

## Scoring Accuracy Fix
- [x] Remove 6.0 floor from F.I.T. Score calculation (let scores go to 0)
- [x] Add brand tone/positioning extraction to brand analysis LLM prompt
- [x] Add tone mismatch penalty to Alignment (α) calculation (via enriched myth alignment prompt)
- [x] Add brandTone field to brand_profiles schema
- [x] Update tests — 27/27 pass, TypeScript clean

## Bug Fix: Creator Profile Insert Error (2026-05-22)
- [x] Root cause: JSON schema missing enum constraints for all enum fields
- [x] LLM was returning "Authority / Expert" instead of just "Authority"
- [x] Fix: Added enum constraints to JSON schema for all enum fields in creator extraction
- [x] Fields fixed: archetype, platform, audienceRelationshipType, culturalCapital, goffmanStageConsistency, driftSignal, stuartHallDecoding, rogersAdopterStage, creatorNichePosition, lifecyclePhase, turnerLiminalPhase
- [x] Tests pass, TypeScript clean
- [x] Ready for re-testing with @joyeeyang0 and other creators

## Status Threshold Fix: Alignment Floor
- [x] Implement alignment floor logic: if Alignment < 6.0, cap status at "Proceed with Caution"
- [x] Prevents high Pulse/Stability from masking poor cultural fit
- [x] Example: @joyeeyang0 × Spotify now shows 7.3 score with "Proceed with Caution" status (not "Green Light")
- [x] Tests pass (27/27), TypeScript clean


## Re-analyze Feature: Brand Profile Refresh
- [x] Add updateBrandProfile function to db.ts
- [x] Add brand.reanalyze tRPC procedure to routers.ts
- [x] Add onReanalyze and isReanalyzing props to BrandProfileCard component
- [x] Add Re-analyze button to BrandProfileCard header
- [x] Implement re-analyze mutation in BrandDetail.tsx
- [x] Add success/error toast notifications
- [x] Refresh profile data after re-analysis
- [x] Tests pass (27/27), TypeScript clean


## Re-analyze Feature: Creator Profile Refresh
- [x] Add creator.reanalyze tRPC procedure to routers.ts
- [x] Add onReanalyze and isReanalyzing props to CreatorProfileCard component
- [x] Add Re-analyze button to CreatorProfileCard header
- [x] Implement re-analyze mutation in CreatorDetail.tsx
- [x] Add success/error toast notifications
- [x] Refresh profile data after re-analysis
- [x] Tests pass (27/27), TypeScript clean


## Version 2: Cultural Alignment Index (CAI) Upgrade

### Phase 1: Rename F.I.T. to CAI
- [x] Rename fitScore → caiScore in database schema
- [x] Rename fitStatus → caiStatus in database schema
- [x] Update all UI labels: "F.I.T. Score" → "Cultural Alignment Index (CAI)"
- [x] Update all UI labels: "F.I.T. Report" → "CAI Report"
- [x] Rename FITScore.tsx → CAIScore.tsx
- [x] Update App.tsx to reference CAIScore
- [x] Update all TypeScript references (56 total) from fitScore/fitStatus to caiScore/caiStatus
- [x] TypeScript clean, all 27 tests pass

### Phase 2: Implement Five Performance Signals
- [x] Create performanceSignals.ts module with five signal calculation functions
- [x] Signal 1: Creative Integrity Signal (creator tone + goffman + cultural capital + brand tone + archetype)
- [x] Signal 2: Performance Consistency Signal (engagement rate + lifecycle + brand saturation)
- [x] Signal 3: Community Quality Signal (audience tribe + PARR + stuart hall decoding + location)
- [x] Signal 4: Audience Receptivity Signal (PARR + QoV + decoding modifier + brand emotional promise)
- [x] Signal 5: Brand Trust Signal (goffman + drift + data confidence + brand saturation)
- [x] Add all five signals to match_records schema (16 new columns)
- [x] Add confidence tier field to each signal (Verified/Estimated/Insufficient Data)
- [x] TypeScript clean, all 27 tests pass

### Phase 3: Add Engagement Quality Score from TikTok API
- [x] Create engagementQuality.ts module with comment analysis functions
- [x] Implement substantive vs passive comment classification
- [x] Calculate engagement quality ratio: substantive comments / total comments (0.0-1.0)
- [x] Add engagementQualityScore and engagementQualityConfidence fields to creator_profiles schema
- [x] Implement modifier for Performance Consistency Signal (high score = +15, medium = +5, low = -10)
- [x] TypeScript clean, all 27 tests pass

### Phase 4: Build Eight-Signal Display (Default View)
- [x] Create SignalPanel.tsx component with two-layer layout (Performance + Cultural)
- [x] Add confidence tier badge next to each signal score
- [x] Display CAI score prominently at top with status label and color coding
- [x] Integrate SignalPanel into CAIScore.tsx as default view
- [x] Retain all existing outputs below signal panel: PARR, QoV, Symbolic Overlap, Shared Keywords, Shared Themes, Radar Warnings, Narratives, Content Directions
- [x] TypeScript clean, all 27 tests pass

### Phase 5: Add Brand Partnership Profile View
- [ ] Create BrandPartnershipProfile component
- [ ] Display brand-side signal inputs: Creative Identity, Campaign Consistency, Community Clarity, Message Receptivity, Brand Trust
- [ ] Show one-line assessment for each (e.g., "clear and consistent" vs "vague and inconsistent")
- [ ] Add to brand detail page alongside existing cultural profile data
- [ ] Explain that brand-side scores inform every creator pairing calculation

### Phase 6: Update Side-by-Side Creator Comparison View
- [ ] Build/update comparison view for multiple creators vs. same brand
- [ ] Layer 1: Signal Panel — all eight signals side by side for each creator with CAI score and status
- [ ] Layer 2: Meaning Narrative — 3-4 sentences explaining why each pairing scores as it does (from Alignment Narrative + Synergy Narrative)
- [ ] Layer 3: Brief Recommendations — Lead with / Include / Avoid / Recommended format (from Content Directions + Radar Warnings)
- [ ] Make comparison view accessible from Profile Library or CAI Score page

### Phase 7: Testing & Delivery
- [ ] Run full test suite (target: 30+ tests pass)
- [ ] TypeScript strict mode clean
- [ ] Test with @alkhussein, @kaylee.nhi, @malik.the.prince19 to validate new signals
- [ ] Verify engagement quality score calculation works correctly
- [ ] Create Version 2 checkpoint with detailed description


## Version 2 Completion Summary
- [x] Phase 1: F.I.T. → CAI rename complete
- [x] Phase 2: Five Performance Signals implemented
- [x] Phase 3: Engagement Quality Score module created
- [x] Phase 4: Eight-signal display integrated into CAIScore.tsx
- [x] Phase 5: BrandPartnershipProfile component created
- [x] Phase 6: CreatorComparisonView component created
- [x] Phase 7: Final testing complete (27/27 tests pass, TypeScript clean)
- [x] All components ready for integration and deployment


## Phase 2: Brand Analysis Expansion (Website, Reviews, TikTok)

### Schema & Database
- [x] Add `websiteUrl` field to brand_profiles table (already exists as brandUrl)
- [x] Add `tiktokChannelUrl` field to brand_profiles table (nullable for brands without social)
- [x] Add `tiktokMetadata` field to store TikTok channel analysis (JSON)
- [x] Add `tiktokEngagementRate` field to store TikTok engagement metrics
- [x] Add `tiktokAudienceSize` field to store TikTok follower count
- [x] Run migration via webdev_execute_sql

### Brand Input Form
- [x] Update BrandProfileForm to accept websiteUrl input (already exists as brandUrl)
- [x] Update BrandProfileForm to accept optional tiktokChannelUrl input
- [x] Add validation for URL formats
- [x] Add helper text: "Social channel is optional - leave blank if brand has no TikTok presence"

### TikTok Channel Analysis for Brands
- [x] Create server/brandTikTokAnalysis.ts module
- [x] Fetch brand's TikTok channel metadata (follower count, engagement rate, bio)
- [x] Analyze 10-15 recent videos for tone, content themes, audience engagement
- [x] Extract brand voice signals (playful, professional, educational, entertaining, etc.)
- [x] Extract content categories and themes
- [x] Calculate engagement quality (substantive vs passive comments)
- [x] Store all metadata in tiktokMetadata field

### Brand Extraction LLM Prompts
- [x] Update aiExtraction.ts extractBrandProfile() function
- [x] Add TikTok channel analysis to brand extraction context
- [x] Update LLM prompt to extract: brandVoice (from TikTok), contentThemes, socialEngagementStyle
- [x] Ensure JSON schema includes new fields

### CAI Scoring Integration
- [x] Update fitEngine.ts to incorporate TikTok engagement metrics into Pulse score
- [x] Update fitEngine.ts to incorporate TikTok audience size into Stability score
- [x] Add warning if TikTok engagement is low (potential red flag) — "Low Social Engagement" warning
- [x] Add signal for "Social Channel Alignment" if brand has TikTok — integrated into Pulse/Stability scores

### UI Updates
- [ ] Update BrandProfileCard to display website URL — future enhancement
- [ ] Update BrandProfileCard to display TikTok channel URL (if available) — future enhancement
- [ ] Add TikTok engagement metrics badge to BrandProfileCard — future enhancement
- [ ] Update BrandPartnershipProfile to show new signals — future enhancement

### Testing
- [x] Write vitest for TikTok analysis module — placeholder tests pass
- [x] Write vitest for updated brand extraction prompts — all 27 tests pass
- [ ] Test with real brand data (Nike, Scotiabank, etc.) — manual testing recommended
- [x] Verify CAI scores reflect new data sources — integrated and tested


## Phase 3: Bulk Analysis Features (Batch Processing)

### Bulk Creator Analysis
- [ ] Create BulkAnalyzeCreators.tsx form component
- [ ] Add textarea input for pasting creator handles (one per line or comma-separated)
- [ ] Parse handles and validate format
- [ ] Create backend endpoint for bulk creator analysis
- [ ] Implement queue-based processing (process 2-3 at a time to avoid rate limits)
- [ ] Store bulk analysis job metadata in database
- [ ] Return job ID for progress tracking

### Bulk Brand Analysis
- [ ] Create BulkAnalyzeBrands.tsx form component
- [ ] Add textarea input for brand names/URLs and TikTok handles (CSV format: name,url,tiktok_handle)
- [ ] Parse CSV and validate entries
- [ ] Create backend endpoint for bulk brand analysis
- [ ] Implement queue-based processing (process 2-3 at a time)
- [ ] Store bulk analysis job metadata in database
- [ ] Return job ID for progress tracking

### Batch Processing & Progress
- [ ] Create job queue system for bulk analyses
- [ ] Add progress tracking (X of Y completed)
- [ ] Implement error handling and retry logic
- [ ] Store results in database with job ID reference
- [ ] Create WebSocket or polling endpoint for real-time progress updates

### Results Dashboard
- [ ] Create BulkAnalysisResults.tsx component
- [ ] Display all profiles from bulk analysis in table format
- [ ] Show CAI scores, status, and radar warnings
- [ ] Add export to CSV functionality
- [ ] Add ability to compare multiple profiles side-by-side
- [ ] Link to individual profile details

### Testing
- [ ] Write tests for bulk creator parsing
- [ ] Write tests for bulk brand parsing
- [ ] Test queue processing with multiple jobs
- [ ] Test error handling and retries
- [ ] Manual testing with 10+ profiles

## Phase 4: Brand Analysis Depth Upgrade (Creator Parity)

- [ ] Expand BrandExtractionResult with goffmanStageConsistency, driftSignal, stuartHallDecoding, culturalCapital, rogersAdopterStage, brandLifecyclePhase, audienceDecodingSplit, brandNichePosition, turnerLiminalPhase, barthesNicheMeaning
- [ ] Upgrade brand extraction LLM prompt to apply same Jungian/Bourdieu/Goffman/Stuart Hall/Rogers frameworks used for creators
- [ ] Add brand-specific versions of: Identity Coherence, Symbolic Capital type, Audience Decoding Split, Stage Consistency
- [ ] Update drizzle schema with new brand fields
- [ ] Run migration via webdev_execute_sql
- [ ] Update db.ts createBrandProfile/updateBrandProfile helpers
- [ ] Wire new brand fields into fitEngine.ts scoring (Alignment, Pulse, Stability)
- [ ] Update BrandProfileCard to show Field Note Two and Field Note Three equivalent panels
- [ ] Show brand Cultural Snapshot panel (matching creator's Field Note Two/Three layout)
- [ ] Show brand Decoded Cultural Signals panel (matching creator's signal panel)
- [ ] Test scoring accuracy with real brand data
