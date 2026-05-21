/**
 * Connex F.I.T. Score Engine
 * Implements the exact scoring logic from the Excel workbook.
 * All formulas, weights, and archetype compatibility data are sourced directly
 * from the "Brand Weighting" and "Scoring And FIT Verdict" sheets.
 */

// ─── Archetype Compatibility Matrix ──────────────────────────────────────────
// Source: Field Notes sheet, rows 36–48

export const ARCHETYPES = [
  "The Sage",
  "The Hero",
  "The Outlaw",
  "The Explorer",
  "The Magician",
  "The Ruler",
  "The Caregiver",
  "The Lover",
  "The Jester",
  "The Innocent",
  "The Everyman",
  "The Creator",
] as const;

export type Archetype = (typeof ARCHETYPES)[number];

export const ARCHETYPE_COMPATIBILITY: Record<
  Archetype,
  { pairsWith: Archetype[]; clashesWith: Archetype[] }
> = {
  "The Sage": {
    pairsWith: ["The Sage", "The Creator", "The Explorer"],
    clashesWith: ["The Jester", "The Outlaw", "The Everyman"],
  },
  "The Hero": {
    pairsWith: ["The Hero", "The Explorer", "The Outlaw"],
    clashesWith: ["The Caregiver", "The Innocent", "The Lover"],
  },
  "The Outlaw": {
    pairsWith: ["The Outlaw", "The Hero", "The Explorer"],
    clashesWith: ["The Ruler", "The Caregiver", "The Innocent"],
  },
  "The Explorer": {
    pairsWith: ["The Explorer", "The Outlaw", "The Hero"],
    clashesWith: ["The Ruler", "The Caregiver", "The Innocent"],
  },
  "The Magician": {
    pairsWith: ["The Magician", "The Creator", "The Lover"],
    clashesWith: ["The Outlaw", "The Everyman", "The Jester"],
  },
  "The Ruler": {
    pairsWith: ["The Ruler", "The Sage", "The Lover"],
    clashesWith: ["The Everyman", "The Jester", "The Outlaw"],
  },
  "The Caregiver": {
    pairsWith: ["The Caregiver", "The Innocent", "The Everyman"],
    clashesWith: ["The Outlaw", "The Ruler", "The Hero"],
  },
  "The Lover": {
    pairsWith: ["The Lover", "The Magician", "The Ruler"],
    clashesWith: ["The Jester", "The Outlaw", "The Everyman"],
  },
  "The Jester": {
    pairsWith: ["The Jester", "The Everyman", "The Explorer"],
    clashesWith: ["The Ruler", "The Sage", "The Lover"],
  },
  "The Innocent": {
    pairsWith: ["The Innocent", "The Caregiver", "The Everyman"],
    clashesWith: ["The Outlaw", "The Ruler", "The Jester"],
  },
  "The Everyman": {
    pairsWith: ["The Everyman", "The Caregiver", "The Jester"],
    clashesWith: ["The Ruler", "The Sage", "The Magician"],
  },
  "The Creator": {
    pairsWith: ["The Creator", "The Sage", "The Magician"],
    clashesWith: ["The Everyman", "The Jester", "The Ruler"],
  },
};

/**
 * Returns archetype match score (0–10) based on compatibility.
 * Direct same-archetype: 10
 * In "Pairs Well With": 7
 * Neutral (neither pairs nor clashes): 5
 * In "Clashes With": 1
 */
export function getArchetypeMatchScore(
  brandArchetype: string,
  creatorArchetype: string
): number {
  const brand = brandArchetype as Archetype;
  const creator = creatorArchetype as Archetype;
  if (!ARCHETYPE_COMPATIBILITY[brand]) return 5;
  if (brand === creator) return 10;
  if (ARCHETYPE_COMPATIBILITY[brand].pairsWith.includes(creator)) return 7;
  if (ARCHETYPE_COMPATIBILITY[brand].clashesWith.includes(creator)) return 1;
  return 5;
}

export function archetypeClashes(brandArchetype: string, creatorArchetype: string): boolean {
  const brand = brandArchetype as Archetype;
  const creator = creatorArchetype as Archetype;
  if (!ARCHETYPE_COMPATIBILITY[brand]) return false;
  return ARCHETYPE_COMPATIBILITY[brand].clashesWith.includes(creator);
}

// ─── Brand Archetype Classification ─────────────────────────────────────────
// Source: Chapter 3 — Brand Archetypes, Category Logic & Weight Selection

export type BrandArchetype = "Trust" | "Community" | "Momentum";

export const BRAND_ARCHETYPE_DESCRIPTIONS: Record<BrandArchetype, string> = {
  Trust: "Built on credibility, safety, and reliability. The consumer must believe in the brand before they will act. Alignment is dominant (α=0.5), Stability is elevated (γ=0.3–0.4), Pulse is suppressed (β=0.1–0.2).",
  Community: "Built on belonging, identity, and shared values. The consumer identifies with the brand. Alignment is primary (α=0.4–0.5), Stability is secondary (γ=0.3), Pulse is moderate (β=0.2–0.3).",
  Momentum: "Built on energy, relevance, and cultural presence. The consumer wants what is exciting right now. Pulse is dominant (β=0.4–0.6), Alignment is secondary (α=0.2–0.4), Stability is suppressed (γ=0.2).",
};

// Category → Brand Archetype mapping (from Chapter 3 Category Logic table)
export const CATEGORY_ARCHETYPE_MAP: Record<string, BrandArchetype> = {
  // Trust brands
  "Medical / Health": "Trust",
  "Legal Services": "Trust",
  "Financial Services": "Trust",
  "Insurance": "Trust",
  "Mental Health": "Trust",
  "Children's Products": "Trust",
  "Home Renovation": "Trust",
  // Community brands
  "Local Gym / Studio": "Community",
  "Local Boutique Retail": "Community",
  "Specialty Café": "Community",
  "Wellness / Coaching": "Community",
  "Pet Services": "Community",
  "Youth Sports": "Community",
  "Hair Care": "Community",
  "Home Décor": "Community",
  // Momentum brands
  "Makeup / Color": "Momentum",
  "QSR / Fast Food": "Momentum",
  "Seasonal Campaign": "Momentum",
  "Streetwear / Fashion": "Momentum",
  "Packaged Food / CPG": "Momentum",
  // Hybrid (primary archetype listed)
  "Skincare": "Community",   // Community → Trust
  "Craft Beverage": "Momentum", // Momentum → Community
  "DTC / E-Commerce": "Momentum", // Momentum → Community
  "Fine Dining": "Trust",    // Trust → Community
  "Boutique Hotel": "Community", // Community → Trust
  "Fitness Equipment": "Community", // Community → Momentum
};

// ─── Brand Weight Table ───────────────────────────────────────────────────────
// Source: Chapter 3 — Category Logic + Weight Selection Rules
// Weights follow archetype signature patterns:
//   Trust:     α=0.5, β=0.1–0.2, γ=0.3–0.4
//   Community: α=0.4–0.5, β=0.2–0.3, γ=0.3
//   Momentum:  α=0.2–0.4, β=0.4–0.6, γ=0.2
// All weights sum to 1.0. No weight below 0.1 (Rule 3).

export interface BrandWeights {
  alpha: number;
  beta: number;
  gamma: number;
  priority: string;
  brandArchetype: BrandArchetype;
}

export const BRAND_WEIGHT_TABLE: Record<string, BrandWeights> = {
  // ── TRUST BRANDS ─────────────────────────────────────────────────────────
  // Medical / Health
  "Medical — General Practice / Clinic":        { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + safety",              brandArchetype: "Trust" },
  "Medical — Aesthetics / MedSpa":              { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Aspiration + trust",           brandArchetype: "Trust" },
  "Medical — Chiropractic / PT / Allied Health":{ alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Authority + lifestyle fit",    brandArchetype: "Trust" },
  "Medical — Dental / Orthodontics":            { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + safety",              brandArchetype: "Trust" },
  "Medical — Optometry / Vision Care":          { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + safety",              brandArchetype: "Trust" },
  "Medical — Pharmacy / Health Retail":         { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Trust + accessibility",       brandArchetype: "Trust" },
  "Mental Health — Private Practice / App":     { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + consistency",         brandArchetype: "Trust" },
  "Mental Health — Wellness Platform":          { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Trust + community",           brandArchetype: "Trust" },
  // Legal Services
  "Legal — Personal Injury / Consumer Law":     { alpha: 0.4, beta: 0.2, gamma: 0.4, priority: "Authority + trust",           brandArchetype: "Trust" },
  "Legal — Corporate / Commercial Law":         { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + stability",           brandArchetype: "Trust" },
  "Legal — Family Law":                         { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + safety",              brandArchetype: "Trust" },
  "Legal — Immigration Law":                    { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Trust + community",           brandArchetype: "Trust" },
  "Legal — Criminal Defence":                   { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Authority + trust",           brandArchetype: "Trust" },
  // Financial Services
  "Financial — Personal Finance / Budgeting":   { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Value alignment",             brandArchetype: "Trust" },
  "Financial — Local Accounting / Tax":         { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + stability",           brandArchetype: "Trust" },
  "Financial — Wealth Management / Investment": { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + safety",              brandArchetype: "Trust" },
  "Financial — Mortgage / Lending":             { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Trust + aspiration",          brandArchetype: "Trust" },
  "Financial — Fintech / Banking App":          { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Trust + innovation",          brandArchetype: "Trust" },
  // Insurance
  "Insurance — Local Broker":                   { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + safety",              brandArchetype: "Trust" },
  "Insurance — Life / Health Insurance":        { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + safety",              brandArchetype: "Trust" },
  "Insurance — Auto / Home Insurance":          { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Trust + reliability",         brandArchetype: "Trust" },
  // Home Renovation / Construction
  "Home — Renovation / Contracting":            { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Credibility + safety",        brandArchetype: "Trust" },
  "Home — Architecture / Interior Design Firm": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Aesthetic authority",         brandArchetype: "Trust" },
  // Children's & Family
  "Family — Children's Products":               { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Safety + value alignment",    brandArchetype: "Trust" },
  "Family — Baby / Infant Care":                { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + safety",              brandArchetype: "Trust" },
  "Family — Parenting / Education Platform":    { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Trust + community",           brandArchetype: "Trust" },
  // Education (Trust-leaning)
  "Education — Local Tutoring / School":        { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + stability",           brandArchetype: "Trust" },
  "Education — University / College":           { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Authority + trust",           brandArchetype: "Trust" },
  "Education — Professional Certification":     { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Authority + credibility",     brandArchetype: "Trust" },
  // Real Estate
  "Real Estate — Residential Agent":            { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Community trust",             brandArchetype: "Trust" },
  "Real Estate — Property Developer":           { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Aspiration + authority",      brandArchetype: "Trust" },
  "Real Estate — Commercial / Investment":      { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + stability",           brandArchetype: "Trust" },
  "Real Estate — Property Management":          { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + reliability",         brandArchetype: "Trust" },
  // Automotive (Trust-leaning)
  "Automotive — Dealership / Sales":            { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Trust + aspiration",          brandArchetype: "Trust" },
  "Automotive — Repair / Service":              { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + reliability",         brandArchetype: "Trust" },

  // ── COMMUNITY BRANDS ─────────────────────────────────────────────────────
  // Fitness & Sports
  "Fitness — Local Gym / Studio":               { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Community identity",          brandArchetype: "Community" },
  "Fitness — Equipment / Apparel":              { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Authority + momentum",         brandArchetype: "Community" },
  "Fitness — Online Training / App":            { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Community + authority",        brandArchetype: "Community" },
  "Sports — Youth / Amateur Club":              { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Community values",             brandArchetype: "Community" },
  "Sports — Professional Team / League":        { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Community identity",          brandArchetype: "Community" },
  "Sports — Outdoor / Adventure":               { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Lifestyle alignment",          brandArchetype: "Community" },
  // Retail (Community-leaning)
  "Retail — Local Boutique":                    { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Community identity",          brandArchetype: "Community" },
  "Retail — Specialty / Niche Retail":          { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Community fit",               brandArchetype: "Community" },
  "Retail — Thrift / Vintage":                  { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Cultural identity",           brandArchetype: "Community" },
  // Beauty (Community-leaning)
  "Beauty — Skincare":                          { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Trust + value alignment",      brandArchetype: "Community" },
  "Beauty — Hair Care":                         { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Community authority",          brandArchetype: "Community" },
  "Beauty — Salon / Local Service":             { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Local trust",                 brandArchetype: "Community" },
  "Beauty — Natural / Clean Beauty":            { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Values alignment",            brandArchetype: "Community" },
  "Beauty — Men's Grooming":                    { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Community identity",          brandArchetype: "Community" },
  // Food & Beverage (Community-leaning)
  "F&B — Specialty Coffee / Café":              { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Lifestyle alignment",          brandArchetype: "Community" },
  "F&B — Health Food / Organic":                { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Value alignment",             brandArchetype: "Community" },
  "F&B — Farmers Market / Local Produce":       { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Community + values",          brandArchetype: "Community" },
  "F&B — Specialty / Ethnic Grocery":           { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Cultural identity",           brandArchetype: "Community" },
  // Home & Lifestyle (Community-leaning)
  "Home — Interior Design / Décor":             { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Aesthetic alignment",          brandArchetype: "Community" },
  "Home — Cleaning / Household Products":       { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Relatability + trust",         brandArchetype: "Community" },
  "Home — Smart Home / Technology":             { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Innovation + trust",           brandArchetype: "Community" },
  // Pet
  "Pet — Products / Accessories":               { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Community fit",               brandArchetype: "Community" },
  "Pet — Veterinary / Local Service":           { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + safety",              brandArchetype: "Trust" },
  "Pet — Food / Nutrition":                     { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Trust + community",           brandArchetype: "Community" },
  // Coaching & Wellness
  "Coaching — Business / Life Coach":           { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Value + authority",           brandArchetype: "Community" },
  "Coaching — Nutrition / Dietitian":           { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Authority + community",        brandArchetype: "Community" },
  "Coaching — Relationship / Dating":           { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Trust + identity",            brandArchetype: "Community" },
  // Travel & Hospitality (Community-leaning)
  "Travel — Boutique Hotel / B&B":              { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Aesthetic alignment",          brandArchetype: "Community" },
  "Travel — Local Tourism / Experience":        { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Lifestyle fit",               brandArchetype: "Community" },
  "Travel — Eco / Sustainable Tourism":         { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Values alignment",            brandArchetype: "Community" },
  // Fashion (Community-leaning)
  "Fashion — Heritage / Luxury":                { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Semantic purity",             brandArchetype: "Community" },
  "Fashion — Accessible / Mid-Market":          { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Balanced reach",              brandArchetype: "Community" },
  "Fashion — Sustainable / Ethical":            { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Values alignment",            brandArchetype: "Community" },
  // Education (Community-leaning)
  "Education — Online Course / Creator":        { alpha: 0.5, beta: 0.3, gamma: 0.2, priority: "Authority alignment",          brandArchetype: "Community" },
  // Nonprofit & Cause
  "Nonprofit — Cause Marketing":                { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Values alignment",            brandArchetype: "Community" },
  "Nonprofit — Community Organisation":         { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Community identity",          brandArchetype: "Community" },
  "Government / Public Sector":                 { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + authority",           brandArchetype: "Trust" },
  // Restaurant (Community-leaning)
  "Restaurant — Casual Dining":                 { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Community trust",             brandArchetype: "Community" },
  "Restaurant — Fine Dining / Experiential":    { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Semantic purity",             brandArchetype: "Community" },
  "Restaurant — Ethnic / Cultural":             { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Cultural identity",           brandArchetype: "Community" },
  "Restaurant — Brunch / Café Culture":         { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Lifestyle alignment",          brandArchetype: "Community" },
  "Restaurant — Food Truck / Pop-Up":           { alpha: 0.4, beta: 0.4, gamma: 0.2, priority: "Culture + momentum",           brandArchetype: "Momentum" },

  // ── MOMENTUM BRANDS ──────────────────────────────────────────────────────
  // Beauty (Momentum-leaning)
  "Beauty — Makeup / Color":                    { alpha: 0.3, beta: 0.5, gamma: 0.2, priority: "Trend currency",              brandArchetype: "Momentum" },
  "Beauty — Fragrance / Luxury Beauty":         { alpha: 0.4, beta: 0.4, gamma: 0.2, priority: "Aspiration + momentum",        brandArchetype: "Momentum" },
  "Beauty — Nail / Body Art":                   { alpha: 0.3, beta: 0.5, gamma: 0.2, priority: "Trend currency",              brandArchetype: "Momentum" },
  // Retail (Momentum-leaning)
  "Retail — E-Commerce / DTC Product":          { alpha: 0.3, beta: 0.4, gamma: 0.3, priority: "Conversion + reach",          brandArchetype: "Momentum" },
  "Retail — Seasonal / Holiday Campaign":       { alpha: 0.2, beta: 0.6, gamma: 0.2, priority: "Maximum pulse",               brandArchetype: "Momentum" },
  "Retail — Flash Sale / Discount":             { alpha: 0.2, beta: 0.6, gamma: 0.2, priority: "Maximum pulse",               brandArchetype: "Momentum" },
  // Food & Beverage (Momentum-leaning)
  "F&B — Craft Beverage / Alcohol":             { alpha: 0.4, beta: 0.4, gamma: 0.2, priority: "Culture + momentum",           brandArchetype: "Momentum" },
  "F&B — Packaged Food / CPG":                  { alpha: 0.3, beta: 0.4, gamma: 0.3, priority: "Reach + relevance",           brandArchetype: "Momentum" },
  "F&B — Energy Drink / Supplement":            { alpha: 0.3, beta: 0.5, gamma: 0.2, priority: "Viral momentum",              brandArchetype: "Momentum" },
  "F&B — Food Delivery / Ghost Kitchen":        { alpha: 0.3, beta: 0.5, gamma: 0.2, priority: "Reach + relevance",           brandArchetype: "Momentum" },
  "F&B — Snack / Confectionery":                { alpha: 0.3, beta: 0.5, gamma: 0.2, priority: "Trend currency",              brandArchetype: "Momentum" },
  // Restaurant (Momentum-leaning)
  "Restaurant — QSR / Fast Food":               { alpha: 0.3, beta: 0.5, gamma: 0.2, priority: "Viral momentum",              brandArchetype: "Momentum" },
  "Restaurant — QSR / Limited-Time Activation": { alpha: 0.2, beta: 0.6, gamma: 0.2, priority: "Maximum pulse",               brandArchetype: "Momentum" },
  // Fashion (Momentum-leaning)
  "Fashion — Trend-First / Streetwear":         { alpha: 0.3, beta: 0.5, gamma: 0.2, priority: "Cultural momentum",           brandArchetype: "Momentum" },
  "Fashion — Fast Fashion":                     { alpha: 0.2, beta: 0.6, gamma: 0.2, priority: "Maximum pulse",               brandArchetype: "Momentum" },
  "Fashion — Activewear / Athleisure":          { alpha: 0.4, beta: 0.4, gamma: 0.2, priority: "Culture + momentum",           brandArchetype: "Momentum" },
  // Tech & Gaming
  "Tech — SaaS / App":                          { alpha: 0.4, beta: 0.4, gamma: 0.2, priority: "Innovation + reach",           brandArchetype: "Momentum" },
  "Tech — Consumer Electronics":                { alpha: 0.3, beta: 0.5, gamma: 0.2, priority: "Trend currency",              brandArchetype: "Momentum" },
  "Tech — Gaming / Esports":                    { alpha: 0.3, beta: 0.5, gamma: 0.2, priority: "Cultural momentum",           brandArchetype: "Momentum" },
  "Tech — Creator Tools / Platform":            { alpha: 0.4, beta: 0.4, gamma: 0.2, priority: "Community + innovation",       brandArchetype: "Momentum" },
  // Entertainment & Media
  "Entertainment — Streaming / OTT":            { alpha: 0.3, beta: 0.5, gamma: 0.2, priority: "Reach + relevance",           brandArchetype: "Momentum" },
  "Entertainment — Music / Artist":             { alpha: 0.4, beta: 0.4, gamma: 0.2, priority: "Cultural momentum",           brandArchetype: "Momentum" },
  "Entertainment — Event / Festival":           { alpha: 0.3, beta: 0.5, gamma: 0.2, priority: "Viral momentum",              brandArchetype: "Momentum" },
  "Entertainment — Podcast / Media Brand":      { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Community + reach",           brandArchetype: "Momentum" },
  // Travel (Momentum-leaning)
  "Travel — Tour Operator / Activity":          { alpha: 0.3, beta: 0.4, gamma: 0.3, priority: "Reach + excitement",          brandArchetype: "Momentum" },
  "Travel — Airline / Transport":               { alpha: 0.3, beta: 0.5, gamma: 0.2, priority: "Reach + relevance",           brandArchetype: "Momentum" },
  // Campaign Types (modifiers applied on top of brand type weights)
  "Long-Term Ambassador":                       { alpha: 0.4, beta: 0.2, gamma: 0.4, priority: "Identity stability",          brandArchetype: "Community" },
  "Product Launch":                             { alpha: 0.3, beta: 0.4, gamma: 0.3, priority: "Reach + relevance",           brandArchetype: "Momentum" },
};

export const DEFAULT_WEIGHTS: BrandWeights = { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Cultural alignment", brandArchetype: "Community" };

/**
 * Campaign type modifiers (Chapter 3, Rule 5).
 * Long-Term Ambassador: γ +0.1, β -0.1 (stability more critical over 12+ months)
 * Product Launch: β +0.1, γ -0.1 (cultural amplification needed now)
 * Weights are clamped to minimum 0.1 and re-normalised to sum to 1.0.
 */
export function applyBrandCampaignModifier(
  weights: BrandWeights,
  campaignType: string
): BrandWeights {
  let { alpha, beta, gamma } = weights;

  if (campaignType === "Long-Term Ambassador") {
    beta = Math.max(0.1, beta - 0.1);
    gamma = Math.min(0.8, gamma + 0.1);
  } else if (campaignType === "Product Launch") {
    beta = Math.min(0.8, beta + 0.1);
    gamma = Math.max(0.1, gamma - 0.1);
  }

  // Re-normalise to ensure sum = 1.0
  const total = alpha + beta + gamma;
  if (Math.abs(total - 1.0) > 0.001) {
    alpha = Math.round((alpha / total) * 10) / 10;
    beta = Math.round((beta / total) * 10) / 10;
    gamma = Math.round((1.0 - alpha - beta) * 10) / 10;
  }

  return { ...weights, alpha, beta, gamma };
}

export function getBrandWeights(brandType: string, campaignType?: string): BrandWeights {
  const base = BRAND_WEIGHT_TABLE[brandType] ?? DEFAULT_WEIGHTS;
  if (!campaignType || campaignType === "Heritage/Luxury" || campaignType === "Trend-First") {
    return base;
  }
  return applyBrandCampaignModifier(base, campaignType);
}

// ─── Rogers Adoption Curve → Base Score ──────────────────────────────────────

export const ROGERS_BASE_SCORES: Record<string, number> = {
  Innovators: 5,
  "Early Adopters": 6,
  "Early Majority": 7,
  "Late Majority": 4,
  Laggards: 2,
};

// ─── Goffman Stage Test → Score ───────────────────────────────────────────────

export const GOFFMAN_SCORES: Record<string, number> = {
  Consistent: 10,
  "Minor Gap": 5,
  "Significant Gap": 0,
};

// ─── Drift Signal → Score ─────────────────────────────────────────────────────

export const DRIFT_SCORES: Record<string, number> = {
  "Zero Change": 9.5,
  "Minor Drift": 7,
  "Significant Drift": 3,
  "Full Pivot": 0,
};

// ─── Stuart Hall Decoding Modifier ───────────────────────────────────────────

export const DECODING_MODIFIERS: Record<string, number> = {
  Dominant: 0.5,
  Negotiated: 0,
  Oppositional: -1.0,
};

// ─── Liminal Adjustment ───────────────────────────────────────────────────────

export const LIMINAL_ADJUSTMENTS: Record<string, number> = {
  "Pre-Liminal": 0,
  Liminal: 0.5,
  "Post-Liminal Reintegration": 0.5,
};

// ─── Scoring Functions ────────────────────────────────────────────────────────

export interface AlignmentInputs {
  archetypeMatchScore: number;       // 0–10
  mythAlignmentScore: number;        // 0–10 (AI-evaluated)
  tribMatchScore: number;            // 0–10 (AI-evaluated)
  stuartHallDecoding: string;        // Dominant / Negotiated / Oppositional
}

export function calculateAlignmentScore(inputs: AlignmentInputs): {
  raw: number;
  decodingModifier: number;
} {
  const avg = (inputs.archetypeMatchScore + inputs.mythAlignmentScore + inputs.tribMatchScore) / 3;
  const modifier = DECODING_MODIFIERS[inputs.stuartHallDecoding] ?? 0;
  const raw = Math.min(10, avg + modifier);
  return { raw: Math.max(0, raw), decodingModifier: modifier };
}

export interface PulseInputs {
  rogersAdopterStage: string;
  turnerLiminalPhase: string;
}

export function calculatePulseScore(inputs: PulseInputs): {
  raw: number;
  rogersBase: number;
  liminalAdjustment: number;
} {
  const rogersBase = ROGERS_BASE_SCORES[inputs.rogersAdopterStage] ?? 5;
  const liminalAdj = LIMINAL_ADJUSTMENTS[inputs.turnerLiminalPhase] ?? 0;
  const raw = Math.min(10, Math.max(1, rogersBase + liminalAdj));
  return { raw, rogersBase, liminalAdjustment: liminalAdj };
}

export interface StabilityInputs {
  goffmanStageConsistency: string;
  driftSignal: string;
}

export function calculateStabilityScore(inputs: StabilityInputs): {
  raw: number;
  goffmanScore: number;
  driftScore: number;
} {
  const goffmanScore = GOFFMAN_SCORES[inputs.goffmanStageConsistency] ?? 5;
  const driftScore = DRIFT_SCORES[inputs.driftSignal] ?? 5;
  const raw = (goffmanScore + driftScore) / 2;
  return { raw, goffmanScore, driftScore };
}

export interface FITScoreInputs {
  alignmentRaw: number;
  pulseRaw: number;
  stabilityRaw: number;
  weights: BrandWeights;
}

export function calculateFITScore(inputs: FITScoreInputs): {
  fitScore: number;
  fitStatus: "Green Light" | "Proceed with Caution" | "Do Not Proceed";
} {
  const fitScore =
    inputs.alignmentRaw * inputs.weights.alpha +
    inputs.pulseRaw * inputs.weights.beta +
    inputs.stabilityRaw * inputs.weights.gamma;

  const rounded = Math.round(fitScore * 10) / 10;

  let fitStatus: "Green Light" | "Proceed with Caution" | "Do Not Proceed";
  if (rounded >= 7.5) fitStatus = "Green Light";
  else if (rounded >= 6.0) fitStatus = "Proceed with Caution";
  else fitStatus = "Do Not Proceed";

  return { fitScore: rounded, fitStatus };
}

// ─── Radar Warnings ───────────────────────────────────────────────────────────
// Exact names from the specification

export type RadarWarning =
  | "Low Alignment"
  | "Archetype Tension"
  | "Identity Instability"
  | "Low Pulse"
  | "Trajectory Divergence";

export interface RadarWarningInputs {
  alignmentRaw: number;
  pulseRaw: number;
  brandArchetype: string;
  creatorArchetype: string;
  stuartHallDecoding: string;
  driftSignal: string;
  goffmanStageConsistency: string;
  creatorNichePosition: string;
}

export function evaluateRadarWarnings(inputs: RadarWarningInputs): RadarWarning[] {
  const warnings: RadarWarning[] = [];

  // Low Alignment: α < 6.0
  if (inputs.alignmentRaw < 6.0) {
    warnings.push("Low Alignment");
  }

  // Archetype Tension: creator archetype is in brand's "Clashes With" list
  if (archetypeClashes(inputs.brandArchetype, inputs.creatorArchetype)) {
    warnings.push("Archetype Tension");
  }

  // Identity Instability: Full Pivot drift OR Significant Gap Goffman
  if (
    inputs.driftSignal === "Full Pivot" ||
    inputs.goffmanStageConsistency === "Significant Gap"
  ) {
    warnings.push("Identity Instability");
  }

  // Low Pulse: β < 4.0
  if (inputs.pulseRaw < 4.0) {
    warnings.push("Low Pulse");
  }

  // Trajectory Divergence: creator is "Behind" the niche
  if (inputs.creatorNichePosition === "Behind") {
    warnings.push("Trajectory Divergence");
  }

  return warnings;
}

// ─── Symbolic Vocabulary Overlap ────────────────────────────────────────────
/**
 * Compares creator and brand decoded symbol arrays and returns:
 * - overlapScore: 0–10 (how many terms are shared relative to corpus size)
 * - sharedKeywords: the actual overlapping terms (for display in report)
 */
export function calculateSymbolicVocabularyOverlap(input: {
  creatorKeywords: string[];
  creatorThemes: string[];
  brandKeywords: string[];
  brandThemes: string[];
}): { overlapScore: number; sharedKeywords: string[]; sharedThemes: string[] } {
  const normalize = (s: string) => s.toLowerCase().trim();

  const creatorTerms = new Set([
    ...input.creatorKeywords.map(normalize),
    ...input.creatorThemes.map(normalize),
  ]);
  const brandTerms = new Set([
    ...input.brandKeywords.map(normalize),
    ...input.brandThemes.map(normalize),
  ]);

  const sharedKeywords: string[] = [];
  const sharedThemes: string[] = [];

  for (const term of input.creatorKeywords.map(normalize)) {
    if (brandTerms.has(term)) sharedKeywords.push(term);
  }
  for (const term of input.creatorThemes.map(normalize)) {
    if (brandTerms.has(term)) sharedThemes.push(term);
  }

  // Jaccard-style overlap: intersection / union
  const union = new Set(Array.from(creatorTerms).concat(Array.from(brandTerms)));
  const intersection = Array.from(creatorTerms).filter(t => brandTerms.has(t));
  const jaccardRaw = union.size > 0 ? intersection.length / union.size : 0;

  // Scale to 0–10: Jaccard of 0.3+ is excellent for cultural vocabulary
  const overlapScore = Math.min(10, Math.round(jaccardRaw * 33.3 * 10) / 10);

  return { overlapScore, sharedKeywords, sharedThemes };
}

// ─── Verified F.I.T. Impressions Score ───────────────────────────────────────
/**
 * Audience Acceptance Probability Score (0–100).
 * Measures how likely the creator's audience will accept this partnership
 * as culturally legitimate rather than forced or inauthentic.
 *
 * Five signals (each 0–10), weighted:
 *   1. Tribe Overlap (0.30)          — does the audience already live in the brand's world?
 *   2. Stuart Hall Decoding (0.25)   — will the audience decode the brand message as intended?
 *   3. Archetype Resonance (0.20)    — does the creator's archetype carry the brand's identity naturally?
 *   4. Symbolic Vocabulary Overlap (0.15) — shared language between creator and brand decoded symbols
 *   5. Goffman Stage Consistency (0.10)   — is the creator's persona consistent enough to trust?
 */
export interface PARRInputs {
  tribMatchScore: number;           // 0–10 from alignment calculation
  stuartHallDecoding: string;       // Dominant / Negotiated / Oppositional
  archetypeMatchScore: number;      // 0–10 from archetype matrix
  symbolicOverlapScore: number;     // 0–10 from calculateSymbolicVocabularyOverlap
  goffmanStageConsistency: string;  // Consistent / Minor Gap / Significant Gap
}

export type PARRLabel =
  | "High Cultural Legitimacy"
  | "Moderate Legitimacy"
  | "Mixed Signal"
  | "Low Legitimacy";

export function calculatePARR(inputs: PARRInputs): {
  parrScore: number;
  parrLabel: PARRLabel;
  signalBreakdown: Record<string, number>;
} {
  // Stuart Hall → numeric signal (0–10)
  const decodingSignal =
    inputs.stuartHallDecoding === "Dominant" ? 10 :
    inputs.stuartHallDecoding === "Negotiated" ? 5 :
    inputs.stuartHallDecoding === "Oppositional" ? 0 : 5;

  // Goffman → numeric signal (0–10)
  const goffmanSignal =
    inputs.goffmanStageConsistency === "Consistent" ? 10 :
    inputs.goffmanStageConsistency === "Minor Gap" ? 5 :
    inputs.goffmanStageConsistency === "Significant Gap" ? 1 : 5;

  const signalBreakdown = {
    tribeOverlap: inputs.tribMatchScore,
    decodingAcceptance: decodingSignal,
    archetypeResonance: inputs.archetypeMatchScore,
    symbolicVocabularyOverlap: inputs.symbolicOverlapScore,
    personaConsistency: goffmanSignal,
  };

  const rawScore =
    signalBreakdown.tribeOverlap * 0.30 +
    signalBreakdown.decodingAcceptance * 0.25 +
    signalBreakdown.archetypeResonance * 0.20 +
    signalBreakdown.symbolicVocabularyOverlap * 0.15 +
    signalBreakdown.personaConsistency * 0.10;

  // Scale 0–10 → 0–100
  const parrScore = Math.round(rawScore * 10);

  let parrLabel: PARRLabel;
  if (parrScore >= 80) parrLabel = "High Cultural Legitimacy";
  else if (parrScore >= 60) parrLabel = "Moderate Legitimacy";
  else if (parrScore >= 40) parrLabel = "Mixed Signal";
  else parrLabel = "Low Legitimacy";

  return { parrScore, parrLabel, signalBreakdown };
}

// ─── Full Engine Entry Point ──────────────────────────────────────────────────

export interface FullFITCalculationInput {
  // Creator fields
  creatorArchetype: string;
  goffmanStageConsistency: string;
  driftSignal: string;
  stuartHallDecoding: string;
  rogersAdopterStage: string;
  turnerLiminalPhase: string;
  creatorNichePosition: string;
  // Brand fields
  brandArchetype: string;
  brandType: string;
  // AI-evaluated scores (0–10)
  mythAlignmentScore: number;
  tribMatchScore: number;
  // Symbolic vocabulary overlap (optional — defaults to 5 if not provided)
  creatorKeywords?: string[];
  creatorThemes?: string[];
  brandKeywords?: string[];
  brandThemes?: string[];
}

export interface FullFITResult {
  // Component scores
  archetypeMatchScore: number;
  mythAlignmentScore: number;
  tribMatchScore: number;
  decodingModifier: number;
  alignmentScoreRaw: number;
  rogersBaseScore: number;
  liminalAdjustment: number;
  pulseScoreRaw: number;
  goffmanScore: number;
  driftScore: number;
  stabilityScoreRaw: number;
  // Weights
  weightAlpha: number;
  weightBeta: number;
  weightGamma: number;
  weightPriority: string;
  // Final
  fitScore: number;
  fitStatus: "Green Light" | "Proceed with Caution" | "Do Not Proceed";
  radarWarnings: RadarWarning[];
  // PARR — Predicted Audience Receptivity Rate
  parrScore: number;
  parrLabel: PARRLabel;
  parrSignalBreakdown: Record<string, number>;
  sharedKeywords: string[];
  sharedThemes: string[];
  symbolicOverlapScore: number;
  // QoV — Quality of View (percentage, 0–100)
  qovScore: number;
}

export function runFullFITCalculation(input: FullFITCalculationInput): FullFITResult {
  const weights = getBrandWeights(input.brandType);

  const archetypeMatchScore = getArchetypeMatchScore(input.brandArchetype, input.creatorArchetype);

  const { raw: alignmentRaw, decodingModifier } = calculateAlignmentScore({
    archetypeMatchScore,
    mythAlignmentScore: input.mythAlignmentScore,
    tribMatchScore: input.tribMatchScore,
    stuartHallDecoding: input.stuartHallDecoding,
  });

  const { raw: pulseRaw, rogersBase, liminalAdjustment } = calculatePulseScore({
    rogersAdopterStage: input.rogersAdopterStage,
    turnerLiminalPhase: input.turnerLiminalPhase,
  });

  const { raw: stabilityRaw, goffmanScore, driftScore } = calculateStabilityScore({
    goffmanStageConsistency: input.goffmanStageConsistency,
    driftSignal: input.driftSignal,
  });

  const { fitScore, fitStatus } = calculateFITScore({
    alignmentRaw,
    pulseRaw,
    stabilityRaw,
    weights,
  });

  const radarWarnings = evaluateRadarWarnings({
    alignmentRaw,
    pulseRaw,
    brandArchetype: input.brandArchetype,
    creatorArchetype: input.creatorArchetype,
    stuartHallDecoding: input.stuartHallDecoding,
    driftSignal: input.driftSignal,
    goffmanStageConsistency: input.goffmanStageConsistency,
    creatorNichePosition: input.creatorNichePosition,
  });

  // Symbolic vocabulary overlap (uses decoded symbol data if available)
  const { overlapScore: symbolicOverlapScore, sharedKeywords, sharedThemes } =
    calculateSymbolicVocabularyOverlap({
      creatorKeywords: input.creatorKeywords ?? [],
      creatorThemes: input.creatorThemes ?? [],
      brandKeywords: input.brandKeywords ?? [],
      brandThemes: input.brandThemes ?? [],
    });

  // Verified F.I.T. Impressions Score
  const { parrScore, parrLabel, signalBreakdown: parrSignalBreakdown } =
    calculatePARR({
      tribMatchScore: input.tribMatchScore,
      stuartHallDecoding: input.stuartHallDecoding,
      archetypeMatchScore,
      symbolicOverlapScore,
      goffmanStageConsistency: input.goffmanStageConsistency,
    });

  // QoV = (fitScore / 10) × (parrScore / 100) — expressed as a percentage (0–100)
  const qovScore = Math.round((fitScore / 10) * (parrScore / 100) * 100 * 10) / 10;

  return {
    archetypeMatchScore,
    mythAlignmentScore: input.mythAlignmentScore,
    tribMatchScore: input.tribMatchScore,
    decodingModifier,
    alignmentScoreRaw: alignmentRaw,
    rogersBaseScore: rogersBase,
    liminalAdjustment,
    pulseScoreRaw: pulseRaw,
    goffmanScore,
    driftScore,
    stabilityScoreRaw: stabilityRaw,
    weightAlpha: weights.alpha,
    weightBeta: weights.beta,
    weightGamma: weights.gamma,
    weightPriority: weights.priority,
    fitScore,
    fitStatus,
    radarWarnings,
    parrScore,
    parrLabel,
    parrSignalBreakdown,
    sharedKeywords,
    sharedThemes,
    symbolicOverlapScore,
    qovScore,
  };
}
