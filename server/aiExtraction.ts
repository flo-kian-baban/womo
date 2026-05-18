/**
 * Connex F.I.T. — AI Extraction Layer
 * Uses the built-in LLM to extract structured cultural profiles
 * from influencer handles and brand names/URLs.
 */

import { invokeLLM } from "./_core/llm";

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
  const systemPrompt = `You are a cultural anthropologist and media analyst specializing in influencer marketing.
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
  "archetype": ONE OF EXACTLY: "The Sage" | "The Hero" | "The Outlaw" | "The Explorer" | "The Magician" | "The Ruler" | "The Caregiver" | "The Lover" | "The Jester" | "The Innocent" | "The Everyman" | "The Creator",
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

Be specific and evidence-based. Every field must be populated. Output only valid JSON.`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "creator_profile",
        strict: true,
        schema: {
          type: "object",
          properties: {
            handle: { type: "string" },
            platform: { type: "string" },
            displayName: { type: "string" },
            archetype: { type: "string" },
            recurringThemes: { type: "array", items: { type: "string" } },
            toneRegister: { type: "string" },
            parasocialBondStrength: { type: "number" },
            audienceRelationshipType: { type: "string" },
            barthesMyth: { type: "string" },
            culturalCapital: { type: "string" },
            goffmanStageConsistency: { type: "string" },
            driftSignal: { type: "string" },
            stuartHallDecoding: { type: "string" },
            nicheTopicNode: { type: "string" },
            undergroundDensity: { type: "boolean" },
            mainstreamBleed: { type: "boolean" },
            remixRate: { type: "boolean" },
            brandSaturation: { type: "boolean" },
            rogersAdopterStage: { type: "string" },
            creatorNichePosition: { type: "string" },
            lifecyclePhase: { type: "string" },
            barthesNicheMeaning: { type: "string" },
            turnerLiminalPhase: { type: "string" },
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
  emotionalPromise: string;
  visualLanguage: string[];
  audienceTribe: string;
  culturalTension: string;
  barthesMyth: string;
  brandType: string;
  campaignType: "Heritage/Luxury" | "Trend-First" | "Long-Term Ambassador" | "Product Launch";
  aiSummary: string;
}

export async function extractBrandProfile(
  brandNameOrUrl: string,
  evidenceSummary?: string
): Promise<BrandExtractionResult> {
  const brandTypeOptions = [
    "Retail — Local Boutique", "Retail — E-Commerce / DTC Product", "Retail — Seasonal / Holiday Campaign",
    "Beauty — Skincare", "Beauty — Makeup / Color", "Beauty — Hair Care", "Beauty — Salon / Local Service",
    "Home — Interior Design / Décor", "Home — Cleaning / Household Products", "Home — Renovation / Contracting",
    "Medical — General Practice / Clinic", "Medical — Aesthetics / MedSpa", "Medical — Chiropractic / PT / Allied Health",
    "Mental Health — Private Practice / App", "Legal — Personal Injury / Consumer Law",
    "Financial — Personal Finance / Budgeting", "Financial — Local Accounting / Tax",
    "Real Estate — Residential Agent", "Real Estate — Property Developer", "Insurance — Local Broker",
    "Fitness — Local Gym / Studio", "Fitness — Equipment / Apparel", "Sports — Youth / Amateur Club",
    "F&B — Specialty Coffee / Café", "F&B — Craft Beverage / Alcohol", "F&B — Packaged Food / CPG", "F&B — Health Food / Organic",
    "Education — Online Course / Creator", "Education — Local Tutoring / School", "Coaching — Business / Life Coach",
    "Pet — Products / Accessories", "Pet — Veterinary / Local Service", "Family — Children's Products",
    "Travel — Local Tourism / Experience", "Travel — Boutique Hotel / B&B", "Travel — Tour Operator / Activity",
    "Fashion — Heritage / Luxury", "Fashion — Trend-First / Streetwear", "Fashion — Accessible / Mid-Market",
    "Long-Term Ambassador", "Product Launch",
    "Restaurant — Casual Dining", "Restaurant — Fine Dining / Experiential", "Restaurant — QSR / Fast Food",
    "Restaurant — QSR / Limited-Time Activation",
  ];

  const systemPrompt = `You are a brand strategist and cultural analyst specializing in influencer marketing.
Your task is to analyze a brand or business and produce a structured cultural profile using the Connex F.I.T. framework.
You will be provided with REAL, SCRAPED evidence from the brand's public website and web presence.
You MUST base your analysis on this evidence. Do NOT contradict the evidence.
If the evidence shows a local restaurant, analyze it as a local restaurant. If the evidence shows a luxury brand, analyze it as luxury.
Be rigorous, specific, and grounded in the provided evidence. Use the exact terminology specified.

When the evidence includes an AUDIENCE PERCEPTION section with Yelp and/or Google Maps reviews:
- Treat review language as the most authentic signal of how the brand is DECODED by its audience (Stuart Hall)
- Look for the symbolic meaning customers assign to the brand (e.g. 'cultural anchor', 'status symbol', 'comfort food')
- Identify any Goffman Stage Gap: does the brand's self-presentation match how customers actually experience it?
- Note emotional drivers that bring customers to this brand (belonging, nostalgia, discovery, status)
- Detect any in-group vs. out-group decoding split in the reviews
- Flag cultural risks visible in negative reviews (inconsistency, unmet expectations, service gaps)
- Let review evidence directly inform: audienceTribe, barthesMyth, emotionalPromise, culturalTension, and aiSummary`;

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
  "brandType": ONE OF EXACTLY: ${JSON.stringify(brandTypeOptions)},
  "campaignType": "Heritage/Luxury" | "Trend-First" | "Long-Term Ambassador" | "Product Launch",
  "aiSummary": "A 2-3 sentence cultural analyst summary of this brand's symbolic position, target audience, and creator partnership strategy."
}

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
            brandType: { type: "string" },
            campaignType: { type: "string", enum: ["Heritage/Luxury", "Trend-First", "Long-Term Ambassador", "Product Launch"] },
            aiSummary: { type: "string" },
          },
          required: [
            "brandName", "category", "archetype", "emotionalPromise", "visualLanguage",
            "audienceTribe", "culturalTension", "barthesMyth", "brandType", "campaignType", "aiSummary",
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
  fitScore: number;
  fitStatus: string;
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
  const systemPrompt = `You are a senior cultural strategist at Connex, an AI-native influencer marketing platform. 
You write precise, insightful F.I.T. Score narrative reports that explain the cultural alignment between creators and brands.
Your writing is sophisticated, uses the correct sociological terminology, and provides actionable strategic insight.
IMPORTANT: Always use the creator's stated pronouns throughout the narrative. If pronouns are 'not specified', use 'they/them' as a neutral default. Never assume pronouns.`;

  const userPrompt = `Generate a F.I.T. Score narrative report for the following match:
Creator: ${input.creatorHandle} (Archetype: ${input.creatorArchetype}, Pronouns: ${input.creatorPronouns ?? "not specified"})
Brand: ${input.brandName} (Archetype: ${input.brandArchetype})
F.I.T. Score: ${input.fitScore}/10 — ${input.fitStatus}
Alignment Score (α): ${input.alignmentRaw.toFixed(1)}/10
Pulse Score (β): ${input.pulseRaw.toFixed(1)}/10  
Stability Score (γ): ${input.stabilityRaw.toFixed(1)}/10
Radar Warnings: ${input.radarWarnings.length > 0 ? input.radarWarnings.join(", ") : "None"}
Creator Myth: ${input.creatorBarthesMyth}
Brand Myth: ${input.brandBarthesMyth}
Creator Audience Relationship: ${input.creatorAudienceRelationship}
Brand Audience Tribe: ${input.brandAudienceTribe}
Weight Priority: ${input.weightPriority}

Output a JSON object with:
{
  "narrativeSummary": "A 3-4 sentence executive summary of this match. Lead with the F.I.T. Score interpretation, explain the key cultural alignment or tension, and close with a strategic recommendation. Use precise sociological language (Symbolic Capital, Archetype compatibility, Barthesian myth alignment, etc.).",
  "alignmentNotes": {
    "archetypeAnalysis": "1-2 sentences on archetype compatibility or tension between ${input.creatorArchetype} and ${input.brandArchetype}.",
    "mythAlignment": "1-2 sentences on whether the creator and brand myths point to the same underlying cultural belief.",
    "audienceOverlap": "1-2 sentences on the psychographic overlap between the creator's audience and the brand's target tribe.",
    "culturalMomentum": "1-2 sentences on the niche's current cultural momentum and timing for brand activation.",
    "identityStability": "1-2 sentences on the creator's identity consistency and what it means for brand safety.",
    "recommendation": "1-2 sentences of concrete strategic recommendation — proceed, proceed with conditions, or do not proceed, and why."
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
