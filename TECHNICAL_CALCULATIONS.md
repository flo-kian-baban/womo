# Connex Cultural Match Platform — Technical Calculation Reference

This document provides the exact formulas, weights, thresholds, and implementation logic for every score and index in the platform. Use this as the source of truth when reviewing calculations or debugging scoring logic.

---

## 1. Cultural Match Score (Composite)

**Formula:**
```
CMS = ((Alignment × α) + (Pulse × β) + (Stability × γ)) / 10
```

**Inputs:**
- `Alignment` (0–100): Archetype compatibility and cultural resonance
- `Pulse` (0–100): Cultural momentum and lifecycle positioning
- `Stability` (0–100): Identity consistency and drift signal
- `α`, `β`, `γ`: Brand-specific weights (sum to 1.0, each ≥ 0.1)

**Output Range:** 0–10

**Thresholds:**
- ≥ 8.0: Exceptional fit (go signal)
- 6.0–7.9: Strong fit (proceed with caution)
- 4.0–5.9: Moderate fit (high risk)
- < 4.0: Poor fit (no-go signal)

**Status Mapping:**
- Exceptional (≥ 8.0): "Exceptional Fit"
- Strong (6.0–7.9): "Strong Fit"
- Moderate (4.0–5.9): "Moderate Fit"
- Poor (< 4.0): "Poor Fit"

---

## 2. Alignment Score (α)

**Formula:**
```
Alignment = (Archetype Match × 0.4) + (Myth Alignment × 0.35) + (Decoding × 0.25)
```

**Sub-components:**

### 2.1 Archetype Match (0–100)
**Scoring:**
- **Resonant** (same archetype OR in "Pairs Well With" list): 100
- **Complementary** (neither pairs nor clashes): 70
- **Clashing** (in "Clashes With" list): 25

**Archetype Compatibility Matrix:**
See `ARCHETYPE_COMPATIBILITY` in `fitEngine.ts` for the complete 12×12 matrix.

Example:
- The Sage pairs well with: The Sage, The Creator, The Explorer
- The Sage clashes with: The Jester, The Outlaw, The Everyman

### 2.2 Myth Alignment (0–100)
**Scoring:**
- **Strong match** (creator's core myths align with brand's positioning): 100
- **Partial match** (some overlap, some divergence): 60
- **Weak match** (minimal shared mythology): 20

**Data Source:** LLM extraction from creator transcripts and brand positioning statements.

### 2.3 Stuart Hall Decoding (0–100)
**Scoring:**
- **Dominant decoding** (audience accepts brand message as intended): 100
- **Negotiated decoding** (audience interprets with some resistance): 65
- **Oppositional decoding** (audience rejects or inverts brand message): 20

**Data Source:** Audience sentiment analysis from comments, engagement patterns, and LLM classification.

---

## 3. Pulse Score (β)

**Formula:**
```
Pulse = (Rogers Adopter Stage × 0.6) + (Liminal Phase Adjustment × 0.4)
```

**Sub-components:**

### 3.1 Rogers Adopter Stage (0–100)
**Scoring:**
- **Innovator** (0–5% adoption): 80 (leading edge, high risk)
- **Early Adopter** (5–15% adoption): 95 (peak influence)
- **Early Majority** (15–50% adoption): 100 (mainstream, stable)
- **Late Majority** (50–85% adoption): 70 (declining relevance)
- **Laggard** (85%+ adoption): 40 (outdated, low relevance)

**Data Source:** Creator's niche positioning, content velocity, audience growth trajectory.

### 3.2 Liminal Phase Adjustment (0–100)
**Scoring:**
- **Ascending** (moving toward mainstream): +20 bonus
- **Peak** (at cultural inflection point): +10 bonus
- **Stable** (holding position): 0 adjustment
- **Descending** (moving away from mainstream): -20 penalty
- **Declining** (losing relevance): -40 penalty

**Data Source:** Keyword drift signal, follower growth rate, engagement trend.

---

## 4. Stability Score (γ)

**Formula:**
```
Stability = (Goffman Consistency × 0.5) + (Drift Signal × 0.5)
```

**Sub-components:**

### 4.1 Goffman Stage Consistency (0–100)
**Scoring:**
- **Consistent** (creator maintains same stage across 6+ months): 100
- **Minor Gap** (1–2 stage shifts, recovers): 80
- **Significant Gap** (3+ stage shifts or persistent drift): 50
- **Full Pivot** (complete identity change): 20

**Goffman Stages:**
1. Impression Management (controlled persona)
2. Front Stage (public performance)
3. Back Stage (authentic self)
4. Liminal (transitional, experimental)

**Data Source:** Transcript analysis, content theme tracking, audience perception shifts.

### 4.2 Drift Signal (0–100)
**Scoring:**
- **Zero Change** (keyword vocabulary stable ±5%): 100
- **Minor Drift** (keyword shift 5–15%): 80
- **Moderate Drift** (keyword shift 15–30%): 50
- **Significant Drift** (keyword shift 30–50%): 20
- **Major Drift** (keyword shift >50%): 5

**Data Source:** Cosine similarity of creator's keyword vocabulary across rolling 90-day windows.

---

## 5. Verified F.I.T. Impressions Score

**Formula:**
```
VFIS = (PARR × 0.6) + (QoV × 0.4)
```

**Range:** 0–100

**Inputs:**
- `PARR` (Predicted Audience Receptivity Rate): 0–100
- `QoV` (Quality of View): 0–100

---

## 6. PARR (Predicted Audience Receptivity Rate)

**Formula:**
```
PARR = (Engagement Rate × 0.4) + (Audience Sentiment × 0.3) + (Decoding Match × 0.3)
```

**Sub-components:**

### 6.1 Engagement Rate (0–100)
**Calculation:**
```
EngagementRate = (Likes + Comments + Shares) / Total Views × 100
```

**Normalization:**
- Median TikTok engagement: ~3–5%
- Scoring: (Creator Rate / Median) × 50, capped at 100

**Data Source:** Per-video metrics from TikTok video search results.

### 6.2 Audience Sentiment (0–100)
**Scoring:**
- **Positive** (>70% positive comments): 100
- **Mixed** (40–70% positive): 60
- **Negative** (<40% positive): 20

**Data Source:** LLM sentiment analysis of comment threads.

### 6.3 Decoding Match (0–100)
**Scoring:**
- **Dominant** (audience accepts creator's framing): 100
- **Negotiated** (audience interprets with nuance): 65
- **Oppositional** (audience rejects creator's framing): 20

---

## 7. QoV (Quality of View)

**Formula:**
```
QoV = (Audience Tribe Alignment × 0.4) + (Brand Category Affinity × 0.3) + (Hashtag Overlap × 0.3)
```

**Sub-components:**

### 7.1 Audience Tribe Alignment (0–100)
**Scoring:**
- **Strong match** (creator's audience demographic matches brand target): 100
- **Partial match** (50–75% overlap): 70
- **Weak match** (<50% overlap): 30

**Data Source:** Audience demographics from creator profile, brand target audience definition.

### 7.2 Brand Category Affinity (0–100)
**Scoring:**
- **High affinity** (creator frequently posts in brand category): 100
- **Medium affinity** (occasional posts in category): 60
- **Low affinity** (rare or no posts in category): 20

**Data Source:** Hashtag frequency analysis, video title keyword matching.

### 7.3 Hashtag Overlap (0–100)
**Calculation:**
```
Overlap = (Shared Hashtags / Total Unique Hashtags) × 100
```

**Data Source:** Creator's top 50 hashtags vs. brand's campaign hashtag list.

---

## 8. Performance Signals

### 8.1 Identity Fit (Creator Authenticity)

**Formula:**
```
Identity Fit = (Creator Goffman × 0.4) + (Brand Goffman × 0.3) + (Mention Sentiment × 0.3)
```

**Scoring:**
- Goffman Consistent: +20 pts
- Goffman Minor Gap: +15 pts
- Goffman Significant Gap: +5 pts
- Goffman Full Pivot: 0 pts

- Mention Sentiment Positive: +15 pts
- Mention Sentiment Mixed: 0 pts
- Mention Sentiment Negative: -15 pts

**Range:** 0–100

### 8.2 Performance Fit

**Formula:**
```
Performance Fit = (Engagement Rate × 0.35) + (Lifecycle Phase × 0.35) + (Brand Engagement × 0.3)
```

**Scoring:**
- Engagement Rate: 0–35 pts (normalized to 0–100 range)
- Lifecycle Growth: +15 pts
- Lifecycle Stable: +5 pts
- Lifecycle Decline: -5 pts
- Brand TikTok Rate: 0–15 pts (if available)
- Brand Star Rating: 0–15 pts (if available)

**Range:** 0–100

### 8.3 Audience Fit

**Formula:**
```
Audience Fit = (PARR × 0.5) + (Hashtag Overlap × 0.5)
```

**Range:** 0–100

### 8.4 Receptivity Fit

**Formula:**
```
Receptivity Fit = PARR
```

**Range:** 0–100

### 8.5 Brand Safety Fit

**Formula:**
```
Brand Safety Fit = (Creator Goffman × 0.25) + (Drift Signal × 0.25) + (Mention Sentiment × 0.25) + (Brand Rating × 0.25)
```

**Scoring:**
- Creator Consistent: +20 pts
- Creator Minor Gap: +15 pts
- Creator Significant Gap: +5 pts
- Creator Full Pivot: 0 pts

- Drift Zero Change: +20 pts
- Drift Minor: +15 pts
- Drift Moderate: +5 pts
- Drift Significant: 0 pts

- Mention Sentiment Positive: +20 pts
- Mention Sentiment Mixed: +10 pts
- Mention Sentiment Negative: 0 pts

- Brand Rating ≥ 4.0: +20 pts
- Brand Rating 3.0–3.9: +15 pts
- Brand Rating < 3.0: +5 pts
- Brand Rating None: +10 pts (neutral)

**Range:** 0–100

---

## 9. Brand Weight Selection Rules

**Rule 1: Archetype-Driven Weights**
- **Trust brands:** α ≥ 0.5, β ≤ 0.2, γ ≥ 0.3
- **Community brands:** α = 0.4–0.5, β = 0.2–0.3, γ = 0.3
- **Momentum brands:** α ≤ 0.4, β ≥ 0.4, γ ≤ 0.2

**Rule 2: Weight Sum**
All weights must sum to exactly 1.0.

**Rule 3: Minimum Weight**
No weight below 0.1 (prevents any dimension from being ignored).

**Rule 4: Category Mapping**
Brand category determines primary archetype, which determines weight ranges.

---

## 10. Radar Warnings

### 10.1 Coherence Gap
**Trigger:** Alignment < 4.0 AND Stability > 7.0
**Meaning:** Creator is stable but fundamentally misaligned with brand.
**Action:** Reconsider partnership or adjust creative brief.

### 10.2 Trajectory Divergence
**Trigger:** Pulse < 4.0 AND Stability > 7.0
**Meaning:** Creator is stable but losing cultural relevance.
**Action:** Monitor engagement trends; may not amplify brand message.

### 10.3 Identity Instability
**Trigger:** Stability < 4.0
**Meaning:** Creator's identity is drifting or shifting rapidly.
**Action:** High reputational risk; requires close monitoring.

### 10.4 Archetype Tension
**Trigger:** Archetype Match = 25 (clashing archetypes)
**Meaning:** Creator and brand have fundamentally opposing cultural identities.
**Action:** Partnership will feel inauthentic to audiences.

---

## 11. Data Confidence Tiers

**Verified:**
- Data sourced from direct API calls or official platform data
- High confidence, no estimation required

**Estimated:**
- Data derived from LLM analysis, sentiment classification, or statistical inference
- Medium confidence, subject to model accuracy

**Insufficient Data:**
- Not enough video/comment data to calculate reliably
- Low confidence; recommend collecting more data

---

## 12. Implementation Notes

- All scores are rounded to 2 decimal places for display
- Weights are stored as decimals (0.0–1.0) in the database
- Archetype matching uses exact string comparison (case-sensitive)
- Drift signal uses cosine similarity of keyword vectors (threshold: 0.85)
- PARR and QoV are recalculated on every match calculation (not cached)
- Radar warnings are evaluated after all scores are computed
