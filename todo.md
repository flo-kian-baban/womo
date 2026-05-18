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

## Backlog / Future Enhancements
- [ ] PDF export using server-side rendering
- [ ] Bulk comparison: one influencer vs. multiple brands
- [ ] Historical score tracking and trend charts
- [ ] Team collaboration and shared workspaces
