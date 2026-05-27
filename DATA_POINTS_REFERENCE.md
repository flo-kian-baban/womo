# Connex F.I.T. Engine — Data Points Reference

## Overview
The Connex F.I.T. Engine captures cultural identity data from creators and brands, then calculates a **Fit (F), Influence (I), Trajectory (T) Score** (0–10) grounded in Jungian archetypes, Bourdieusian symbolic capital, and Stuart Hall media decoding theory.

---

## CREATOR DATA CAPTURED

### Identity & Platform
- **Handle** — Creator's username (TikTok, YouTube, Instagram)
- **Platform** — Where creator is active (TikTok, YouTube, Instagram, Multi)
- **Profile URL** — Link to creator's profile
- **Display Name** — Creator's public name
- **Location** — Geographic region (extracted from profile + metadata)
- **Pronouns** — Inferred from bio, transcripts, display name (she/her, he/him, they/them, not specified)

### Cultural Profile (AI-Extracted)
- **Archetype** — One of 12 Jungian archetypes (Hero, Sage, Everyman, Lover, Creator, Jester, Magician, Innocent, Explorer, Outlaw, Caregiver, Ruler)
- **Tone Register** — 2–3 words describing communication style (e.g., "raw, unfiltered, anti-establishment")
- **Recurring Themes** — 3–4 core content topics (e.g., ["humor", "social commentary", "storytelling"])
- **Barthes Myth** — The underlying belief the creator normalizes (e.g., "You can challenge authority and be successful")
- **Audience Relationship Type** — How audience perceives creator (Friend, Mentor, Authority)
- **Parasocial Bond Strength** — Intensity of perceived personal connection (1.0–5.0 scale)

### Sociological Frameworks (AI-Extracted)
- **Cultural Capital** — Bourdieu's concept of cultural authority (Produce = creates culture, Relay = interprets culture)
- **Goffman Stage Consistency** — Alignment between public persona and private self (Consistent, Minor Gap, Significant Gap)
- **Stuart Hall Decoding** — How audience interprets creator's messages (Dominant, Negotiated, Oppositional)
- **Drift Signal** — Trajectory of identity change (Zero Change, Minor Drift, Significant Drift, Full Pivot)

### Niche & Cultural Position
- **Niche Topic Node** — Specific cultural niche (e.g., "stand-up comedy in North America")
- **Underground Density** — Boolean: Is creator part of underground/emerging culture?
- **Mainstream Bleed** — Boolean: Has creator crossed into mainstream?
- **Remix Rate** — Boolean: Does creator participate in remix/duet culture?
- **Brand Saturation** — Boolean: Is creator already heavily sponsored?
- **Rogers Adopter Stage** — Position in innovation adoption curve (Innovators, Early Adopters, Early Majority, Late Majority, Laggards)
- **Creator Niche Position** — Relative position in niche (Ahead, Consistent, Behind)
- **Lifecycle Phase** — Career stage (Emergence, Growth, Maturity, Decline)
- **Turner Liminal Phase** — Anthropological transition state (Pre-Liminal, Liminal, Post-Liminal Reintegration)

### Engagement & Performance Metrics
- **Follower Count** — Total followers
- **Total Likes** — Cumulative likes across all videos
- **Video Count** — Total videos posted
- **Total Views** — Cumulative views across all videos
- **Average Views** — Average views per video
- **Engagement Rate** — Percentage (likes + comments) / followers
- **Average Video Duration** — Mean length of videos (in seconds)

### Content Intelligence
- **Raw Keywords** — All extracted keywords and hashtags from videos
- **Content Theme Labels** — 3–5 named themes (LLM-translated from keywords)
- **Top Hashtags** — Most-used hashtags
- **Recent Video Titles** — Sampled titles from latest videos
- **Transcript Count** — Number of videos with transcripts analyzed
- **Transcript Excerpts** — Full transcript text from all sampled videos (used for semantic analysis)

### Symbolic Decoding (AI-Processed)
- **Decoded Symbols** — Structured cultural signals extracted from all creator-authored text:
  - **Identity Claims** — How creator describes themselves
  - **Status Signals** — Markers of social position
  - **Community References** — In-group/out-group language
  - **Aspiration Drivers** — What the creator wants audience to believe is possible
  - **Symbolic Summary** — Synthesis of above

### Confidence & Longitudinal Data
- **Cultural Velocity** — Trend direction (Focusing, Drifting, Insufficient Data)
- **Data Confidence Level** — Reliability of extraction (high, medium, low)
- **Longitudinal Sample** — Historical data tracking identity consistency over time
- **Discovered Video Pool** — Full list of confirmed videos (12+ sampled for analysis)

### Raw Data
- **AI Summary** — Natural language summary of creator profile
- **Raw AI Response** — Full JSON response from LLM extraction

---

## BRAND DATA CAPTURED

### Identity & Business
- **Brand Name** — Company/brand name
- **Brand URL** — Website or primary online presence
- **Category** — Business category (e.g., Financial Services, Food & Beverage, Tech)
- **Brand Type** — Specific classification (e.g., "Financial Institution", "QSR", "SaaS")
- **Campaign Type** — Marketing objective (Heritage/Luxury, Trend-First, Long-Term Ambassador, Product Launch, Community/Local, Awareness/Consideration)

### Cultural Profile (AI-Extracted)
- **Archetype** — One of 12 Jungian archetypes (same as creator)
- **Brand Tone** — 2–3 words describing brand voice (e.g., "formal, institutional, aspirational")
- **Emotional Promise** — What audience feels when engaging with brand (e.g., "Financial stability and growth")
- **Visual Language** — Exactly 3 adjectives describing visual identity
- **Audience Tribe** — Description of target audience
- **Cultural Tension** — The paradox the brand navigates (e.g., "Between accessibility and premium positioning")
- **Barthes Myth** — The underlying belief the brand normalizes (e.g., "Financial success is achievable for everyone")

### Brand Classification & Weights
- **Brand Archetype Classification** — Strategic category (Trust, Community, Momentum)
- **Weight Alpha (α)** — Alignment weight (0.5–0.6, depending on brand type)
- **Weight Beta (β)** — Pulse weight (0.2–0.3)
- **Weight Gamma (γ)** — Stability weight (0.15–0.2)

### Audience Perception (from Reviews)
- **Yelp Rating** — Average Yelp rating (if available)
- **Yelp Review Count** — Number of Yelp reviews
- **Yelp Review Excerpts** — Sample review text
- **Google Rating** — Average Google rating
- **Google Review Count** — Number of Google reviews
- **Google Review Excerpts** — Sample review text
- **Overall Rating** — Weighted average of all sources
- **Total Reviews** — Combined review count
- **Combined Review Text** — Full text of all reviews (used for semantic analysis)

### Symbolic Decoding (AI-Processed)
- **Brand Raw Keywords** — 10–30 culturally significant words from website + reviews
- **Brand Theme Labels** — 3–5 named cultural themes (LLM-translated)
- **Brand Symbolic Vocabulary** — 5–15 identity-signalling words
- **Brand Decoded Symbols** — Structured cultural signals:
  - **Identity Claims** — How brand describes itself
  - **Status Signals** — Markers of market position
  - **Community References** — In-group/out-group language
  - **Aspiration Drivers** — What brand wants audience to believe
  - **Audience Language** — How audience talks about brand (from reviews)
  - **Symbolic Summary** — Synthesis of above

### Raw Data
- **AI Summary** — Natural language summary of brand profile
- **Raw AI Response** — Full JSON response from LLM extraction

---

## F.I.T. SCORE CALCULATION

### Sub-Scores (0–10 scale)

#### Alignment (α) — Cultural Identity Fit
**What it measures:** Do creator and brand share symbolic language and cultural values?

**Components:**
- **Archetype Match Score** — Three-tier scoring:
  - Resonant (10): Same archetype or in "Pairs Well With" list
  - Complementary (7): Neither pairs nor clashes (neutral pairing)
  - Clashing (2.5): In "Clashes With" list (fundamentally misaligned)
- **Myth Alignment Score** — Do creator's and brand's underlying beliefs align?
- **Tribe Match Score** — Does creator's audience overlap with brand's target audience?
- **Decoding Modifier** — Adjustment based on Stuart Hall decoding (Dominant/Negotiated/Oppositional)

#### Pulse (β) — Market Relevance & Momentum
**What it measures:** Is creator's niche relevant to brand's market? Is creator gaining or losing momentum?

**Components:**
- **Rogers Base Score** — Creator's position on innovation adoption curve (Innovators score highest)
- **Liminal Adjustment** — Bonus for creators in transition/emerging phases
- **PARR Score** — Predicted Audience Receptivity Rate (0–100%) — percentage of creator's audience likely to engage with brand

#### Stability (γ) — Identity Consistency & Partnership Longevity
**What it measures:** Will creator's identity remain stable enough to sustain partnership?

**Components:**
- **Goffman Score** — Consistency between public persona and private self
- **Drift Score** — Penalty if creator is rapidly changing identity
- **Cultural Velocity** — Trend direction (Focusing = stable, Drifting = risky)

### Final F.I.T. Score
```
F.I.T. Score = (Alignment × α) + (Pulse × β) + (Stability × γ)
```

**Example weights for Financial Services (Trust category):**
- α = 0.6 (Alignment heavily weighted)
- β = 0.2 (Pulse secondary)
- γ = 0.2 (Stability secondary)

### Status Classification
- **Green Light (8.0–10.0):** Excellent cultural fit, proceed confidently
- **Proceed with Caution (4.0–7.9):** Viable partnership, but requires careful strategy
- **Do Not Proceed (0–3.9):** Fundamental misalignment, high risk of audience confusion

**Special Rule:** If Alignment < 6.0, status is capped at "Proceed with Caution" regardless of final score.

---

## MATCH RECORD OUTPUT

### Scores & Status
- **Alignment Score (Raw)** — 0–10
- **Pulse Score (Raw)** — 0–10
- **Stability Score (Raw)** — 0–10
- **F.I.T. Score** — 0–10 (final composite)
- **F.I.T. Status** — Green Light / Proceed with Caution / Do Not Proceed

### Audience Metrics
- **PARR (Predicted Audience Receptivity Rate)** — 0–100% (what % of creator's audience will engage with brand)
- **QoV (Quality of View)** — Percentage (F.I.T. Score / 10) × (PARR / 100) — cultural resonance multiplier per impression
- **Symbolic Overlap Score** — 0–10 (how much symbolic vocabulary creator and brand share)
- **Shared Keywords** — List of overlapping keywords/themes
- **Shared Themes** — List of overlapping cultural themes

### Radar Warnings (Structural Flags)
Triggered when specific conditions are met:
- **Archetype Tension** — Creator archetype in brand's "Clashes With" list
- **Coherence Gap** — Large mismatch between creator's public persona and private identity
- **Trajectory Divergence** — Creator is drifting away from brand's values
- **Audience Decoding Split** — Audience interprets creator's message differently than brand expects
- **Symbolic Vocabulary Mismatch** — Creator and brand share <20% symbolic vocabulary

### Narrative & Recommendations
- **Alignment Narrative** — 2-sentence summary of cultural fit
- **Cultural Velocity** — Is creator's identity Focusing, Drifting, or Insufficient Data?
- **Data Confidence Level** — Reliability of analysis (high, medium, low)
- **Synergy Narrative** — Detailed explanation of partnership potential
- **Content Directions** — 3–5 specific content angle recommendations with rationale

---

## THEORETICAL FRAMEWORKS USED

### Jungian Archetypes (12 Types)
The Hero, Sage, Everyman, Lover, Creator, Jester, Magician, Innocent, Explorer, Outlaw, Caregiver, Ruler — used to classify both creator and brand cultural identity.

### Bourdieu's Symbolic Capital
- **Cultural Capital** — Authority to create vs. relay culture
- **Symbolic Vocabulary** — The words/symbols a creator or brand uses to signal identity

### Stuart Hall's Media Decoding Theory
- **Dominant Decoding** — Audience accepts creator's message as intended
- **Negotiated Decoding** — Audience accepts message with reservations
- **Oppositional Decoding** — Audience rejects or inverts creator's message

### Goffman's Dramaturgical Analysis
- **Stage Consistency** — Alignment between public performance and private self

### Rogers' Innovation Adoption Curve
- **Adopter Stages** — Innovators → Early Adopters → Early Majority → Late Majority → Laggards

### Turner's Liminality
- **Liminal Phase** — Anthropological concept of in-between/transition states in cultural identity

---

## DATA SOURCES

### Creator Data Sources (Priority Order)
1. **Video Transcripts** — Full transcript text from 12+ sampled videos (primary evidence)
2. **Engagement Signals** — Computed from platform APIs (comment rate, save rate, remix rate)
3. **Temporal Analysis** — Video posting patterns, growth trends
4. **Video Titles & Captions** — Explicit content messaging
5. **Hashtags** — Keyword indicators
6. **Bio** — Self-description

### Brand Data Sources
1. **Website Copy** — Brand self-presentation
2. **Customer Reviews** — Google Maps, Yelp (audience perception)
3. **Brand Messaging** — Marketing materials, social media

---

## SUMMARY FOR STAKEHOLDERS

**What We Capture:**
- Creator cultural identity (archetype, tone, values, trajectory)
- Brand cultural identity (archetype, tone, values, positioning)
- Audience perception of both (from reviews and engagement metrics)
- Symbolic vocabulary overlap (shared keywords, themes, cultural signals)

**What We Calculate:**
- Three sub-scores (Alignment, Pulse, Stability) based on sociological frameworks
- A composite F.I.T. Score (0–10) with status classification
- Predicted audience receptivity (PARR) and cultural resonance (QoV)
- Structural risk flags (Radar Warnings)
- Narrative recommendations for partnership strategy

**Why It Matters:**
Traditional influencer marketing uses topical alignment ("fitness creator + fitness brand"). Connex uses **cultural alignment** — measuring whether a creator's identity and audience will authentically resonate with a brand's cultural positioning. This reduces campaign risk and improves audience trust.
