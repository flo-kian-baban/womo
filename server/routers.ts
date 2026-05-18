import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  createCreatorProfile, getCreatorProfileById, listCreatorProfiles, deleteCreatorProfile,
  createBrandProfile, getBrandProfileById, listBrandProfiles, deleteBrandProfile,
  createMatchRecord, getMatchRecordById, listMatchRecords, deleteMatchRecord, getMatchWithProfiles,
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
        } catch (err) {
          console.warn("[brand.analyze] Web research failed, proceeding without evidence:", err);
        }

        // Step 2: AI extraction grounded in real evidence
        const extracted = await extractBrandProfile(input.brandNameOrUrl, brandEvidenceSummary);
        const weights = getBrandWeights(extracted.brandType);
        await createBrandProfile({
          brandName: extracted.brandName,
          brandUrl: input.brandNameOrUrl.startsWith("http") ? input.brandNameOrUrl : undefined,
          category: extracted.category,
          archetype: extracted.archetype,
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
        });

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
  }),

  // ─── Meta / Reference Data ──────────────────────────────────────────────────
  meta: router({
    archetypes: publicProcedure.query(() => ARCHETYPES),
    brandTypes: publicProcedure.query(() => Object.keys(BRAND_WEIGHT_TABLE)),
  }),
});

export type AppRouter = typeof appRouter;
