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
- [ ] PDF export: formatted report (future enhancement)

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
- [ ] Test with @malik.the.prince19: verify only his videos are used [live API test — run in app]
- [ ] Test with @alkhussein and @kaylee.nhi: verify no regression [live API test — run in app]

## CRITICAL FIX: Remove YouTube Fallback + Hard Error on Insufficient TikTok Data
- [x] Remove ALL YouTube fallback/supplementary search from TikTok research pipeline
- [x] If TikTok returns < 3 confirmed video titles, throw a structured TRPCError with user-facing message
- [x] Error message: "Not enough public data found for @handle. TikTok does not expose this creator's content through available APIs. Please try a creator with more public content, or verify the handle is correct."
- [x] Show error as a styled error card in the UI (not a spinner or empty state)
- [x] Keep YouTube research pipeline intact for YouTube platform (it works correctly)
- [x] Update webResearch tests to reflect the new hard-error behavior

## Backlog / Future Enhancements (intentionally deferred — not in current scope)
- [ ] PDF export using server-side rendering
- [ ] Bulk comparison: one influencer vs. multiple brands
- [ ] Historical score tracking and trend charts
- [ ] Team collaboration and shared workspaces

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
- [ ] Test with @alkhussein: verify halal/food/Toronto themes from spoken content [live API test — run in app]
- [ ] Test with @kaylee.nhi: verify lifestyle/food themes from spoken content [live API test — run in app]
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
