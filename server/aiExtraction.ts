/**
 * Connex F.I.T. — AI Extraction Layer
 * Uses the built-in LLM to extract structured cultural profiles
 * from creator handles and brand names/URLs.
 */

import { invokeLLM } from "./_core/llm";
import { computeRogersAdopterStageFromMetadata, computeRemixRateFromMetadata, computeStabilityScoreFromMetadata, computeDriftSignalFromMetadata } from "./fitEngine";

// ─── Creator Extraction ───────────────────────────────────────────────────────

export interface CreatorExtractionResult {
  handle: string;
  platform: "TikTok" | "Instagram" | "YouTube" | "Multi"; // Instagram kept for DB compat; not shown in UI
  displayName: string;
  archetype: string;
  recurringThemes: string[];
  toneRegister: string;
  parasocialBondStrength: number;
  audienceRelationshipType: "Friend" | "Mentor" | "Authority";
  barthesMyth: string;
  culturalCapital: "Produce" | "Relay";
  goffmanStageConsistency: "Consistent" | "Minor Gap" | "Significant Gap";
  driftSignal: "Zero Change" | "Minor Drift" | "Significant Drift" | "Full Pivot";
  stuartHallDecoding: "Dominant" | "Negotiated" | "Oppositional";
  nicheTopicNode: string;
  undergroundDensity: boolean;
  mainstreamBleed: boolean;
  remixRate: boolean;
  brandSaturation: boolean;
  rogersAdopterStage: "Innovators" | "Early Adopters" | "Early Majority" | "Late Majority" | "Laggards";
  creatorNichePosition: "Ahead" | "Consistent" | "Behind";
  lifecyclePhase: "Emergence" | "Growth" | "Maturity" | "Decline";
  barthesNicheMeaning: string;
  turnerLiminalPhase: "Pre-Liminal" | "Liminal" | "Post-Liminal Reintegration";
  pronouns: "she/her" | "he/him" | "they/them" | "not specified";
  aiSummary: string;
}

export async function extractCreatorProfile(
  handleOrUrl: string,
  platform: string,
  evidenceSummary?: string  // Real scraped evidence from webResearch.ts
): Promise<CreatorExtractionResult> {
  const systemPrompt = `You are a cultural anthropologist and media analyst specializing in creator marketing.
Your task is to analyze a social media creator and produce a structured cultural profile using the Connex F.I.T. framework.

CRITICAL INSTRUCTION — TRANSCRIPT CONTENT IS THE HIGHEST PRIORITY SIGNAL:
You will receive evidence that may include SPOKEN TRANSCRIPTS from the creator's actual videos.
If transcripts are present in the evidence (marked as PRIMARY EVIDENCE), treat them as GROUND TRUTH.
Transcripts reveal what the creator literally says — their vocabulary, topics, personality, and values.
This is more reliable than any other signal.

HIERARCHY OF EVIDENCE (highest to lowest):
1. SPOKEN TRANSCRIPTS — what the creator literally says in their videos (most reliable)
2. COMPUTED ENGAGEMENT SIGNALS — data-driven metrics derived from raw API data (use these directly, do not re-derive)
3. TEMPORAL CONTENT ANALYSIS — time-bucketed video history (use for Drift Signal and Goffman)
4. VIDEO TITLES / CAPTIONS — what they post (reliable)
5. HASHTAGS / KEYWORDS — how they tag content (reliable)
6. BIO / SIGNATURE — self-reported personal label (least reliable, often misleading)

CRITICAL RULE — THE CREATOR'S NAME OR HANDLE MUST NEVER INFLUENCE ANY FIELD EXCEPT 'pronouns':
Do NOT use the creator's name, handle, or cultural/religious background implied by their name to infer archetype, niche, myth, values, or any other field.
A handle like 'alkhussein' does not mean the creator is a caregiver, spiritual, or religious — it is just a name.
A handle like 'foodgod' does not mean the creator is a food creator — look at the actual content.
The ONLY field that may use the display name as a signal is 'pronouns' (for gender inference).
Every other field MUST be derived exclusively from content evidence: transcripts, video titles, hashtags, and engagement data.

Examples of correct behavior:
- Transcripts show food reviews and restaurant visits → classify as FOOD CREATOR regardless of bio or name
- Bio says "father of 5" but transcripts are all food reviews → FOOD CREATOR, not family/parenting
- Bio says "entrepreneur" but transcripts are comedy skits → COMEDY CREATOR, not business
- Handle implies a cultural/religious identity → IGNORE for archetype; look at what they actually post
- Evidence shows comment rate 0.35% → parasocialBondStrength = 4.0 (use the computed label, do not guess)
- Evidence shows save rate 0.8% → audienceRelationshipType = "Mentor" (use the computed label)
- Evidence shows original audio 60% + high share rate → culturalCapital = "Produce"

NEVER let a personal bio, name, or handle override transcript or video content evidence.
The creator's professional identity is what they CREATE and SAY, not what they are called.
Be rigorous, specific, and grounded in the evidence. Use the exact terminology specified.

KEYWORD AND THEME EXTRACTION INSTRUCTION:
When identifying keywords and recurring themes, prioritize words and phrases that reveal:
- Beliefs and values (e.g. "halal", "authentic", "community", "self-made", "grind", "faith")
- Emotional drivers (e.g. "nostalgia", "pride", "belonging", "aspiration", "comfort")
- Identity claims (e.g. "immigrant", "diaspora", "first-gen", "Muslim", "Black-owned", "queer")
- Status markers (e.g. "exclusive", "underground", "mainstream", "viral", "local gem")
- Motivations (e.g. "inspire", "educate", "entertain", "connect", "represent")
- Social capital signals (e.g. "in-the-know", "early adopter", "community leader")
These are more anthropologically revealing than topic nouns alone.`;

  const evidenceBlock = evidenceSummary
    ? `\n\nREAL SCRAPED EVIDENCE (use this as ground truth):\n${evidenceSummary}\n`
    : `\n\nNote: No scraped evidence available. Use your knowledge of this creator if they are publicly known, but be conservative and note uncertainty.`;

  const userPrompt = `Analyze the following social media creator and produce a complete Connex F.I.T. cultural profile.${evidenceBlock}

Creator Handle: ${handleOrUrl}
Platform: ${platform}

Based on the evidence above, output a JSON object with EXACTLY these fields:

{
  "handle": "their @handle (without @)",
  "platform": "TikTok" | "YouTube" | "Multi",
  "displayName": "their display name",
  "archetype": ONE OF EXACTLY: "The Sage" | "The Hero" | "The Outlaw" | "The Explorer" | "The Magician" | "The Ruler" | "The Caregiver" | "The Lover" | "The Jester" | "The Innocent" | "The Everyman" | "The Creator".
    ARCHETYPE DECISION RULES - apply in strict priority order, pick the FIRST match:
    1. The Outlaw: creator challenges norms, confronts authority, speaks bluntly or controversially, rates or judges people/food directly in front of them, or positions as anti-establishment. CRITICAL: If transcripts show confrontational or provocative behavior - even if they also explore food or culture - classify as The Outlaw, NOT The Explorer.
    2. The Hero: overcomes adversity, documents achievement journey, motivates others through difficulty.
    3. The Explorer: discovers new places/cultures with curiosity and openness. Neutral/curious tone. Do NOT use if primary mode is confrontation or judgment.
    4. The Everyman: relatable, ordinary, seeks belonging. Self-deprecating humor, everyday life.
    5. The Jester: entertains through humor, comedy skits, pranks.
    6. The Sage: educates, explains, shares expertise. Tutorial or analysis content.
    7. The Lover: beauty, relationships, sensory experience, passion with emotional depth.
    8. The Caregiver: nurtures, supports, advocates for others.
    9. The Magician: transforms situations, reveals hidden truths, before/after content.
    10. The Ruler: commands authority, leads, demonstrates mastery.
    11. The Creator: builds, makes, crafts original work. DIY, art, design.
    12. The Innocent: projects optimism, purity, nostalgia. Wholesome content.,
  "recurringThemes": ["theme1", "theme2", "theme3"] (3-4 specific recurring content topics/formats — be anthropologically specific, e.g. "Halal Street Food Reviews" not "Food", "Diaspora Identity Storytelling" not "Culture"),
  "toneRegister": "2-3 words describing their emotional register and communication style",
  "parasocialBondStrength": number between 1.0 and 5.0.
    RULE: If the evidence includes a PARASOCIAL BOND STRENGTH label in COMPUTED ENGAGEMENT SIGNALS,
    extract the numeric value from that label (e.g. "4.0 — Strong bond" means use 4.0).
    Only estimate independently if no computed signal is present.
    Estimation rubric: 5.0=deep friend bond (comment rate >=0.5%), 4.0=strong engagement (>=0.25%),
    3.0=moderate/professional distance (>=0.10%), 2.0=weak/passive (>=0.05%), 1.0=transactional (<0.05%),
  "audienceRelationshipType": "Friend" | "Mentor" | "Authority".
    RULE: If the evidence includes an AUDIENCE RELATIONSHIP TYPE label in COMPUTED ENGAGEMENT SIGNALS,
    use that value directly. Only estimate if absent.
    Estimation rubric: Authority=save rate >=1.0%, Mentor=save rate >=0.4%, Friend=save rate <0.4%,
  "barthesMyth": "This creator makes it feel obvious that [complete the sentence with their core cultural myth — the unspoken belief their content naturalizes for their audience]",
  "culturalCapital": "Produce" | "Relay".
    RULE: If the evidence includes a CULTURAL CAPITAL label in COMPUTED ENGAGEMENT SIGNALS,
    use Produce if the label starts with PRODUCE, Relay if it starts with RELAY.
    Estimation rubric: Produce=creates original formats/audio/ideas, Relay=participates in existing trends,
  "goffmanStageConsistency": "Consistent" | "Minor Gap" | "Significant Gap".
    RULE: If the evidence includes a TEMPORAL CONTENT ANALYSIS section, compare the tone and topic
    of RECENT vs OLDER content. Consistent=same style throughout, Minor Gap=slight tone shift,
    Significant Gap=clear difference between public persona and older/unscripted content.
    Default to Consistent if only one time period has data or no temporal data is present,
  "driftSignal": "Zero Change" | "Minor Drift" | "Significant Drift" | "Full Pivot".
    RULE: If the evidence includes a TEMPORAL CONTENT ANALYSIS section, compare the NICHE/TOPIC of
    RECENT vs OLDER content. Zero Change=same niche throughout, Minor Drift=same niche with slight
    evolution, Significant Drift=clear topic shift, Full Pivot=completely different niche.
    Default to Zero Change if only one time period has data or no temporal data is present,
  "stuartHallDecoding": "Dominant" | "Negotiated" | "Oppositional" (how does their audience decode branded content? Dominant=accepts brand message at face value, Negotiated=accepts partially with own filter, Oppositional=audience rejects or subverts brand messaging),
  "nicheTopicNode": "specific niche name — be precise and anthropologically specific (e.g. 'halal street food reviews in the diaspora' not 'food content')",
  "undergroundDensity": true | false (is this niche still alive in tight non-mainstream communities?),
  "mainstreamBleed": true | false (is this niche crossing into mass media / mainstream awareness?),
  "remixRate": true | false.
    RULE: If the evidence includes a REMIX RATE / COMMUNITY OPENNESS label in COMPUTED ENGAGEMENT SIGNALS,
    set true if the label says HIGH, false if LOW or NONE. Only estimate if absent,
  "brandSaturation": true | false.
    RULE: If the evidence includes a BRAND SATURATION label in COMPUTED ENGAGEMENT SIGNALS,
    set true if the label says HIGH or MODERATE, false if NONE. Only estimate if absent,
  "rogersAdopterStage": "Innovators" | "Early Adopters" | "Early Majority" | "Late Majority" | "Laggards" (where does this NICHE sit on the Rogers adoption curve — not the creator's follower count),
  "creatorNichePosition": "Ahead" | "Consistent" | "Behind" (where does THIS CREATOR sit relative to where the niche is heading?),
  "lifecyclePhase": "Emergence" | "Growth" | "Maturity" | "Decline" (current lifecycle phase of the niche),
  "barthesNicheMeaning": "This niche used to mean [X] — it is now starting to mean [Y]." OR "No meaning shift detected — core belief remains stable.",
  "turnerLiminalPhase": "Pre-Liminal" | "Liminal" | "Post-Liminal Reintegration" (is this niche community in identity transition?),
  "pronouns": "she/her" | "he/him" | "they/them" | "not specified".
    RULE: Infer pronouns from all available evidence in this priority order:
    1. Explicit self-identification in bio or transcripts (e.g. 'she/her in bio', 'I am a woman', 'as a guy')
    2. Self-referential language in transcripts (e.g. 'as a girl', 'as a man', 'my boyfriend/girlfriend')
    3. Display name gender signals (e.g. female-coded names like Sai, Christina, Aisha)
    4. If no signal is available, use 'not specified'.
    NEVER default to 'he/him' — if uncertain, use 'not specified'.,
  "aiSummary": "A 2-3 sentence cultural analyst summary covering: (1) this creator's symbolic position and what cultural identity they represent, (2) the nature of their audience relationship and parasocial dynamic grounded in the engagement data, (3) their brand partnership potential and any cultural risks or sensitivities. Use the correct pronouns throughout."
}

CAMPAIGN TYPE SELECTION GUIDE — choose the most accurate fit:
- Heritage/Luxury: Premium/luxury goods brands with heritage positioning (fashion houses, fine jewellery, prestige spirits, luxury hotels). NOT for local restaurants or community businesses.
- Trend-First: Brands built on cultural momentum, drops, and virality (streetwear, fast fashion, trending CPG, limited-edition launches).
- Long-Term Ambassador: Brands seeking a sustained identity partnership over 6-12+ months (fitness brands, lifestyle brands, wellness, B2B services).
- Product Launch: Brands with a specific new product or service to announce (tech product, new menu item, app launch, seasonal collection).
- Community/Local: Local or neighbourhood-rooted businesses where the goal is driving foot traffic, local awareness, and community belonging (local restaurants, neighbourhood gyms, local retailers, regional service businesses). Use this for any brand that is primarily a local/physical business.
- Awareness/Consideration: Established brands seeking broader audience reach and category education without a specific launch (financial services, insurance, healthcare, nonprofits, B2B).

Be specific and evidence-based. Every field must be populated. Output only valid JSON.`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "creator_profile",
        strict: true,
        schema: {
          type: "object",
          properties: {
            handle: { type: "string" },
            platform: { type: "string", enum: ["TikTok", "Instagram", "YouTube", "Multi"] },
            displayName: { type: "string" },
            archetype: { type: "string", enum: ["The Sage", "The Hero", "The Outlaw", "The Explorer", "The Magician", "The Ruler", "The Caregiver", "The Lover", "The Jester", "The Innocent", "The Everyman", "The Creator"] },
            recurringThemes: { type: "array", items: { type: "string" } },
            toneRegister: { type: "string" },
            parasocialBondStrength: { type: "number" },
            audienceRelationshipType: { type: "string", enum: ["Friend", "Mentor", "Authority"] },
            barthesMyth: { type: "string" },
            culturalCapital: { type: "string", enum: ["Produce", "Relay"] },
            goffmanStageConsistency: { type: "string", enum: ["Consistent", "Minor Gap", "Significant Gap"] },
            driftSignal: { type: "string", enum: ["Zero Change", "Minor Drift", "Significant Drift", "Full Pivot"] },
            stuartHallDecoding: { type: "string", enum: ["Dominant", "Negotiated", "Oppositional"] },
            nicheTopicNode: { type: "string" },
            undergroundDensity: { type: "boolean" },
            mainstreamBleed: { type: "boolean" },
            remixRate: { type: "boolean" },
            brandSaturation: { type: "boolean" },
            rogersAdopterStage: { type: "string", enum: ["Innovators", "Early Adopters", "Early Majority", "Late Majority", "Laggards"] },
            creatorNichePosition: { type: "string", enum: ["Ahead", "Consistent", "Behind"] },
            lifecyclePhase: { type: "string", enum: ["Emergence", "Growth", "Maturity", "Decline"] },
            barthesNicheMeaning: { type: "string" },
            turnerLiminalPhase: { type: "string", enum: ["Pre-Liminal", "Liminal", "Post-Liminal Reintegration"] },
            aiSummary: { type: "string" },
            pronouns: { type: "string", enum: ["she/her", "he/him", "they/them", "not specified"] },
          },
          required: [
            "handle", "platform", "displayName", "archetype", "recurringThemes",
            "toneRegister", "parasocialBondStrength", "audienceRelationshipType",
            "barthesMyth", "culturalCapital", "goffmanStageConsistency", "driftSignal",
            "stuartHallDecoding", "nicheTopicNode", "undergroundDensity", "mainstreamBleed",
            "remixRate", "brandSaturation", "rogersAdopterStage", "creatorNichePosition",
            "lifecyclePhase", "barthesNicheMeaning", "turnerLiminalPhase", "aiSummary", "pronouns",
          ],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content for creator extraction");

  const raw = JSON.parse(content as string) as CreatorExtractionResult;

  // Clamp parasocialBondStrength to valid range
  raw.parasocialBondStrength = Math.max(1.0, Math.min(5.0, raw.parasocialBondStrength));

  return raw;
}

// ─── Brand Extraction ─────────────────────────────────────────────────────────

export interface BrandExtractionResult {
  brandName: string;
  category: string;
  archetype: string;
  brandArchetypeClassification: "Trust" | "Community" | "Momentum";
  emotionalPromise: string;
  visualLanguage: string[];
  audienceTribe: string;
  culturalTension: string;
  barthesMyth: string;
  brandTone: string;  // 2-3 words, e.g. "formal, institutional, aspirational"
  brandType: string;
  campaignType: "Heritage/Luxury" | "Trend-First" | "Long-Term Ambassador" | "Product Launch" | "Community/Local" | "Awareness/Consideration";
  aiSummary: string;
}

export async function extractBrandProfile(
  brandNameOrUrl: string,
  evidenceSummary?: string
): Promise<BrandExtractionResult> {
  // Full brand type list — mirrors BRAND_WEIGHT_TABLE in fitEngine.ts
  const brandTypeOptions = [
    // Trust brands — Medical
    "Medical — General Practice / Clinic", "Medical — Aesthetics / MedSpa",
    "Medical — Chiropractic / PT / Allied Health", "Medical — Dental / Orthodontics",
    "Medical — Optometry / Vision Care", "Medical — Pharmacy / Health Retail",
    "Mental Health — Private Practice / App", "Mental Health — Wellness Platform",
    // Trust brands — Legal
    "Legal — Personal Injury / Consumer Law", "Legal — Corporate / Commercial Law",
    "Legal — Family Law", "Legal — Immigration Law", "Legal — Criminal Defence",
    // Trust brands — Financial
    "Financial — Personal Finance / Budgeting", "Financial — Local Accounting / Tax",
    "Financial — Wealth Management / Investment", "Financial — Mortgage / Lending",
    "Financial — Fintech / Banking App",
    // Trust brands — Insurance
    "Insurance — Local Broker", "Insurance — Life / Health Insurance", "Insurance — Auto / Home Insurance",
    // Trust brands — Home / Construction
    "Home — Renovation / Contracting", "Home — Architecture / Interior Design Firm",
    // Trust brands — Family / Children
    "Family — Children's Products", "Family — Baby / Infant Care", "Family — Parenting / Education Platform",
    // Trust brands — Education
    "Education — Local Tutoring / School", "Education — University / College",
    "Education — Professional Certification",
    // Trust brands — Real Estate
    "Real Estate — Residential Agent", "Real Estate — Property Developer",
    "Real Estate — Commercial / Investment", "Real Estate — Property Management",
    // Trust brands — Automotive
    "Automotive — Dealership / Sales", "Automotive — Repair / Service",
    // Trust brands — Government
    "Government / Public Sector",
    // Community brands — Fitness & Sports
    "Fitness — Local Gym / Studio", "Fitness — Equipment / Apparel", "Fitness — Online Training / App",
    "Sports — Youth / Amateur Club", "Sports — Professional Team / League", "Sports — Outdoor / Adventure",
    // Community brands — Retail
    "Retail — Local Boutique", "Retail — Specialty / Niche Retail", "Retail — Thrift / Vintage",
    // Community brands — Beauty
    "Beauty — Skincare", "Beauty — Hair Care", "Beauty — Salon / Local Service",
    "Beauty — Natural / Clean Beauty", "Beauty — Men's Grooming",
    // Community brands — Food & Beverage
    "F&B — Specialty Coffee / Café", "F&B — Health Food / Organic",
    "F&B — Farmers Market / Local Produce", "F&B — Specialty / Ethnic Grocery",
    // Community brands — Home & Lifestyle
    "Home — Interior Design / Décor", "Home — Cleaning / Household Products", "Home — Smart Home / Technology",
    // Community brands — Pet
    "Pet — Products / Accessories", "Pet — Veterinary / Local Service", "Pet — Food / Nutrition",
    // Community brands — Coaching & Wellness
    "Coaching — Business / Life Coach", "Coaching — Nutrition / Dietitian", "Coaching — Relationship / Dating",
    // Community brands — Travel & Hospitality
    "Travel — Boutique Hotel / B&B", "Travel — Local Tourism / Experience", "Travel — Eco / Sustainable Tourism",
    // Community brands — Fashion
    "Fashion — Heritage / Luxury", "Fashion — Accessible / Mid-Market", "Fashion — Sustainable / Ethical",
    // Community brands — Education
    "Education — Online Course / Creator",
    // Community brands — Nonprofit
    "Nonprofit — Cause Marketing", "Nonprofit — Community Organisation",
    // Community brands — Restaurant
    "Restaurant — Casual Dining", "Restaurant — Fine Dining / Experiential",
    "Restaurant — Ethnic / Cultural", "Restaurant — Brunch / Café Culture",
    // Momentum brands — Beauty
    "Beauty — Makeup / Color", "Beauty — Fragrance / Luxury Beauty", "Beauty — Nail / Body Art",
    // Momentum brands — Retail
    "Retail — E-Commerce / DTC Product", "Retail — Seasonal / Holiday Campaign", "Retail — Flash Sale / Discount",
    // Momentum brands — Food & Beverage
    "F&B — Craft Beverage / Alcohol", "F&B — Packaged Food / CPG", "F&B — Energy Drink / Supplement",
    "F&B — Food Delivery / Ghost Kitchen", "F&B — Snack / Confectionery",
    // Momentum brands — Restaurant
    "Restaurant — QSR / Fast Food", "Restaurant — QSR / Limited-Time Activation",
    "Restaurant — Food Truck / Pop-Up",
    // Momentum brands — Fashion
    "Fashion — Trend-First / Streetwear", "Fashion — Fast Fashion", "Fashion — Activewear / Athleisure",
    // Momentum brands — Tech & Gaming
    "Tech — SaaS / App", "Tech — Consumer Electronics", "Tech — Gaming / Esports", "Tech — Creator Tools / Platform",
    // Momentum brands — Entertainment
    "Entertainment — Streaming / OTT", "Entertainment — Music / Artist",
    "Entertainment — Event / Festival", "Entertainment — Podcast / Media Brand",
    // Momentum brands — Travel
    "Travel — Tour Operator / Activity", "Travel — Airline / Transport",
    // Campaign Types
    "Long-Term Ambassador", "Product Launch",
  ];

  const systemPrompt = `You are a brand strategist and cultural analyst specializing in creator marketing.
Your task is to analyze a brand or business and produce a structured cultural profile using the Connex F.I.T. framework.
You will be provided with REAL, SCRAPED evidence from the brand's public website and web presence.
You MUST base your analysis on this evidence. Do NOT contradict the evidence.
If the evidence shows a local restaurant, analyze it as a local restaurant. If the evidence shows a luxury brand, analyze it as luxury.
Be rigorous, specific, and grounded in the provided evidence. Use the exact terminology specified.

BRAND ARCHETYPE CLASSIFICATION (Chapter 3 — F.I.T. Framework):
Before selecting a brandType, you MUST first classify the brand into one of three Brand Archetypes:
- TRUST: Built on credibility, safety, and reliability. Consumer must believe before they act. Examples: medical clinics, legal firms, financial advisors, insurance, children's products. Weight signature: α=0.5, β=0.1–0.2, γ=0.3–0.4.
- COMMUNITY: Built on belonging, identity, and shared values. Consumer identifies with the brand. Examples: local gyms, boutique retail, specialty cafés, wellness coaches, pet care. Weight signature: α=0.4–0.5, β=0.2–0.3, γ=0.3.
- MOMENTUM: Built on energy, relevance, and cultural presence. Consumer wants what is exciting right now. Examples: QSR chains, streetwear, makeup/color, craft beverages, seasonal campaigns. Weight signature: α=0.2–0.4, β=0.4–0.6, γ=0.2.
The brandArchetypeClassification field MUST be consistent with the brandType you select.

When the evidence includes an AUDIENCE PERCEPTION section with Yelp and/or Google Maps reviews:
- Treat review language as the most authentic signal of how the brand is DECODED by its audience (Stuart Hall)
- Look for the symbolic meaning customers assign to the brand (e.g. 'cultural anchor', 'status symbol', 'comfort food')
- Identify any Goffman Stage Gap: does the brand's self-presentation match how customers actually experience it?
- Note emotional drivers that bring customers to this brand (belonging, nostalgia, discovery, status)
- Detect any in-group vs. out-group decoding split in the reviews
- Flag cultural risks visible in negative reviews (inconsistency, unmet expectations, service gaps)
- Let review evidence directly inform: audienceTribe, barthesMyth, emotionalPromise, culturalTension, and aiSummary
- Use the Brand Archetype classification to validate your brandType selection: if reviews show high trust-dependency, lean Trust; if reviews show community belonging, lean Community; if reviews show trend-chasing, lean Momentum.`;

  const evidenceBlock = evidenceSummary
    ? `\n\nREAL SCRAPED EVIDENCE (use this as ground truth):\n${evidenceSummary}\n`
    : `\n\nNote: No scraped evidence available. Use your knowledge of this brand if it is publicly known, but be conservative.`;

  const userPrompt = `Analyze the following brand and produce a complete Connex F.I.T. cultural brand profile.${evidenceBlock}

Brand: ${brandNameOrUrl}

Based on the evidence above, output a JSON object with EXACTLY these fields:

{
  "brandName": "official brand name",
  "category": "industry category (e.g. Beauty, Fitness, Food & Beverage)",
  "archetype": ONE OF EXACTLY: "The Sage" | "The Hero" | "The Outlaw" | "The Explorer" | "The Magician" | "The Ruler" | "The Caregiver" | "The Lover" | "The Jester" | "The Innocent" | "The Everyman" | "The Creator",
  "emotionalPromise": "Our audience feels [complete this sentence] when they engage with us.",
  "visualLanguage": ["adjective1", "adjective2", "adjective3"] (EXACTLY 3 adjectives describing the brand's visual identity),
  "audienceTribe": "Psychographic description of target audience — what they believe, aspire to, and reject",
  "culturalTension": "This brand exists in the tension between [X] and [Y].",
  "barthesMyth": "This brand normalizes the belief that [complete this sentence].",
  "brandTone": "2-3 words describing the brand's tone register (e.g. 'formal, institutional, aspirational' or 'playful, irreverent, bold' or 'warm, community-driven, accessible')",
  "brandArchetypeClassification": ONE OF EXACTLY: "Trust" | "Community" | "Momentum" — the governing structural archetype for this brand based on Chapter 3 logic,
  "brandType": ONE OF EXACTLY: ${JSON.stringify(brandTypeOptions)},
  "campaignType": "Heritage/Luxury" | "Trend-First" | "Long-Term Ambassador" | "Product Launch" | "Community/Local" | "Awareness/Consideration",
  "aiSummary": "A 2-3 sentence cultural analyst summary of this brand's symbolic position, target audience, and creator partnership strategy. Include which Brand Archetype this is (Trust/Community/Momentum) and why."
}

IMPORTANT: brandArchetypeClassification and brandType must be consistent. Trust brands → Medical, Legal, Financial, Insurance, Children's, Home Renovation. Community brands → Fitness, Boutique Retail, Specialty Café, Wellness, Pet, Hair Care, Home Décor. Momentum brands → Makeup/Color, QSR, Streetwear, CPG, Craft Beverage, Seasonal Campaigns, Tech.

CAMPAIGN TYPE SELECTION GUIDE — choose the most accurate fit:
- Heritage/Luxury: Premium/luxury goods brands with heritage positioning (fashion houses, fine jewellery, prestige spirits, luxury hotels). NOT for local restaurants or community businesses.
- Trend-First: Brands built on cultural momentum, drops, and virality (streetwear, fast fashion, trending CPG, limited-edition launches).
- Long-Term Ambassador: Brands seeking a sustained identity partnership over 6-12+ months (fitness brands, lifestyle brands, wellness, B2B services).
- Product Launch: Brands with a specific new product or service to announce (tech product, new menu item, app launch, seasonal collection).
- Community/Local: Local or neighbourhood-rooted businesses where the goal is driving foot traffic, local awareness, and community belonging (local restaurants, neighbourhood gyms, local retailers, regional service businesses). Use this for any brand that is primarily a local/physical business.
- Awareness/Consideration: Established brands seeking broader audience reach and category education without a specific launch (financial services, insurance, healthcare, nonprofits, B2B).

Be specific and evidence-based. Every field must be populated. Output only valid JSON.`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "brand_profile",
        strict: true,
        schema: {
          type: "object",
          properties: {
            brandName: { type: "string" },
            category: { type: "string" },
            archetype: { type: "string" },
            emotionalPromise: { type: "string" },
            visualLanguage: { type: "array", items: { type: "string" } },
            audienceTribe: { type: "string" },
            culturalTension: { type: "string" },
            barthesMyth: { type: "string" },
            brandTone: { type: "string" },
            brandArchetypeClassification: { type: "string", enum: ["Trust", "Community", "Momentum"] },
            brandType: { type: "string" },
            campaignType: { type: "string", enum: ["Heritage/Luxury", "Trend-First", "Long-Term Ambassador", "Product Launch", "Community/Local", "Awareness/Consideration"] },
            aiSummary: { type: "string" },
          },
          required: [
            "brandName", "category", "archetype", "brandArchetypeClassification",
            "emotionalPromise", "visualLanguage",
            "audienceTribe", "culturalTension", "barthesMyth", "brandTone", "brandType", "campaignType", "aiSummary",
          ],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from AI extraction");

  return JSON.parse(content as string) as BrandExtractionResult;
}

// ─── Narrative Generation ─────────────────────────────────────────────────────

export interface NarrativeInput {
  creatorHandle: string;
  brandName: string;
  caiScore: number;
  caiStatus: string;
  alignmentRaw: number;
  pulseRaw: number;
  stabilityRaw: number;
  radarWarnings: string[];
  creatorArchetype: string;
  brandArchetype: string;
  creatorBarthesMyth: string;
  brandBarthesMyth: string;
  creatorAudienceRelationship: string;
  brandAudienceTribe: string;
  weightPriority: string;
  creatorPronouns?: string;
}

export interface NarrativeResult {
  narrativeSummary: string;
  alignmentNotes: {
    archetypeAnalysis: string;
    mythAlignment: string;
    audienceOverlap: string;
    culturalMomentum: string;
    identityStability: string;
    recommendation: string;
  };
}

export async function generateFITNarrative(input: NarrativeInput): Promise<NarrativeResult> {
  const systemPrompt = `You are a plain-talking creator marketing strategist writing a match report for a business owner or junior marketer.
Your job is to explain whether this creator and brand are a good match in clear, simple language that anyone can understand.

IMPORTANT WRITING RULES:
- Write like you are explaining this to a smart business owner who has never studied marketing theory.
- NO academic jargon. Do NOT use: archetype, Barthes myth, Barthesian, symbolic capital, liminality, Bourdieu, Goffman, Stuart Hall, parasocial, semiotics, psychographic, decoding, signifier, or any similar academic term.
- Replace "archetype" with "personality type" or "the kind of person/brand they come across as".
- Replace "myth" or "Barthes myth" with "what they stand for" or "the story they tell".
- Replace "psychographic overlap" with "shared values" or "the same kind of people".
- Replace "cultural momentum" with "trending" or "what is popular right now".
- Replace "identity stability" with "how consistent they are" or "how reliable their content is".
- Write in short, direct sentences. No filler phrases. No hedging language.
- Use the creator's stated pronouns throughout. If pronouns are 'not specified', use 'they/them'. Never assume pronouns.
- The tone should feel like honest advice from someone who knows the industry well.`;

  const userPrompt = `Write a match report for this creator-brand pairing:
Creator: ${input.creatorHandle} (Personality type: ${input.creatorArchetype}, Pronouns: ${input.creatorPronouns ?? "not specified"})
Brand: ${input.brandName} (Personality type: ${input.brandArchetype})
F.I.T. Score: ${input.caiScore}/10 — ${input.caiStatus}
Alignment: ${input.alignmentRaw.toFixed(1)}/10 | Momentum: ${input.pulseRaw.toFixed(1)}/10 | Consistency: ${input.stabilityRaw.toFixed(1)}/10
Flags: ${input.radarWarnings.length > 0 ? input.radarWarnings.join(", ") : "None"}
Creator story: ${input.creatorBarthesMyth}
Brand story: ${input.brandBarthesMyth}
Creator audience: ${input.creatorAudienceRelationship}
Brand target customer: ${input.brandAudienceTribe}
Key scoring priority: ${input.weightPriority}

Output a JSON object with:
{
  "narrativeSummary": "3-4 plain sentences summarizing this match for a business owner. Start with whether this is a good match and why. Mention the most important strength or concern. End with a clear recommendation. No jargon.",
  "alignmentNotes": {
    "archetypeAnalysis": "1-2 plain sentences explaining whether ${input.creatorHandle} and ${input.brandName} come across as the same kind of people/brand to an audience, and whether that helps or hurts the partnership.",
    "mythAlignment": "1-2 plain sentences on whether the creator and brand are telling the same story to their audiences — do they stand for the same things?",
    "audienceOverlap": "1-2 plain sentences on whether the creator's followers are the same kind of people the brand wants to reach, and how strong that overlap is.",
    "culturalMomentum": "1-2 plain sentences on whether this type of content is popular right now and whether the timing is good for this partnership.",
    "identityStability": "1-2 plain sentences on how consistent the creator's content is and what that means for the brand — is this a safe, predictable partner?",
    "recommendation": "1-2 plain sentences of direct advice — should the brand move forward, move forward with conditions, or pass? Say exactly why in plain language."
  }
}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "fit_narrative",
        strict: true,
        schema: {
          type: "object",
          properties: {
            narrativeSummary: { type: "string" },
            alignmentNotes: {
              type: "object",
              properties: {
                archetypeAnalysis: { type: "string" },
                mythAlignment: { type: "string" },
                audienceOverlap: { type: "string" },
                culturalMomentum: { type: "string" },
                identityStability: { type: "string" },
                recommendation: { type: "string" },
              },
              required: ["archetypeAnalysis", "mythAlignment", "audienceOverlap", "culturalMomentum", "identityStability", "recommendation"],
              additionalProperties: false,
            },
          },
          required: ["narrativeSummary", "alignmentNotes"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from narrative generation");

  return JSON.parse(content as string) as NarrativeResult;
}
