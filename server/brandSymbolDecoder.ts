/**
 * Connex F.I.T. — Brand Symbol Decoder
 *
 * Mirrors the creator-side symbolDecoder.ts pipeline.
 * Runs a dedicated LLM pass over ALL brand-authored text (website copy, taglines,
 * about pages, product descriptions) AND audience-authored text (Yelp + Google
 * reviews) before the main brand extraction call.
 *
 * Produces structured semantic artifacts that:
 *   1. Can be stored and compared against creator DecodedSymbols for alignment scoring
 *   2. Serve as a longitudinal signal store for trend analysis and post-campaign attribution
 *   3. Reveal the gap between brand self-presentation and audience decoding (Goffman)
 *
 * Signal categories (mirrored from creator side):
 *   identityClaims      → Archetype, BrandType, BrandArchetypeClassification
 *   statusSignals       → CulturalCapital, SymbolicPosition, BrandArchetypeClassification
 *   communityReferences → AudienceTribe, EmotionalPromise
 *   aspirationDrivers   → BarthesMyth, CulturalTension, EmotionalPromise
 *   audienceLanguage    → How customers actually decode the brand (Stuart Hall)
 *   rawKeywords         → Flat keyword list for trend tracking over time
 *   themeLabels         → 3–5 named content themes (LLM-translated from keywords)
 *   symbolicVocabulary  → The brand's own identity-signalling words and phrases
 *   symbolicSummary     → One-sentence synthesis of the brand's core symbolic position
 */

import { invokeLLM } from "./_core/llm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BrandDecodedSignal {
  /** The exact phrase, word, or pattern from the text */
  phrase: string;
  /** The cultural meaning decoded from that phrase */
  meaning: string;
  /** Which F.I.T. field(s) this signal informs */
  informs: string[];
  /** Source of the signal: brand-authored (website) or audience-authored (reviews) */
  source: "brand" | "audience";
}

export interface BrandDecodedSymbols {
  /** Statements about who the brand is, what it stands for, or what group it belongs to */
  identityClaims: BrandDecodedSignal[];
  /** Markers of cultural position, taste authority, premium positioning, or insider knowledge */
  statusSignals: BrandDecodedSignal[];
  /** In-group language, community address patterns, belonging cues */
  communityReferences: BrandDecodedSignal[];
  /** What the brand promises customers they will feel, become, or achieve */
  aspirationDrivers: BrandDecodedSignal[];
  /** How customers actually talk about the brand in reviews — their decoded meaning */
  audienceLanguage: BrandDecodedSignal[];
  /** Raw keyword list — all culturally significant words extracted from both text sources */
  rawKeywords: string[];
  /** 3–5 named content/value themes translated from the keyword set */
  themeLabels: string[];
  /** The brand's own identity-signalling vocabulary — words they use to signal who they are */
  symbolicVocabulary: string[];
  /** One-sentence synthesis: the brand's core symbolic position in culture */
  symbolicSummary: string;
}

// ─── Main Decoder ─────────────────────────────────────────────────────────────

/**
 * Decodes brand-authored and audience-authored text into structured cultural signals.
 * Runs as a pre-processing step before the main brand AI extraction call.
 */
export async function decodeBrandSymbols(input: {
  brandName: string;
  websiteText: string;
  reviewText: string;
}): Promise<BrandDecodedSymbols | null> {
  const { brandName, websiteText, reviewText } = input;

  // If no text at all, skip — caller already guards with combinedTextLength >= 80
  if (!websiteText && !reviewText) return null;

  // Label the website block appropriately — if it's short (likely fallback/review text), note the source
  const websiteBlockLabel = websiteText.length < 200 && reviewText.length > 0
    ? "AVAILABLE BRAND TEXT (limited direct website access — sourced from search results and review platforms):"
    : "BRAND-AUTHORED TEXT (website copy, taglines, about page, product descriptions):";

  const websiteBlock = websiteText
    ? `${websiteBlockLabel}\n${websiteText.slice(0, 3000)}`
    : "BRAND-AUTHORED TEXT: [website blocked or unavailable — decode from review text and brand name only]";

  const reviewBlock = reviewText
    ? `AUDIENCE-AUTHORED TEXT (Yelp + Google Maps reviews — how customers talk about this brand):\n${reviewText.slice(0, 2000)}`
    : "AUDIENCE-AUTHORED TEXT: [no reviews available]";

  const corpus = `${websiteBlock}\n\n${reviewBlock}`;

  const systemPrompt = `You are a cultural semiotician and brand anthropologist. Your job is to decode the symbolic language used by brands — not just what they sell, but what their words reveal about their cultural identity, social positioning, and relationship with their audience.

You will receive two types of text:
1. BRAND-AUTHORED TEXT: The words the brand uses to describe itself (website copy, taglines, about pages)
2. AUDIENCE-AUTHORED TEXT: The words customers use to describe the brand (reviews)

These two sources often tell different stories. Your job is to decode both.

Your task is to identify five types of cultural signals:

1. IDENTITY CLAIMS — Phrases that assert who the brand is, what it stands for, or what community it belongs to.
   Examples: "for the bold", "rooted in tradition", "built for the everyday hero", "where community comes first"
   These map to: Archetype, BrandType, BrandArchetypeClassification

2. STATUS SIGNALS — Phrases that position the brand as a taste authority, premium option, or cultural gatekeeper.
   Examples: "award-winning", "as seen in Vogue", "the choice of professionals", "before everyone else knew"
   These map to: CulturalCapital, SymbolicPosition, Bourdieu's Symbolic Capital

3. COMMUNITY REFERENCES — In-group language, belonging cues, and shared assumptions that reveal the brand's tribe.
   Examples: "our community", "for people who get it", "join the movement", "you already know"
   These map to: AudienceTribe, EmotionalPromise, ParasocialBond

4. ASPIRATION DRIVERS — Phrases that promise customers a feeling, transformation, or identity upgrade.
   Examples: "become your best self", "finally", "this changes everything", "you deserve this"
   These map to: BarthesMyth, CulturalTension, EmotionalPromise

5. AUDIENCE LANGUAGE — How customers actually talk about the brand in reviews. This is the Stuart Hall decoding layer — the gap between what the brand says and what the audience hears.
   Examples: "feels like home", "the only place I trust", "they get my community", "overpriced but worth it"
   These map to: AudienceTribe, GoffmanStageGap, StuartHallDecoding

Additionally, extract:
- rawKeywords: all culturally significant words and short phrases (nouns, adjectives, identity terms, value words) — flat list, no duplicates, 10–30 items
- themeLabels: 3–5 named themes that summarize what this brand is culturally about (e.g. "Local Pride", "Accessible Luxury", "Health as Identity")
- symbolicVocabulary: the specific words and phrases the brand uses to signal its identity — the words that would appear in a brand dictionary (5–15 items)
- symbolicSummary: one precise sentence synthesizing the brand's core symbolic position

Be specific. Quote actual phrases. Explain cultural meaning. Be anthropologically precise.
Mark each signal's source as "brand" (from website text) or "audience" (from reviews).`;

  const userPrompt = `Decode the following brand's language into structured cultural signals.

Brand: ${brandName}

ALL TEXT SOURCES:
${corpus}

Output a JSON object with EXACTLY this structure:
{
  "identityClaims": [
    { "phrase": "exact quote from text", "meaning": "what this reveals about the brand's cultural identity", "informs": ["Archetype", "BrandType"], "source": "brand" }
  ],
  "statusSignals": [
    { "phrase": "exact quote", "meaning": "what cultural position this signal claims", "informs": ["CulturalCapital", "SymbolicPosition"], "source": "brand" }
  ],
  "communityReferences": [
    { "phrase": "exact quote", "meaning": "what this reveals about the brand's tribe and belonging cues", "informs": ["AudienceTribe", "EmotionalPromise"], "source": "brand" }
  ],
  "aspirationDrivers": [
    { "phrase": "exact quote", "meaning": "what emotional promise or identity upgrade this offers customers", "informs": ["BarthesMyth", "CulturalTension"], "source": "brand" }
  ],
  "audienceLanguage": [
    { "phrase": "exact quote from review", "meaning": "how the audience actually decodes this brand — the gap between brand intent and customer experience", "informs": ["AudienceTribe", "GoffmanStageGap"], "source": "audience" }
  ],
  "rawKeywords": ["keyword1", "keyword2", "keyword3"],
  "themeLabels": ["Theme One", "Theme Two", "Theme Three"],
  "symbolicVocabulary": ["word1", "phrase2", "term3"],
  "symbolicSummary": "One precise sentence: what is this brand's core symbolic position? What cultural identity do they sell and to whom?"
}

Rules:
- Only include signals genuinely present in the text — do not invent examples
- Each signal array may have 0–6 items
- rawKeywords: 10–30 items, no duplicates, culturally significant only (skip generic words like "the", "and", "good")
- themeLabels: exactly 3–5 items, named as cultural themes not product categories
- symbolicVocabulary: 5–15 items, the brand's own identity-signalling words
- The symbolicSummary must be specific and anthropologically grounded, not generic`;

  try {
    const signalItemSchema = {
      type: "object" as const,
      properties: {
        phrase: { type: "string" as const },
        meaning: { type: "string" as const },
        informs: { type: "array" as const, items: { type: "string" as const } },
        source: { type: "string" as const, enum: ["brand", "audience"] },
      },
      required: ["phrase", "meaning", "informs", "source"] as string[],
      additionalProperties: false,
    };

    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "brand_decoded_symbols",
          strict: true,
          schema: {
            type: "object",
            properties: {
              identityClaims: { type: "array", items: signalItemSchema },
              statusSignals: { type: "array", items: signalItemSchema },
              communityReferences: { type: "array", items: signalItemSchema },
              aspirationDrivers: { type: "array", items: signalItemSchema },
              audienceLanguage: { type: "array", items: signalItemSchema },
              rawKeywords: { type: "array", items: { type: "string" } },
              themeLabels: { type: "array", items: { type: "string" } },
              symbolicVocabulary: { type: "array", items: { type: "string" } },
              symbolicSummary: { type: "string" },
            },
            required: [
              "identityClaims", "statusSignals", "communityReferences",
              "aspirationDrivers", "audienceLanguage",
              "rawKeywords", "themeLabels", "symbolicVocabulary", "symbolicSummary",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.warn("[brandSymbolDecoder] LLM returned no content");
      return null;
    }

    const decoded = JSON.parse(content as string) as BrandDecodedSymbols;
    const totalSignals =
      decoded.identityClaims.length +
      decoded.statusSignals.length +
      decoded.communityReferences.length +
      decoded.aspirationDrivers.length +
      decoded.audienceLanguage.length;

    console.log(
      `[brandSymbolDecoder] ${brandName}: decoded ${totalSignals} signals, ` +
      `${decoded.rawKeywords.length} keywords, ${decoded.themeLabels.length} themes ` +
      `(identity=${decoded.identityClaims.length}, status=${decoded.statusSignals.length}, ` +
      `community=${decoded.communityReferences.length}, aspiration=${decoded.aspirationDrivers.length}, ` +
      `audience=${decoded.audienceLanguage.length})`
    );

    return decoded;
  } catch (err) {
    console.warn("[brandSymbolDecoder] Decoding failed, continuing without decoded signals:", err);
    return null;
  }
}

// ─── Evidence Block Builder ───────────────────────────────────────────────────

/**
 * Formats brand decoded symbols into a structured evidence block for injection
 * into the main brand AI extraction evidence summary.
 * Mirrors formatDecodedSymbolsBlock() in symbolDecoder.ts.
 */
export function formatBrandDecodedSymbolsBlock(decoded: BrandDecodedSymbols): string {
  const formatSignals = (signals: BrandDecodedSignal[], label: string): string => {
    if (signals.length === 0) return `${label}: [none detected]`;
    return `${label}:\n${signals.map(s =>
      `  ▸ "${s.phrase}" [${s.source}]\n    → ${s.meaning}\n    → Informs: ${s.informs.join(", ")}`
    ).join("\n")}`;
  };

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRAND DECODED CULTURAL SIGNALS (pre-processed symbolic analysis)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SYMBOLIC SUMMARY: ${decoded.symbolicSummary}

THEME LABELS: ${decoded.themeLabels.join(" · ")}
SYMBOLIC VOCABULARY: ${decoded.symbolicVocabulary.join(", ")}
RAW KEYWORDS: ${decoded.rawKeywords.join(", ")}

${formatSignals(decoded.identityClaims, "IDENTITY CLAIMS (→ Archetype, BrandType)")}

${formatSignals(decoded.statusSignals, "STATUS SIGNALS (→ CulturalCapital, SymbolicPosition)")}

${formatSignals(decoded.communityReferences, "COMMUNITY REFERENCES (→ AudienceTribe, EmotionalPromise)")}

${formatSignals(decoded.aspirationDrivers, "ASPIRATION DRIVERS (→ BarthesMyth, CulturalTension)")}

${formatSignals(decoded.audienceLanguage, "AUDIENCE LANGUAGE — Stuart Hall Decoding Layer (→ GoffmanStageGap, AudienceTribe)")}

⚠️  INSTRUCTION: The decoded signals above are pre-analyzed cultural evidence.
    You MUST use them to inform the following fields:
    - archetype: identity claims reveal the Jungian role the brand occupies
    - barthesMyth: aspiration drivers reveal the naturalized belief the brand sells
    - audienceTribe: community references + audience language reveal the actual tribe
    - emotionalPromise: aspiration drivers + community references reveal the core promise
    - culturalTension: the gap between identity claims and audience language reveals the tension
    - brandArchetypeClassification: status signals + identity claims confirm Trust/Community/Momentum
    - aiSummary: use symbolicSummary as the foundation`.trim();
}
