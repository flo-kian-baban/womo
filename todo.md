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

## Fix: Deep TikTok Data + Remove YouTube Contamination for Small Creators
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

## Backlog / Future Enhancements (intentionally deferred — not in current scope)
- [ ] PDF export using server-side rendering
- [ ] Bulk comparison: one influencer vs. multiple brands
- [ ] Historical score tracking and trend charts
- [ ] Team collaboration and shared workspaces
