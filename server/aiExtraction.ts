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
  aiSummary: string;
}

export async function extractCreatorProfile(
  handleOrUrl: string,
  platform: string,
  evidenceSummary?: string  // Real scraped evidence from webResearch.ts
): Promise<CreatorExtractionResult> {
  const systemPrompt = `You are a cultural anthropologist and media analyst specializing in influencer marketing.
Your task is to analyze a social media creator and produce a structured cultural profile using the Connex F.I.T. framework.

CRITICAL INSTRUCTION — CONTENT OVER BIO:
You will receive REAL, SCRAPED evidence including the creator's bio AND their actual video titles/hashtags.
The bio is a SELF-REPORTED personal label. The video titles are OBJECTIVE CONTENT EVIDENCE.
You MUST prioritize the video titles and hashtags over the bio when determining the creator's niche and archetype.

Examples of correct behavior:
- Bio says "father of 5" but videos are all food reviews → classify as FOOD CREATOR, not family/parenting
- Bio says "entrepreneur" but videos are all comedy skits → classify as COMEDY CREATOR, not business
- Bio says "musician" and videos are music performances → classify as MUSICIAN (bio matches content)

NEVER let a personal bio override clear content evidence. The creator's professional identity is what they CREATE, not what they say about themselves in their bio.
Be rigorous, specific, and grounded in the video content evidence. Use the exact terminology specified.`;

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
  "recurringThemes": ["theme1", "theme2", "theme3"] (3-4 specific recurring content topics/formats),
  "toneRegister": "2-3 words describing their emotional register and communication style",
  "parasocialBondStrength": number between 1.0 and 5.0 (depth of audience emotional relationship),
  "audienceRelationshipType": "Friend" | "Mentor" | "Authority",
  "barthesMyth": "This creator makes it feel obvious that [complete the sentence with their core cultural myth]",
  "culturalCapital": "Produce" | "Relay" (do they produce original cultural content or relay/curate existing culture?),
  "goffmanStageConsistency": "Consistent" | "Minor Gap" | "Significant Gap" (how consistent is their persona across produced vs unscripted content?),
  "driftSignal": "Zero Change" | "Minor Drift" | "Significant Drift" | "Full Pivot" (identity/tone shift over last 6 months),
  "stuartHallDecoding": "Dominant" | "Negotiated" | "Oppositional" (how does their audience decode branded content?),
  "nicheTopicNode": "specific niche name (e.g. 'slow fitness' not 'fitness')",
  "undergroundDensity": true | false (is this niche still alive in tight non-mainstream communities?),
  "mainstreamBleed": true | false (is this niche crossing into mass media?),
  "remixRate": true | false (is the community reinterpreting/reinventing niche content?),
  "brandSaturation": true | false (have brands already activated in this niche?),
  "rogersAdopterStage": "Innovators" | "Early Adopters" | "Early Majority" | "Late Majority" | "Laggards" (where does this NICHE sit on the adoption curve?),
  "creatorNichePosition": "Ahead" | "Consistent" | "Behind" (where does THIS CREATOR sit relative to the niche?),
  "lifecyclePhase": "Emergence" | "Growth" | "Maturity" | "Decline" (current lifecycle phase of the niche),
  "barthesNicheMeaning": "This niche used to mean [X] — it is now starting to mean [Y]." OR "No meaning shift detected — core belief remains stable.",
  "turnerLiminalPhase": "Pre-Liminal" | "Liminal" | "Post-Liminal Reintegration" (is this niche community in identity transition?),
  "aiSummary": "A 2-3 sentence cultural analyst summary of this creator's symbolic position, cultural authority, and brand partnership potential."
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
            platform: { type: "string", enum: ["TikTok", "Instagram", "YouTube", "Multi"] },
            displayName: { type: "string" },
            archetype: { type: "string" },
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
          },
          required: [
            "handle", "platform", "displayName", "archetype", "recurringThemes",
            "toneRegister", "parasocialBondStrength", "audienceRelationshipType",
            "barthesMyth", "culturalCapital", "goffmanStageConsistency", "driftSignal",
            "stuartHallDecoding", "nicheTopicNode", "undergroundDensity", "mainstreamBleed",
            "remixRate", "brandSaturation", "rogersAdopterStage", "creatorNichePosition",
            "lifecyclePhase", "barthesNicheMeaning", "turnerLiminalPhase", "aiSummary"
          ],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from AI extraction");
  return JSON.parse(content as string) as CreatorExtractionResult;
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
  evidenceSummary?: string  // Real scraped evidence from webResearch.ts
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
    "Restaurant — QSR / Limited-Time Activation"
  ];

  const systemPrompt = `You are a brand strategist and cultural analyst specializing in influencer marketing.
Your task is to analyze a brand or business and produce a structured cultural profile using the Connex F.I.T. framework.
You will be provided with REAL, SCRAPED evidence from the brand's public website and web presence.
You MUST base your analysis on this evidence. Do NOT contradict the evidence.
If the evidence shows a local restaurant, analyze it as a local restaurant. If the evidence shows a luxury brand, analyze it as luxury.
Be rigorous, specific, and grounded in the provided evidence. Use the exact terminology specified.`;

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
            "audienceTribe", "culturalTension", "barthesMyth", "brandType", "campaignType", "aiSummary"
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
Your writing is sophisticated, uses the correct sociological terminology, and provides actionable strategic insight.`;

  const userPrompt = `Generate a F.I.T. Score narrative report for the following match:

Creator: ${input.creatorHandle} (Archetype: ${input.creatorArchetype})
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
