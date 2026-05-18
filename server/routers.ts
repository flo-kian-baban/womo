import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  createCreatorProfile, getCreatorProfileById, listCreatorProfiles, deleteCreatorProfile,
  createBrandProfile, getBrandProfileById, listBrandProfiles, deleteBrandProfile,
  createMatchRecord, getMatchRecordById, listMatchRecords, deleteMatchRecord, getMatchWithProfiles,
  getComparablePartnerships,
} from "./db";
import { extractCreatorProfile, extractBrandProfile, generateFITNarrative } from "./aiExtraction";
import { runFullFITCalculation, getBrandWeights, BRAND_WEIGHT_TABLE, ARCHETYPES } from "./fitEngine";
import { invokeLLM } from "./_core/llm";
import { researchCreator, researchBrand } from "./webResearch";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Creator Routes ─────────────────────────────────────────────────────────
  creator: router({
    analyze: publicProcedure
      .input(z.object({
        handleOrUrl: z.string().min(1),
        platform: z.enum(["TikTok", "YouTube", "Multi"]), // Instagram removed from UI
      }))
      .mutation(async ({ input }) => {
        // Step 1: Gather real evidence from the platform before AI analysis
        let evidenceSummary: string | undefined;
        let researchedProfileUrl: string | undefined;
        let researchData: {
          followerCount?: number; totalLikes?: number; videoCount?: number;
          totalViews?: number; avgViews?: number; engagementRate?: number;
          location?: string; rawKeywords?: string[]; contentThemeLabels?: string[];
          topHashtags?: string[]; recentVideoTitles?: string[];
          transcriptCount?: number; transcriptExcerpts?: string;
          decodedSymbols?: Record<string, unknown>;
        } | undefined;
        // Research layer throws TRPCError for insufficient data — let it propagate to the client
        const research = await researchCreator(input.handleOrUrl, input.platform);
        evidenceSummary = research.evidenceSummary;
        researchedProfileUrl = research.profileUrl;
        researchData = {
          followerCount: research.followerCount || undefined,
          totalLikes: research.totalLikes || undefined,
          videoCount: research.videoCount || undefined,
          totalViews: research.totalViews || undefined,
          avgViews: research.avgViews || undefined,
          engagementRate: research.engagementRate || undefined,
          location: research.location || undefined,
          rawKeywords: research.rawKeywords?.length ? research.rawKeywords : undefined,
          contentThemeLabels: research.contentThemeLabels?.length ? research.contentThemeLabels : undefined,
          topHashtags: research.topHashtags?.length ? research.topHashtags : undefined,
          recentVideoTitles: research.recentVideoTitles?.length ? research.recentVideoTitles : undefined,
          transcriptCount: research.transcriptCount ?? 0,
          transcriptExcerpts: research.transcriptExcerpts || undefined,
          decodedSymbols: research.decodedSymbols ?? undefined,
        };

        // Step 2: AI extraction grounded in real evidence
        const extracted = await extractCreatorProfile(input.handleOrUrl, input.platform, evidenceSummary);
        const weights = getBrandWeights("Retail — Local Boutique"); // default, not used here
        const insertResult = await createCreatorProfile({
          handle: extracted.handle,
          platform: extracted.platform,
          profileUrl: researchedProfileUrl ?? (input.handleOrUrl.startsWith("http") ? input.handleOrUrl : undefined),
          displayName: extracted.displayName,
          archetype: extracted.archetype,
          recurringThemes: extracted.recurringThemes,
          toneRegister: extracted.toneRegister,
          parasocialBondStrength: extracted.parasocialBondStrength,
          audienceRelationshipType: extracted.audienceRelationshipType,
          barthesMyth: extracted.barthesMyth,
          culturalCapital: extracted.culturalCapital,
          goffmanStageConsistency: extracted.goffmanStageConsistency,
          driftSignal: extracted.driftSignal,
          stuartHallDecoding: extracted.stuartHallDecoding,
          nicheTopicNode: extracted.nicheTopicNode,
          undergroundDensity: extracted.undergroundDensity,
          mainstreamBleed: extracted.mainstreamBleed,
          remixRate: extracted.remixRate,
          brandSaturation: extracted.brandSaturation,
          rogersAdopterStage: extracted.rogersAdopterStage,
          creatorNichePosition: extracted.creatorNichePosition,
          lifecyclePhase: extracted.lifecyclePhase,
          barthesNicheMeaning: extracted.barthesNicheMeaning,
          turnerLiminalPhase: extracted.turnerLiminalPhase,
          pronouns: extracted.pronouns,
          aiSummary: extracted.aiSummary,
          rawAiResponse: extracted as unknown as Record<string, unknown>,
          // Research metrics from platform APIs
          followerCount: researchData?.followerCount ?? undefined,
          totalLikes: researchData?.totalLikes ?? undefined,
          videoCount: researchData?.videoCount ?? undefined,
          totalViews: researchData?.totalViews ?? undefined,
          avgViews: researchData?.avgViews ?? undefined,
          engagementRate: researchData?.engagementRate ?? undefined,
          location: researchData?.location ?? undefined,
          rawKeywords: researchData?.rawKeywords ?? undefined,
          contentThemeLabels: researchData?.contentThemeLabels ?? undefined,
          topHashtags: researchData?.topHashtags ?? undefined,
          recentVideoTitles: researchData?.recentVideoTitles ?? undefined,
          transcriptCount: researchData?.transcriptCount ?? 0,
          transcriptExcerpts: researchData?.transcriptExcerpts ?? undefined,
          decodedSymbols: researchData?.decodedSymbols ?? undefined,
        });
        // Get the inserted ID
        const profiles = await listCreatorProfiles(undefined, extracted.handle);
        const saved = profiles[0];
        return { profile: saved, extracted };
      }),

    list: publicProcedure
      .input(z.object({ search: z.string().optional() }))
      .query(async ({ input }) => {
        return listCreatorProfiles(undefined, input.search);
      }),

    get: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const profile = await getCreatorProfileById(input.id);
        if (!profile) throw new Error("Creator profile not found");
        return profile;
      }),

    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteCreatorProfile(input.id);
        return { success: true };
      }),
  }),

  // ─── Brand Routes ───────────────────────────────────────────────────────────
  brand: router({
    analyze: publicProcedure
      .input(z.object({ brandNameOrUrl: z.string().min(1) }))
      .mutation(async ({ input }) => {
        // Step 1: Gather real evidence from the brand's website/web presence + review data
        let brandEvidenceSummary: string | undefined;
        let reviewFields: {
          yelpRating?: number | null;
          yelpReviewCount?: number | null;
          yelpReviewExcerpts?: string;
          googleRating?: number | null;
          googleReviewCount?: number | null;
          googleReviewExcerpts?: string;
          combinedReviewText?: string;
          overallRating?: number | null;
          totalReviews?: number;
        } = {};
        let symbolFields: {
          brandRawKeywords?: string[];
          brandThemeLabels?: string[];
          brandSymbolicVocabulary?: string[];
          brandDecodedSymbols?: Record<string, unknown>;
        } = {};
        try {
          const brandResearch = await researchBrand(input.brandNameOrUrl);
          brandEvidenceSummary = brandResearch.evidenceSummary;
          reviewFields = {
            yelpRating: brandResearch.yelpRating,
            yelpReviewCount: brandResearch.yelpReviewCount,
            yelpReviewExcerpts: brandResearch.yelpReviewExcerpts || undefined,
            googleRating: brandResearch.googleRating,
            googleReviewCount: brandResearch.googleReviewCount,
            googleReviewExcerpts: brandResearch.googleReviewExcerpts || undefined,
            combinedReviewText: brandResearch.combinedReviewText || undefined,
            overallRating: brandResearch.overallRating,
            totalReviews: brandResearch.totalReviews,
          };
          // Brand Symbol Decoder fields
          if (brandResearch.brandDecodedSymbols) {
            symbolFields = {
              brandRawKeywords: brandResearch.brandRawKeywords,
              brandThemeLabels: brandResearch.brandThemeLabels,
              brandSymbolicVocabulary: brandResearch.brandSymbolicVocabulary,
              brandDecodedSymbols: brandResearch.brandDecodedSymbols as unknown as Record<string, unknown>,
            };
          }
        } catch (err) {
          console.warn("[brand.analyze] Web research failed, proceeding without evidence:", err);
        }

        // Step 2: AI extraction grounded in real evidence
        const extracted = await extractBrandProfile(input.brandNameOrUrl, brandEvidenceSummary);
        // Apply campaign modifier (Rule 5) when campaignType is Long-Term Ambassador or Product Launch
        const weights = getBrandWeights(extracted.brandType, extracted.campaignType);
        await createBrandProfile({
          brandName: extracted.brandName,
          brandUrl: input.brandNameOrUrl.startsWith("http") ? input.brandNameOrUrl : undefined,
          category: extracted.category,
          archetype: extracted.archetype,
          brandArchetypeClassification: extracted.brandArchetypeClassification,
          emotionalPromise: extracted.emotionalPromise,
          visualLanguage: extracted.visualLanguage,
          audienceTribe: extracted.audienceTribe,
          culturalTension: extracted.culturalTension,
          barthesMyth: extracted.barthesMyth,
          brandType: extracted.brandType,
          campaignType: extracted.campaignType,
          weightAlpha: weights.alpha,
          weightBeta: weights.beta,
          weightGamma: weights.gamma,
          weightPriority: weights.priority,
          ...reviewFields,
          ...symbolFields,
          aiSummary: extracted.aiSummary,
          rawAiResponse: extracted as unknown as Record<string, unknown>,
        });
        const profiles = await listBrandProfiles(undefined, extracted.brandName);
        const saved = profiles[0];
        return { profile: saved, extracted, weights };
      }),

    list: publicProcedure
      .input(z.object({ search: z.string().optional() }))
      .query(async ({ input }) => {
        return listBrandProfiles(undefined, input.search);
      }),

    get: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const profile = await getBrandProfileById(input.id);
        if (!profile) throw new Error("Brand profile not found");
        return profile;
      }),

    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteBrandProfile(input.id);
        return { success: true };
      }),

    weightTable: publicProcedure.query(() => {
      return Object.entries(BRAND_WEIGHT_TABLE).map(([type, weights]) => ({
        type,
        ...weights,
      }));
    }),
  }),

  // ─── F.I.T. Score Routes ────────────────────────────────────────────────────
  fit: router({
    calculate: publicProcedure
      .input(z.object({
        creatorProfileId: z.number(),
        brandProfileId: z.number(),
      }))
      .mutation(async ({ input }) => {
        const creator = await getCreatorProfileById(input.creatorProfileId);
        const brand = await getBrandProfileById(input.brandProfileId);
        if (!creator) throw new Error("Creator profile not found");
        if (!brand) throw new Error("Brand profile not found");

        // ── Derive myth alignment score from Barthes myth sentence overlap ──
        // Both profiles carry a barthesMyth field extracted by the AI.
        // We compute a heuristic score (0–10) by asking the LLM to compare them.
        // Fallback: 5 (neutral) if either field is missing.
        let mythAlignmentScore = 5;
        let tribMatchScore = 5;

        if (creator.barthesMyth && brand.barthesMyth) {
          try {
            const mythResponse = await invokeLLM({
              messages: [
                {
                  role: "system",
                  content: `You are a cultural semiotics analyst scoring the mythological alignment between a creator and a brand.

Creator Barthes Myth: "${creator.barthesMyth}"
Brand Barthes Myth: "${brand.barthesMyth}"
Creator Audience Relationship: "${creator.audienceRelationshipType ?? ""}"
Brand Audience Tribe: "${brand.audienceTribe ?? ""}"
Creator Cultural Capital: "${creator.culturalCapital ?? ""}"
Brand Cultural Tension: "${brand.culturalTension ?? ""}"

Score 1: mythAlignmentScore (0–10) — How closely do the creator's and brand's mythological narratives align? Same symbolic territory = 10, completely opposed = 1.
Score 2: tribMatchScore (0–10) — How well does the creator's audience relationship type match the brand's target tribe? Perfect match = 10, mismatch = 1.

Return ONLY valid JSON: {"mythAlignmentScore": <number>, "tribMatchScore": <number>}`,
                },
                { role: "user", content: "Score the alignment." },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "myth_trib_scores",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: {
                      mythAlignmentScore: { type: "number" },
                      tribMatchScore: { type: "number" },
                    },
                    required: ["mythAlignmentScore", "tribMatchScore"],
                    additionalProperties: false,
                  },
                },
              },
            });
            const parsed = JSON.parse(mythResponse.choices[0]?.message?.content as string);
            mythAlignmentScore = Math.min(10, Math.max(0, Number(parsed.mythAlignmentScore) || 5));
            tribMatchScore = Math.min(10, Math.max(0, Number(parsed.tribMatchScore) || 5));
          } catch {
            // Fallback to neutral if LLM call fails
            mythAlignmentScore = 5;
            tribMatchScore = 5;
          }
        }

        // Extract symbolic vocabulary arrays for overlap calculation
        const creatorDecodedSymbols = creator.decodedSymbols as Record<string, unknown> | null;
        const brandDecodedSymbols = brand.brandDecodedSymbols as Record<string, unknown> | null;
        const creatorKeywords = (creator.rawKeywords as string[] | null) ?? [];
        const creatorThemes = (creator.contentThemeLabels as string[] | null) ?? [];
        const brandKeywords = (brand.brandRawKeywords as string[] | null) ?? [];
        const brandThemes = (brand.brandThemeLabels as string[] | null) ?? [];

        // Also pull from decodedSymbols if rawKeywords are sparse
        if (creatorDecodedSymbols) {
          const dsKeywords = creatorDecodedSymbols.rawKeywords as string[] | undefined;
          if (dsKeywords?.length) creatorKeywords.push(...dsKeywords);
        }
        if (brandDecodedSymbols) {
          const dsKeywords = brandDecodedSymbols.rawKeywords as string[] | undefined;
          if (dsKeywords?.length) brandKeywords.push(...dsKeywords);
        }

        // Run the F.I.T. engine
        const result = runFullFITCalculation({
          creatorArchetype: creator.archetype ?? "The Everyman",
          goffmanStageConsistency: creator.goffmanStageConsistency ?? "Consistent",
          driftSignal: creator.driftSignal ?? "Zero Change",
          stuartHallDecoding: creator.stuartHallDecoding ?? "Dominant",
          rogersAdopterStage: creator.rogersAdopterStage ?? "Early Majority",
          turnerLiminalPhase: creator.turnerLiminalPhase ?? "Pre-Liminal",
          creatorNichePosition: creator.creatorNichePosition ?? "Consistent",
          brandArchetype: brand.archetype ?? "The Everyman",
          brandType: brand.brandType ?? "Retail — Local Boutique",
          mythAlignmentScore,
          tribMatchScore,
          creatorKeywords,
          creatorThemes,
          brandKeywords,
          brandThemes,
        });

        // Generate Synergy Narrative + Content Directions
        let synergyNarrative = "";
        let contentDirections: Array<{ title: string; rationale: string; exampleAngle: string }> = [];
        try {
          const synergyResponse = await invokeLLM({
            messages: [
              {
                role: "system",
                content: `You are a senior influencer marketing strategist and cultural semiotician at Connex.
Your job is to write a concise, insight-rich F.I.T. Synergy Brief for a proposed creator-brand partnership.
This brief must be grounded in the cultural data provided — not generic marketing language.

CREATOR PROFILE:
- Handle: @${creator.handle}
- Archetype: ${creator.archetype ?? "Unknown"}
- Barthes Myth: ${creator.barthesMyth ?? "Not available"}
- Audience Relationship: ${creator.audienceRelationshipType ?? "Unknown"}
- Cultural Capital: ${creator.culturalCapital ?? "Unknown"}
- Recurring Themes: ${(creator.recurringThemes as string[] | null)?.join(", ") ?? "Not available"}
- Content Themes: ${creatorThemes.join(", ") || "Not available"}
- Top Keywords: ${creatorKeywords.slice(0, 15).join(", ") || "Not available"}
- Decoded Symbols Summary: ${creatorDecodedSymbols ? JSON.stringify(creatorDecodedSymbols).slice(0, 400) : "Not available"}

BRAND PROFILE:
- Brand: ${brand.brandName}
- Archetype: ${brand.archetype ?? "Unknown"}
- Barthes Myth: ${brand.barthesMyth ?? "Not available"}
- Audience Tribe: ${brand.audienceTribe ?? "Unknown"}
- Cultural Tension: ${brand.culturalTension ?? "Not available"}
- Brand Type: ${brand.brandType ?? "Unknown"}
- Brand Archetype Classification: ${brand.brandArchetypeClassification ?? "Unknown"}
- Brand Themes: ${brandThemes.join(", ") || "Not available"}
- Brand Keywords: ${brandKeywords.slice(0, 15).join(", ") || "Not available"}
- Brand Decoded Symbols Summary: ${brandDecodedSymbols ? JSON.stringify(brandDecodedSymbols).slice(0, 400) : "Not available"}

SHARED SYMBOLIC VOCABULARY:
- Shared Keywords: ${result.sharedKeywords.join(", ") || "None detected"}
- Shared Themes: ${result.sharedThemes.join(", ") || "None detected"}
- Symbolic Overlap Score: ${result.symbolicOverlapScore}/10

F.I.T. SCORES:
- F.I.T. Score: ${result.fitScore}/10 (${result.fitStatus})
- Verified F.I.T. Impressions Score: ${result.verifiedFITScore}/100 (${result.verifiedFITLabel})
- Alignment: ${result.alignmentScoreRaw.toFixed(1)}/10 | Pulse: ${result.pulseScoreRaw.toFixed(1)}/10 | Stability: ${result.stabilityScoreRaw.toFixed(1)}/10

Write the following in JSON format:
1. synergyNarrative (string, 150–250 words): A plain-language cultural compatibility brief. Cover: (a) why this partnership makes symbolic sense, (b) what shared cultural territory they occupy, (c) what the audience will feel when they see this collaboration. Use the sociological terminology from the data (archetypes, Barthes myth, symbolic vocabulary) but translate it into strategic insight, not academic jargon.
2. contentDirections (array of 3–5 objects): Specific content directions grounded in the shared symbolic vocabulary. Each must have: title (short, punchy), rationale (1 sentence explaining why it works culturally), exampleAngle (1 concrete example post/video concept).`,
              },
              { role: "user", content: "Generate the synergy brief and content directions." },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "synergy_brief",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    synergyNarrative: { type: "string" },
                    contentDirections: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          title: { type: "string" },
                          rationale: { type: "string" },
                          exampleAngle: { type: "string" },
                        },
                        required: ["title", "rationale", "exampleAngle"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["synergyNarrative", "contentDirections"],
                  additionalProperties: false,
                },
              },
            },
          });
          const synergyParsed = JSON.parse(synergyResponse.choices[0]?.message?.content as string);
          synergyNarrative = synergyParsed.synergyNarrative ?? "";
          contentDirections = synergyParsed.contentDirections ?? [];
        } catch (err) {
          console.warn("[routers] Synergy narrative generation failed (non-fatal):", err);
        }

        // Generate narrative
        const narrative = await generateFITNarrative({
          creatorHandle: creator.handle,
          brandName: brand.brandName,
          fitScore: result.fitScore,
          fitStatus: result.fitStatus,
          alignmentRaw: result.alignmentScoreRaw,
          pulseRaw: result.pulseScoreRaw,
          stabilityRaw: result.stabilityScoreRaw,
          radarWarnings: result.radarWarnings,
          creatorArchetype: creator.archetype ?? "",
          brandArchetype: brand.archetype ?? "",
          creatorBarthesMyth: creator.barthesMyth ?? "",
          brandBarthesMyth: brand.barthesMyth ?? "",
          creatorAudienceRelationship: creator.audienceRelationshipType ?? "",
          brandAudienceTribe: brand.audienceTribe ?? "",
          weightPriority: result.weightPriority,
          creatorPronouns: creator.pronouns ?? "not specified",
        });

        // Save match record
        await createMatchRecord({
          creatorProfileId: input.creatorProfileId,
          brandProfileId: input.brandProfileId,
          alignmentScoreRaw: result.alignmentScoreRaw,
          pulseScoreRaw: result.pulseScoreRaw,
          stabilityScoreRaw: result.stabilityScoreRaw,
          archetypeMatchScore: result.archetypeMatchScore,
          mythAlignmentScore: result.mythAlignmentScore,
          tribMatchScore: result.tribMatchScore,
          decodingModifier: result.decodingModifier,
          rogersBaseScore: result.rogersBaseScore,
          liminalAdjustment: result.liminalAdjustment,
          goffmanScore: result.goffmanScore,
          driftScore: result.driftScore,
          weightAlpha: result.weightAlpha,
          weightBeta: result.weightBeta,
          weightGamma: result.weightGamma,
          fitScore: result.fitScore,
          fitStatus: result.fitStatus,
          radarWarnings: result.radarWarnings,
          narrativeSummary: narrative.narrativeSummary,
          alignmentNotes: narrative.alignmentNotes as unknown as Record<string, unknown>,
          // Verified F.I.T. Impressions Score
          verifiedFITScore: result.verifiedFITScore,
          verifiedFITLabel: result.verifiedFITLabel,
          verifiedFITSignalBreakdown: result.verifiedFITSignalBreakdown as unknown as Record<string, unknown>,
          symbolicOverlapScore: result.symbolicOverlapScore,
          sharedKeywords: result.sharedKeywords as unknown as string[],
          sharedThemes: result.sharedThemes as unknown as string[],
          // Synergy Narrative + Content Directions
          synergyNarrative: synergyNarrative || null,
          contentDirections: contentDirections.length > 0 ? contentDirections as unknown as Record<string, unknown>[] : null,
        });

        const matches = await listMatchRecords();
        const saved = matches[0];

        return {
          match: saved,
          creator,
          brand,
          result,
          narrative,
        };
      }),

    get: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getMatchWithProfiles(input.id);
      }),

    list: publicProcedure.query(async () => {
      return listMatchRecords();
    }),

    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteMatchRecord(input.id);
        return { success: true };
      }),

    comparable: publicProcedure
      .input(z.object({
        matchId: z.number(),
        brandType: z.string().optional(),
        brandArchetypeClassification: z.string().optional(),
        creatorArchetype: z.string().optional(),
        creatorNicheTopicNode: z.string().optional(),
      }))
      .query(async ({ input }) => {
        return getComparablePartnerships({
          excludeMatchId: input.matchId,
          brandType: input.brandType,
          brandArchetypeClassification: input.brandArchetypeClassification,
          creatorArchetype: input.creatorArchetype,
          creatorNicheTopicNode: input.creatorNicheTopicNode,
        });
      }),
  }),

  // ─── Meta / Reference Data ──────────────────────────────────────────────────
  meta: router({
    archetypes: publicProcedure.query(() => ARCHETYPES),
    brandTypes: publicProcedure.query(() => Object.keys(BRAND_WEIGHT_TABLE)),
  }),
});

export type AppRouter = typeof appRouter;
