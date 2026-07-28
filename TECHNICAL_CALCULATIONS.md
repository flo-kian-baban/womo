# Connex Cultural Match Platform — Technical Calculation Reference

**Every formula below is transcribed from the code, with the defining function
cited.** The sources of truth are `server/fitEngine.ts` and
`server/performanceSignals.ts` — if this document disagrees with them, the
document is wrong. It replaces an earlier version (M2, 2026-07-28) whose
formulas — tier values of 80/95/100, weightings of 0.4/0.35/0.25, thresholds
of ≥8.0 — existed nowhere in the engine.

Scores the engine computes are **heuristic point systems and tier lookups**,
not statistical measurements. Treat levels as meaningful, decimals as noise.

---

## 1. Cultural Match Score (CMS)

Source: `fitEngine.ts` — `calculateFITScore`, recomputed with modifiers in
`runFullFITCalculation`.

```
CMS = Alignment×α + Pulse×β + Stability×γ        (each sub-score 0–10)
```

- Weights come from `BRAND_WEIGHT_TABLE[brandType]`, sum to 1.0.
  **Known defect (J-3):** the table lookup at scoring time ignores
  `campaignType`, while the weights persisted on the brand profile include the
  campaign modifier — the two can disagree (±0.1 on β/γ).
- **Status thresholds:** ≥ 7.5 Green Light · ≥ 6.0 Proceed with Caution ·
  < 6.0 Do Not Proceed. A Green Light is **capped to Caution when
  Alignment < 6.0**.
- The displayed CMS includes the audience-mention modifiers (§5).

## 2. Alignment (α)

Source: `fitEngine.ts` — `calculateAlignmentScore`, `DECODING_MODIFIERS`,
`getArchetypeMatchScore`, `blendDecodingSignals`; vocab boost in
`runFullFITCalculation`.

```
Alignment = mean(Archetype, Myth, Tribe) + decoding modifier   (clamped 0–10)
            … then + audience-vocab boost (up to +1.5)
```

- **Archetype** (12×12 matrix): Resonant (same or "pairs well") **10** ·
  Complementary **7** · Clashing **2.5**. Unknown brand archetype → 7.
- **Myth** and **Tribe**: one LLM call judges both from the two `barthesMyth`
  sentences (0–10 each). When either sentence is missing or the call fails,
  **both fall back to 3.0** and the match is flagged degraded
  (`score_degraded`, womo_0012).
- **Decoding modifier**: Dominant **+0.5** · Negotiated **0** · Oppositional
  **−1.0**. When the brand carries its own Stuart Hall reading, creator and
  brand decoding are blended first: both Dominant → Dominant; any
  Oppositional → Oppositional; otherwise Negotiated.
- **Vocab boost**: overlap ratio of brand-mention hashtags/keywords against
  creator keywords+themes, ×5, capped **+1.5**.

## 3. Pulse (β)

Source: `fitEngine.ts` — `calculatePulseScore`, `ROGERS_BASE_SCORES`,
`LIMINAL_ADJUSTMENTS`; blend in `runFullFITCalculation`.

```
Pulse = Rogers base + liminal adjustment       (clamped 0–10)
```

- **Rogers base**: Innovators **5** · Early Adopters **6** · Early Majority
  **7** · Late Majority **4** · Laggards **2** (unknown → 5).
- **Liminal**: Pre-Liminal **0** · Liminal **+0.5** · Post-Liminal
  Reintegration **+0.5**.
- **TikTok boost** — only when brand engagement rate AND post frequency are
  both known: rate÷10 capped +1.5, plus +0.5 (daily) / +0.3 (3–5×/week).
  Post frequency has never been recorded on the current corpus, so this boost
  has never fired.
- When the brand has its own Rogers + Turner: `Pulse = 60% creator + 40%
  brand`.
- Music signals, remix rates, and follower growth play **no part** in Pulse.

## 4. Stability (γ)

Source: `fitEngine.ts` — `calculateStabilityScore`, `GOFFMAN_SCORES`,
`DRIFT_SCORES`; blend + sentiment modifier in `runFullFITCalculation`.

```
Stability = (Goffman + Drift) ÷ 2              (clamped 0–10)
```

- **Goffman**: Consistent **10** · Minor Gap **5** · Significant Gap **0**
  (unknown → 5).
- **Drift**: Zero Change **9.5** · Minor Drift **7** · Significant Drift
  **3** · Full Pivot **0** (unknown → 5).
- **TikTok boost** when brand followers known: log₁₀(followers)÷6 capped
  +1.5, plus engagement÷20 capped +0.5.
- When the brand has its own Goffman + Drift: blended **50/50**.
- Then the **mention-sentiment modifier** (§5) applies to Stability.

## 5. Audience-mention modifiers

Source: `fitEngine.ts` — `runFullFITCalculation` (Phase 6 block).

- **Sentiment → Stability**: negative **−3** · mixed **−1** · positive
  **+0.5**, scaled by confidence (high ×1.0 · medium ×0.6 · low ×0.3).
- **Vocabulary → Alignment**: up to **+1.5** (§2).
- CMS is recomputed after both. The pre-modifier CMS is used by QoV (§8).

## 6. Radar warnings

Source: `fitEngine.ts` — `evaluateRadarWarnings`. Exactly seven types:

| Warning | Fires when |
|---|---|
| Low Alignment | adjusted Alignment < 6.0 |
| Archetype Tension | creator archetype in the brand's clashes list |
| Identity Instability | drift = Full Pivot OR Goffman = Significant Gap |
| Low Pulse | Pulse < 4.0 |
| Trajectory Divergence | creator niche position = Behind |
| Low Social Engagement | brand TikTok engagement < 0.5% |
| Negative Audience Sentiment | mention sentiment negative at non-low confidence |

Computation failures are **not** warnings — they are recorded in
`match_scores.score_degraded` / `degradation_reasons` (womo_0012). A warning
states something about the match; degradation states something about the
calculation.

## 7. Symbolic vocabulary overlap & PARR

Source: `fitEngine.ts` — `calculateSymbolicVocabularyOverlap`,
`calculatePARR`.

```
Overlap = Jaccard(creator keywords+themes, brand keywords+themes) × 33.3, capped 10
PARR    = (Tribe×0.30 + Decoding×0.25 + Archetype×0.20 + Overlap×0.15 + Persona×0.10) × 10
```

- Decoding signal: Dominant **10** · Negotiated **5** · Oppositional **0**.
- Persona (Goffman): Consistent **10** · Minor Gap **5** · Significant Gap **1**.
- Labels: ≥80 High Cultural Legitimacy · ≥60 Moderate · ≥40 Mixed Signal ·
  <40 Low Legitimacy.
- PARR is a weighted structural index, **not a measured share of the
  audience**, and is built from the creator's own decoding/Goffman — not the
  bilateral blend Alignment uses. Engagement rates and comment sentiment are
  **not** inputs.

## 8. QoV — Quality of View

Source: `fitEngine.ts` — the `qovScore` line in `runFullFITCalculation`.

```
QoV = (CMS ÷ 10) × (PARR ÷ 100) × 100
```

**Recorded engine behavior:** QoV uses the **pre-modifier** CMS, so when
mention modifiers are non-zero, QoV ≠ displayed CMS × PARR. It contains no
information beyond CMS and PARR and measures no conversion.

## 9. The five performance signals

Source: `server/performanceSignals.ts`. All are additive point heuristics
clamped 0–100; missing inputs contribute nothing. Confidence tiers mark input
completeness (each function's own rule), not statistical verification.

- **Identity Fit** (`calculateCreativeIntegritySignal`): baseline 20 +
  creator Goffman (10/5/0)×2 + cultural capital (Produce +10 · Relay +5) +
  tone register present +10 + brand sentiment with ≥5 mentions (positive +15
  · mixed +5 · negative −15; else +3) + brand Goffman (10/5/0) − 20 for a
  Produce creator × "prescriptive" brand tone.
- **Performance Fit** (`calculatePerformanceConsistencySignal`): no floor.
  Creator engagement ≥6% +20 / ≥3% +15 / ≥1% +10 / <1% +5; lifecycle
  Growth|Maturity +15 / Emergence +10 / Decline −10; saturation −10; brand
  archetype +10; brand Goffman 0–10; brand drift 10/7/3/0; brand TikTok ≥3%
  +10 / ≥1% +5; rating ≥4.0 +10 / ≥3.0 +5.
- **Audience Fit** (`calculateCommunityQualitySignal`): PARR as base (50 if
  absent) + decoding (Dominant +15 · Negotiated +5 · Oppositional −15) +
  region present +5 + audience-relationship present +5 + hashtag/keyword
  overlap (>0.3 +10 · >0.1 +5). Largely PARR re-used — not independent.
- **Receptivity Fit** (`calculateAudienceReceptivitySignal`): PARR×0.6 (50
  base if absent) + QoV×0.2 + decoding (Dominant +10 · Oppositional −10) +
  **+10 when both myth sentences contain the literal word "success"**.
  Overlaps heavily with PARR/QoV by construction.
- **Brand Safety Fit** (`calculateBrandTrustSignal`): baseline 20 + creator
  Goffman (+15/+8/−10) + drift (+10/+7/+3/−15) − saturation 10 + brand
  sentiment ≥5 mentions (+20/+10/−10) + rating (≥4.5 +15 · ≥4.0 +10 · ≥3.5
  +5 · <3.0 −5) + archetype +5 + brand Goffman 0–10 + data confidence (high
  +5 · low −5).

## 10. The three "Cultural" signals

These are **not computed signals**: the pages display the CMS sub-scores ×10
(Cultural Identity = Alignment×10, Cultural Momentum = Pulse×10, Partnership
Stability = Stability×10), stamped **Derived**. They move exactly when their
sub-score moves and are not independent evidence.

## 11. Brand weights

Source: `fitEngine.ts` — `BRAND_WEIGHT_TABLE`, `applyBrandCampaignModifier`,
`getBrandWeights`.

- 100+ brand-type rows; α/β/γ sum to 1.0, minimum 0.1 each.
- Campaign modifiers: Long-Term Ambassador (β −0.1, γ +0.1) · Product Launch
  (β +0.1, γ −0.1), re-normalised.
- **The modifier is applied at brand-profile persist time but NOT at match
  scoring time** — this is defect J-3 (§1).

## 12. Known defects (Jason's queue — documented, not fixed)

- **J-1**: the rule-based `alignmentNarrative` compares the 0–10 archetype
  score against ≥80/≥60 (`fitEngine.ts`, `runFullFITCalculation`) — every
  narrative opens "weak archetype alignment", even for a resonant pair.
- **J-3**: the weights contradiction (§1, §11).
