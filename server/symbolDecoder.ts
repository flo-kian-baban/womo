/**
 * Connex F.I.T. — Symbol Decoder
 *
 * Runs a dedicated LLM pass over ALL creator-authored text before the main
 * extraction call. Decodes language into structured cultural signals that map
 * directly onto the F.I.T. framework fields.
 *
 * Signal categories:
 *   IdentityClaims     → Archetype, NicheTopicNode
 *   StatusSignals      → CulturalCapital, RogersAdoptionStage
 *   CommunityReferences → ParasocialBondStrength, AudienceRelationshipType
 *   AspirationDrivers  → BarthesMyth, StuartHallDecoding
 */

import { invokeLLM } from "./_core/llm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DecodedSignal {
  /** The exact phrase or word from the creator's text */
  phrase: string;
  /** The cultural meaning decoded from that phrase */
  meaning: string;
  /** Which F.I.T. field(s) this signal informs */
  informs: string[];
}

export interface DecodedSymbols {
  /** Statements about who the creator is or who they represent */
  identityClaims: DecodedSignal[];
  /** Markers of cultural position, taste authority, or insider knowledge */
  statusSignals: DecodedSignal[];
  /** In-group language, shared assumptions, parasocial address patterns */
  communityReferences: DecodedSignal[];
  /** What the creator promises the audience will feel or become */
  aspirationDrivers: DecodedSignal[];
  /** One-sentence synthesis: the creator's core symbolic position */
  symbolicSummary: string;
}

// ─── Main Decoder ─────────────────────────────────────────────────────────────

/**
 * Decodes all creator-authored text into structured cultural signals.
 * Runs as a pre-processing step before the main AI extraction call.
 */
export async function decodeCreatorSymbols(input: {
  handle: string;
  bio: string;
  videoTitles: string[];
  hashtags: string[];
  transcriptExcerpts: string[];
}): Promise<DecodedSymbols | null> {
  const { handle, bio, videoTitles, hashtags, transcriptExcerpts } = input;

  // Build the text corpus — every word the creator authored
  const titlesBlock = videoTitles.length > 0
    ? `VIDEO TITLES / CAPTIONS (${videoTitles.length} sampled):\n${videoTitles.slice(0, 20).map((t, i) => `  ${i + 1}. ${t}`).join("\n")}`
    : "VIDEO TITLES: [none available]";

  const hashtagsBlock = hashtags.length > 0
    ? `HASHTAGS USED:\n  ${hashtags.slice(0, 20).join("  ")}`
    : "HASHTAGS: [none available]";

  const transcriptBlock = transcriptExcerpts.length > 0
    ? `SPOKEN TRANSCRIPT EXCERPTS (${transcriptExcerpts.length} videos — highest confidence):\n${transcriptExcerpts.slice(0, 5).map((t, i) => `  [Video ${i + 1}]: "${t.slice(0, 300)}"`).join("\n\n")}`
    : "SPOKEN TRANSCRIPTS: [none available]";

  const bioBlock = bio ? `BIO / SIGNATURE: "${bio}"` : "BIO: [not provided]";

  const corpus = `${bioBlock}\n\n${titlesBlock}\n\n${hashtagsBlock}\n\n${transcriptBlock}`;

  const systemPrompt = `You are a cultural semiotician and media anthropologist. Your job is to decode the symbolic language used by social media creators — not just what they talk about, but what their words reveal about their cultural identity, social position, and relationship with their audience.

You will receive all text authored by a creator: their bio, video titles, hashtags, and spoken transcript excerpts.

Your task is to identify four types of cultural signals embedded in this language:

1. IDENTITY CLAIMS — Phrases that assert who the creator is, who they represent, or what group they belong to.
   Examples: "the only halal guy in Toronto", "first-gen", "for the girls who...", "we don't do that here", "as a Muslim"
   These map to: Archetype, NicheTopicNode

2. STATUS SIGNALS — Phrases that position the creator as a taste authority, cultural gatekeeper, or insider.
   Examples: "you've never had shawarma until you've had this", "before it blows up", "the ones who know", "trust me on this one", "I found it first"
   These map to: CulturalCapital, RogersAdoptionStage, CreatorNichePosition

3. COMMUNITY REFERENCES — In-group language, shared assumptions, and parasocial address patterns that reveal the nature of the creator-audience bond.
   Examples: "you already know", "for us", "we get it", "I see you", "this one's for my people", "you deserve this"
   These map to: ParasocialBondStrength, AudienceRelationshipType, StuartHallDecoding

4. ASPIRATION DRIVERS — Phrases that promise the audience a feeling, transformation, or identity upgrade.
   Examples: "finally", "this changes everything", "the life you actually want", "you deserve better", "this is the one"
   These map to: BarthesMyth, StuartHallDecoding, AudienceRelationshipType

Be specific. Quote the actual phrase. Explain the cultural meaning. Be anthropologically precise.
If a signal category has no examples in the text, return an empty array — do not invent signals.`;

  const userPrompt = `Decode the following creator's language into structured cultural signals.

Creator: @${handle}

ALL CREATOR-AUTHORED TEXT:
${corpus}

Output a JSON object with EXACTLY this structure:
{
  "identityClaims": [
    { "phrase": "exact quote or paraphrase from text", "meaning": "what this reveals about the creator's cultural identity", "informs": ["Archetype", "NicheTopicNode"] }
  ],
  "statusSignals": [
    { "phrase": "exact quote or paraphrase", "meaning": "what cultural position this signal claims", "informs": ["CulturalCapital", "RogersAdoptionStage"] }
  ],
  "communityReferences": [
    { "phrase": "exact quote or paraphrase", "meaning": "what this reveals about the creator-audience bond", "informs": ["ParasocialBondStrength", "AudienceRelationshipType"] }
  ],
  "aspirationDrivers": [
    { "phrase": "exact quote or paraphrase", "meaning": "what emotional promise or identity upgrade this offers the audience", "informs": ["BarthesMyth", "StuartHallDecoding"] }
  ],
  "symbolicSummary": "One precise sentence: what is this creator's core symbolic position? What cultural identity do they embody and sell to their audience?"
}

Rules:
- Only include signals that are genuinely present in the text — do not invent examples
- Each array may have 0–6 items
- Quotes should be close to verbatim where possible; paraphrase only if the pattern is implicit
- The symbolicSummary must be specific and anthropologically grounded, not generic`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "decoded_symbols",
          strict: true,
          schema: {
            type: "object",
            properties: {
              identityClaims: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    phrase: { type: "string" },
                    meaning: { type: "string" },
                    informs: { type: "array", items: { type: "string" } },
                  },
                  required: ["phrase", "meaning", "informs"],
                  additionalProperties: false,
                },
              },
              statusSignals: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    phrase: { type: "string" },
                    meaning: { type: "string" },
                    informs: { type: "array", items: { type: "string" } },
                  },
                  required: ["phrase", "meaning", "informs"],
                  additionalProperties: false,
                },
              },
              communityReferences: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    phrase: { type: "string" },
                    meaning: { type: "string" },
                    informs: { type: "array", items: { type: "string" } },
                  },
                  required: ["phrase", "meaning", "informs"],
                  additionalProperties: false,
                },
              },
              aspirationDrivers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    phrase: { type: "string" },
                    meaning: { type: "string" },
                    informs: { type: "array", items: { type: "string" } },
                  },
                  required: ["phrase", "meaning", "informs"],
                  additionalProperties: false,
                },
              },
              symbolicSummary: { type: "string" },
            },
            required: ["identityClaims", "statusSignals", "communityReferences", "aspirationDrivers", "symbolicSummary"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.warn("[symbolDecoder] LLM returned no content");
      return null;
    }

    const decoded = JSON.parse(content as string) as DecodedSymbols;
    const totalSignals =
      decoded.identityClaims.length +
      decoded.statusSignals.length +
      decoded.communityReferences.length +
      decoded.aspirationDrivers.length;

    console.log(
      `[symbolDecoder] @${handle}: decoded ${totalSignals} signals ` +
      `(identity=${decoded.identityClaims.length}, status=${decoded.statusSignals.length}, ` +
      `community=${decoded.communityReferences.length}, aspiration=${decoded.aspirationDrivers.length})`
    );

    return decoded;
  } catch (err) {
    console.warn("[symbolDecoder] Decoding failed, continuing without decoded signals:", err);
    return null;
  }
}

// ─── Evidence Block Builder ───────────────────────────────────────────────────

/**
 * Formats decoded symbols into a structured evidence block for injection
 * into the main AI extraction evidence summary.
 */
export function formatDecodedSymbolsBlock(decoded: DecodedSymbols): string {
  const formatSignals = (signals: DecodedSignal[], label: string): string => {
    if (signals.length === 0) return `${label}: [none detected]`;
    return `${label}:\n${signals.map(s =>
      `  ▸ "${s.phrase}"\n    → ${s.meaning}\n    → Informs: ${s.informs.join(", ")}`
    ).join("\n")}`;
  };

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DECODED CULTURAL SIGNALS (pre-processed symbolic analysis)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SYMBOLIC SUMMARY: ${decoded.symbolicSummary}

${formatSignals(decoded.identityClaims, "IDENTITY CLAIMS (→ Archetype, NicheTopicNode)")}

${formatSignals(decoded.statusSignals, "STATUS SIGNALS (→ CulturalCapital, RogersAdoptionStage)")}

${formatSignals(decoded.communityReferences, "COMMUNITY REFERENCES (→ ParasocialBondStrength, AudienceRelationshipType)")}

${formatSignals(decoded.aspirationDrivers, "ASPIRATION DRIVERS (→ BarthesMyth, StuartHallDecoding)")}

⚠️  INSTRUCTION: The decoded signals above are pre-analyzed cultural evidence.
    You MUST use them to inform the following fields:
    - archetype: identity claims reveal the Jungian role the creator occupies
    - barthesMyth: aspiration drivers reveal the naturalized belief their content sells
    - audienceRelationshipType: community references reveal the bond type (Friend/Mentor/Authority)
    - parasocialBondStrength: community references confirm or refine the computed rate signal
    - nicheTopicNode: identity + status signals reveal the cultural function of the niche
    - stuartHallDecoding: aspiration drivers reveal how the audience is primed to receive brand messages
    - goffmanStageConsistency: compare identity claims in captions vs. transcripts for front/back stage gaps`.trim();
}
