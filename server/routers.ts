import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  createCreatorProfile, getCreatorProfileById, listCreatorProfiles, deleteCreatorProfile, updateCreatorProfile,
  createBrandProfile, getBrandProfileById, listBrandProfiles, deleteBrandProfile, updateBrandProfile,
  createMatchRecord, getMatchRecordById, listMatchRecords, deleteMatchRecord, getMatchWithProfiles,
  getComparablePartnerships,
} from "./db";
import { extractCreatorProfile, extractBrandProfile, generateFITNarrative } from "./aiExtraction";
import { runFullFITCalculation, getBrandWeights, BRAND_WEIGHT_TABLE, ARCHETYPES } from "./fitEngine";
import { calculateAllSignals } from "./performanceSignals";
import { invokeLLM } from "./_core/llm";
import { researchCreator, researchBrand } from "./webResearch";
import { analyzeBrandTikTokChannel, formatBrandTikTokEvidenceBlock, type BrandTikTokMetadata } from "./brandTikTokAnalysis";
import { createBulkCreatorJob, createBulkBrandJob, getJob, markJobProcessing, markJobCompleted, recordJobError, updateJobResult, updateJobProgress } from "./bulkAnalysisJobs";

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
          culturalVelocity?: string;
          dataConfidenceLevel?: string;
          longitudinalSampleJson?: Record<string, unknown>;
          discoveredVideoPoolJson?: Array<{ id: string; url: string; caption: string; createTime: number }>;
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
          culturalVelocity: research.culturalVelocity ?? undefined,
          dataConfidenceLevel: research.dataConfidenceLevel ?? undefined,
          longitudinalSampleJson: research.longitudinalSample as unknown as Record<string, unknown> ?? undefined,
          discoveredVideoPoolJson: research.discoveredVideoPool?.length ? research.discoveredVideoPool : undefined,
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
          culturalVelocity: researchData?.culturalVelocity ?? undefined,
          dataConfidenceLevel: researchData?.dataConfidenceLevel ?? undefined,
          longitudinalSampleJson: researchData?.longitudinalSampleJson ?? undefined,
          discoveredVideoPoolJson: researchData?.discoveredVideoPoolJson as unknown as Record<string, unknown> ?? undefined,
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

    reanalyze: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const existing = await getCreatorProfileById(input.id);
        if (!existing) throw new Error("Creator profile not found");

        let evidenceSummary = "";
        let researchedProfileUrl: string | undefined;
        let researchData: any = {};

        try {
          const research = await researchCreator(existing.profileUrl || existing.handle, existing.platform as any);
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
            culturalVelocity: research.culturalVelocity ?? undefined,
            dataConfidenceLevel: research.dataConfidenceLevel ?? undefined,
            longitudinalSampleJson: research.longitudinalSample as unknown as Record<string, unknown> ?? undefined,
            discoveredVideoPoolJson: research.discoveredVideoPool?.length ? research.discoveredVideoPool : undefined,
          };
        } catch (err) {
          console.warn("[creator.reanalyze] Web research failed, proceeding without evidence:", err);
        }

        const extracted = await extractCreatorProfile(existing.profileUrl || existing.handle, existing.platform as any, evidenceSummary);

        await updateCreatorProfile(input.id, {
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
          culturalVelocity: researchData?.culturalVelocity ?? undefined,
          dataConfidenceLevel: researchData?.dataConfidenceLevel ?? undefined,
          longitudinalSampleJson: researchData?.longitudinalSampleJson ?? undefined,
          discoveredVideoPoolJson: researchData?.discoveredVideoPoolJson as unknown as Record<string, unknown> ?? undefined,
          updatedAt: new Date(),
        });

        const updated = await getCreatorProfileById(input.id);
        return { profile: updated, extracted };
      }),

    // ─── Supplemental Video Ingestion ─────────────────────────────────────────
    // Fetches transcript for a single TikTok video URL and appends it to the
    // creator profile's transcript pool, then updates the profile's data.
    ingestSupplementalVideo: publicProcedure
      .input(z.object({
        creatorProfileId: z.number(),
        videoUrl: z.string().url(),
        videoId: z.string(),
        caption: z.string().default(""),
      }))
      .mutation(async ({ input }) => {
        const { fetchSingleTikTokTranscript } = await import("./webResearch");
        const profile = await getCreatorProfileById(input.creatorProfileId);
        if (!profile) throw new Error("Creator profile not found");

        // Fetch transcript for this specific video
        const transcript = await fetchSingleTikTokTranscript(input.videoUrl, input.videoId, input.caption);

        // Always remove this video from the pool (whether or not we got a transcript)
        const currentPool = (profile.discoveredVideoPoolJson as Array<{ id: string; url: string; caption: string; createTime: number }> | null) ?? [];
        const updatedPool = currentPool.filter(v => v.id !== input.videoId);

        if (!transcript) {
          // No captions available — remove from pool so user doesn't retry indefinitely
          await updateCreatorProfile(input.creatorProfileId, {
            discoveredVideoPoolJson: updatedPool as unknown as Record<string, unknown>,
          });
          return {
            success: false,
            noCaptions: true,
            videoId: input.videoId,
            transcriptWordCount: 0,
            newTranscriptCount: profile.transcriptCount ?? 0,
            newDataConfidence: (profile.dataConfidenceLevel ?? "low") as "high" | "medium" | "low",
            transcriptExcerpt: "",
          };
        }

        // Append to existing transcript excerpts
        const existingExcerpts = profile.transcriptExcerpts ?? "";
        const newExcerpt = `[${input.caption.slice(0, 40) || "video"}]: ${transcript.transcript.slice(0, 200)}`;
        const updatedExcerpts = existingExcerpts
          ? `${existingExcerpts}\n\n${newExcerpt}`
          : newExcerpt;

        // Update transcript count and excerpts
        const newCount = (profile.transcriptCount ?? 0) + 1;
        const newConfidence: "high" | "medium" | "low" =
          newCount >= 6 ? "high" : newCount >= 3 ? "medium" : "low";

        await updateCreatorProfile(input.creatorProfileId, {
          transcriptCount: newCount,
          transcriptExcerpts: updatedExcerpts,
          dataConfidenceLevel: newConfidence,
          discoveredVideoPoolJson: updatedPool as unknown as Record<string, unknown>,
        });

        return {
          success: true,
          noCaptions: false,
          videoId: input.videoId,
          transcriptWordCount: transcript.wordCount,
          newTranscriptCount: newCount,
          newDataConfidence: newConfidence,
          transcriptExcerpt: transcript.transcript.slice(0, 300),
        };
      }),
  }),


    bulkAnalyze: publicProcedure
      .input(z.object({
        handles: z.array(z.string().min(1)),
        platform: z.enum(["TikTok", "YouTube", "Multi"]),
      }))
      .mutation(async ({ input }) => {
        // Create a bulk job
        const job = createBulkCreatorJob(input.handles, input.platform);
        
        // Start processing in background (non-blocking)
        // In production, this would be queued to a job processor
        (async () => {
          markJobProcessing(job.jobId);
          
          for (let i = 0; i < input.handles.length; i++) {
            try {
              const handle = input.handles[i];
              // Call the regular analyze endpoint
              const research = await researchCreator(handle, input.platform);
              const extracted = await extractCreatorProfile(handle, input.platform, research.evidenceSummary);
              
              const result = await createCreatorProfile({
                handle: handle,
                platform: input.platform,
                profileUrl: research.profileUrl ?? "",
                archetype: extracted.archetype ?? "The Everyman",
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
                followerCount: research.followerCount ?? undefined,
                totalLikes: research.totalLikes ?? undefined,
                videoCount: research.videoCount ?? undefined,
                totalViews: research.totalViews ?? undefined,
                avgViews: research.avgViews ?? undefined,
                engagementRate: research.engagementRate ?? undefined,
                location: research.location ?? undefined,
                rawKeywords: research.rawKeywords ?? undefined,
                contentThemeLabels: research.contentThemeLabels ?? undefined,
                topHashtags: research.topHashtags ?? undefined,
                recentVideoTitles: research.recentVideoTitles ?? undefined,
                transcriptCount: research.transcriptCount ?? 0,
                transcriptExcerpts: research.transcriptExcerpts ?? undefined,
                decodedSymbols: research.decodedSymbols ?? undefined,
                culturalVelocity: research.culturalVelocity ?? undefined,
                dataConfidenceLevel: research.dataConfidenceLevel ?? undefined,
                longitudinalSampleJson: research.longitudinalSample as unknown as Record<string, unknown> ?? undefined,
                discoveredVideoPoolJson: research.discoveredVideoPool?.length ? research.discoveredVideoPool : undefined,
              });
              
              updateJobResult(job.jobId, i, { creatorId: (result as any).id ?? (result as any).insertId });
              updateJobProgress(job.jobId, { completed: job.progress.completed + 1 });
            } catch (err) {
              recordJobError(job.jobId, i, input.handles[i], String(err));
            }
          }
          
          markJobCompleted(job.jobId);
        })().catch(err => console.error("Bulk creator analysis failed:", err));
        
        return { jobId: job.jobId };
      }),

    // ─── Brand Routes ───────────────────────────────────────────────────────────
  brand: router({
    analyze: publicProcedure
      .input(z.object({
        brandNameOrUrl: z.string().min(1),
        tiktokChannelUrl: z.string().optional().or(z.literal("")),
      }))
      .mutation(async ({ input }) => {
        // Step 1: Gather real evidence from the brand's website/web presence + review data + TikTok
        let brandEvidenceSummary: string | undefined;
        let tiktokMetadata: BrandTikTokMetadata | null = null;
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
        let mentionFields: {
          mentionDecodedSymbols?: Record<string, unknown>;
          mentionRawKeywords?: string[];
          mentionHashtagCloud?: string[];
          mentionSentiment?: string;
          mentionSentimentConfidence?: string;
          mentionMusicSignals?: string[];
          mentionMusicArtists?: string[];
          mentionTotalCount?: number;
          mentionUniqueAuthors?: number;
          mentionAudienceSummary?: string;
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
          // Phase 6: Audience Mention Intelligence fields
          if (brandResearch.audienceMentionData) {
            const m = brandResearch.audienceMentionData;
            mentionFields = {
              mentionDecodedSymbols: m as unknown as Record<string, unknown>,
              mentionRawKeywords: m.audienceIdentityClaims,
              mentionHashtagCloud: m.topHashtags,
              mentionSentiment: m.sentimentSignal,
              mentionSentimentConfidence: m.sentimentConfidence,
              mentionMusicSignals: m.mentionMusicTitles,
              mentionMusicArtists: m.mentionMusicArtists,
              mentionTotalCount: m.totalMentions,
              mentionUniqueAuthors: m.uniqueAuthors,
              mentionAudienceSummary: m.audienceLanguageSummary,
            };
          }
        } catch (err) {
          console.warn("[brand.analyze] Web research failed, proceeding without evidence:", err);
        }

        // Step 1b: Analyze TikTok channel if provided
        if (input.tiktokChannelUrl && input.tiktokChannelUrl.trim() !== "") {
          try {
            tiktokMetadata = await analyzeBrandTikTokChannel(input.tiktokChannelUrl);
            if (tiktokMetadata) {
              const tiktokEvidenceBlock = formatBrandTikTokEvidenceBlock(tiktokMetadata);
              brandEvidenceSummary = (brandEvidenceSummary || "") + "\n\n" + tiktokEvidenceBlock;
            }
          } catch (err) {
            console.warn("[brand.analyze] TikTok analysis failed, proceeding without TikTok data:", err);
          }
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
          brandTone: extracted.brandTone,
          brandType: extracted.brandType,
          campaignType: extracted.campaignType,
          weightAlpha: weights.alpha,
          weightBeta: weights.beta,
          weightGamma: weights.gamma,
          weightPriority: weights.priority,
          // Creator-parity sociological framework fields
          brandCulturalCapital: extracted.brandCulturalCapital,
          brandGoffmanStageConsistency: extracted.brandGoffmanStageConsistency,
          brandDriftSignal: extracted.brandDriftSignal,
          brandStuartHallDecoding: extracted.brandStuartHallDecoding,
          brandRogersAdopterStage: extracted.brandRogersAdopterStage,
          brandTurnerLiminalPhase: extracted.brandTurnerLiminalPhase,
          brandLifecyclePhase: extracted.brandLifecyclePhase,
          brandBarthesNicheMeaning: extracted.brandBarthesNicheMeaning,
          brandAudienceDecodingSplit: extracted.brandAudienceDecodingSplit,
          ...reviewFields,
          // Symbol fields: website-derived first, then TikTok overrides if available
          ...symbolFields,
          // TikTok fields (override symbol fields when TikTok data is present)
          tiktokChannelUrl: input.tiktokChannelUrl || undefined,
          tiktokMetadata: tiktokMetadata as unknown as Record<string, unknown> || undefined,
          tiktokEngagementRate: tiktokMetadata?.engagementRate || undefined,
          tiktokAudienceSize: tiktokMetadata?.followerCount || undefined,
          // TikTok video transcripts — only set when TikTok data was fetched
          ...(tiktokMetadata?.videoTranscripts && tiktokMetadata.videoTranscripts.length > 0 ? {
            brandVideoTranscripts: tiktokMetadata.videoTranscripts as unknown as Record<string, unknown>[],
            brandDecodedSymbols: tiktokMetadata.decodedSymbols as unknown as Record<string, unknown>[],
            brandRawKeywords: tiktokMetadata.rawKeywords,
            brandThemeLabels: tiktokMetadata.themeLabels,
            brandSymbolicVocabulary: tiktokMetadata.symbolicVocabulary,
          } : {}),
          // Phase 6: Audience Mention Intelligence
          ...mentionFields,
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

    reanalyze: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const existing = await getBrandProfileById(input.id);
        if (!existing) throw new Error("Brand profile not found");

        let brandEvidenceSummary = "";
        let reviewFields: any = {};
        let symbolFields: any = {};
        let mentionFieldsReanalyze: any = {};
        let tiktokMetadata: BrandTikTokMetadata | null = null;

        try {
          const brandResearch = await researchBrand(existing.brandUrl || existing.brandName);
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
          if (brandResearch.brandDecodedSymbols) {
            symbolFields = {
              brandRawKeywords: brandResearch.brandRawKeywords,
              brandThemeLabels: brandResearch.brandThemeLabels,
              brandSymbolicVocabulary: brandResearch.brandSymbolicVocabulary,
              brandDecodedSymbols: brandResearch.brandDecodedSymbols as unknown as Record<string, unknown>,
            };
          }
          // Phase 6: Audience Mention Intelligence
          if (brandResearch.audienceMentionData) {
            const m = brandResearch.audienceMentionData;
            mentionFieldsReanalyze = {
              mentionDecodedSymbols: m as unknown as Record<string, unknown>,
              mentionRawKeywords: m.audienceIdentityClaims,
              mentionHashtagCloud: m.topHashtags,
              mentionSentiment: m.sentimentSignal,
              mentionSentimentConfidence: m.sentimentConfidence,
              mentionMusicSignals: m.mentionMusicTitles,
              mentionMusicArtists: m.mentionMusicArtists,
              mentionTotalCount: m.totalMentions,
              mentionUniqueAuthors: m.uniqueAuthors,
              mentionAudienceSummary: m.audienceLanguageSummary,
            };
          }
        } catch (err) {
          console.warn("[brand.reanalyze] Web research failed, proceeding without evidence:", err);
        }

        // Re-run TikTok analysis if the brand has a stored TikTok handle
        if (existing.tiktokChannelUrl) {
          try {
            tiktokMetadata = await analyzeBrandTikTokChannel(existing.tiktokChannelUrl);
            if (tiktokMetadata) {
              const tiktokEvidenceBlock = formatBrandTikTokEvidenceBlock(tiktokMetadata);
              if (tiktokEvidenceBlock) {
                brandEvidenceSummary = brandEvidenceSummary + "\n\n" + tiktokEvidenceBlock;
              }
            }
          } catch (err) {
            console.warn("[brand.reanalyze] TikTok analysis failed, proceeding without TikTok data:", err);
          }
        }

        const extracted = await extractBrandProfile(existing.brandUrl || existing.brandName, brandEvidenceSummary);
        const weights = getBrandWeights(extracted.brandType, extracted.campaignType);

        await updateBrandProfile(input.id, {
          archetype: extracted.archetype,
          brandArchetypeClassification: extracted.brandArchetypeClassification,
          emotionalPromise: extracted.emotionalPromise,
          visualLanguage: extracted.visualLanguage,
          audienceTribe: extracted.audienceTribe,
          culturalTension: extracted.culturalTension,
          barthesMyth: extracted.barthesMyth,
          brandTone: extracted.brandTone,
          brandType: extracted.brandType,
          campaignType: extracted.campaignType,
          weightAlpha: weights.alpha,
          weightBeta: weights.beta,
          weightGamma: weights.gamma,
          weightPriority: weights.priority,
          // Creator-parity sociological framework fields
          brandCulturalCapital: extracted.brandCulturalCapital,
          brandGoffmanStageConsistency: extracted.brandGoffmanStageConsistency,
          brandDriftSignal: extracted.brandDriftSignal,
          brandStuartHallDecoding: extracted.brandStuartHallDecoding,
          brandRogersAdopterStage: extracted.brandRogersAdopterStage,
          brandTurnerLiminalPhase: extracted.brandTurnerLiminalPhase,
          brandLifecyclePhase: extracted.brandLifecyclePhase,
          brandBarthesNicheMeaning: extracted.brandBarthesNicheMeaning,
          brandAudienceDecodingSplit: extracted.brandAudienceDecodingSplit,
          ...reviewFields,
          // Symbol fields: website-derived first, TikTok overrides if available
          ...symbolFields,
          // TikTok fields
          tiktokMetadata: tiktokMetadata as unknown as Record<string, unknown> || undefined,
          tiktokEngagementRate: tiktokMetadata?.engagementRate || undefined,
          tiktokAudienceSize: tiktokMetadata?.followerCount || undefined,
          // TikTok video transcripts — only set when TikTok data was fetched
          ...(tiktokMetadata?.videoTranscripts && tiktokMetadata.videoTranscripts.length > 0 ? {
            brandVideoTranscripts: tiktokMetadata.videoTranscripts as unknown as Record<string, unknown>[],
            brandDecodedSymbols: tiktokMetadata.decodedSymbols as unknown as Record<string, unknown>[],
            brandRawKeywords: tiktokMetadata.rawKeywords,
            brandThemeLabels: tiktokMetadata.themeLabels,
            brandSymbolicVocabulary: tiktokMetadata.symbolicVocabulary,
          } : {}),
          // Phase 6: Audience Mention Intelligence
          ...mentionFieldsReanalyze,
          aiSummary: extracted.aiSummary,
          rawAiResponse: extracted as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        });

        const updated = await getBrandProfileById(input.id);
        return { profile: updated, extracted, weights };
      }),

    weightTable: publicProcedure.query(() => {
      return Object.entries(BRAND_WEIGHT_TABLE).map(([type, weights]) => ({
        type,
        ...weights,
      }));
    }),
  }),

    // ─── Cultural Match Score Routes ─────────────────────────────────────────────────────────────────────────────
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
            // Extract semantic overlap data for richer tribe matching
            const creatorKeywords = (creator.rawKeywords as string[] | null) ?? [];
            const creatorVocab = (creator.decodedSymbols as Record<string, unknown> | null)?.symbolicVocabulary as string[] ?? [];
            const brandKeywords = (brand.brandRawKeywords as string[] | null) ?? [];
            const brandVocab = (brand.brandDecodedSymbols as Record<string, unknown> | null)?.symbolicVocabulary as string[] ?? [];
            
            // Extract mention keywords if available
            let brandMentionKeywords: string[] = [];
            if (brand.tiktokMetadata) {
              try {
                const metadata = typeof brand.tiktokMetadata === 'string' 
                  ? JSON.parse(brand.tiktokMetadata) 
                  : brand.tiktokMetadata;
                if (metadata.mentionHashtags) {
                  brandMentionKeywords = metadata.mentionHashtags.slice(0, 10);
                }
              } catch {}
            }
            
            // Build semantic context for the LLM
            const semanticContext = `
ADDITIONAL SEMANTIC SIGNALS:
Creator Keywords: ${creatorKeywords.slice(0, 10).join(", ") || "none"}
Creator Vocabulary: ${creatorVocab.slice(0, 10).join(", ") || "none"}
Brand Keywords: ${brandKeywords.slice(0, 10).join(", ") || "none"}
Brand Vocabulary: ${brandVocab.slice(0, 10).join(", ") || "none"}
Brand Audience Mentions (TikTok): ${brandMentionKeywords.join(", ") || "none"}`;
            
            const mythResponse = await invokeLLM({
              messages: [
                {
                  role: "system",
                  content: `You are a cultural semiotics analyst scoring the mythological alignment between a creator and a brand for an influencer marketing platform.

Creator Barthes Myth: "${creator.barthesMyth}"
Creator Tone Register: "${creator.toneRegister ?? "not specified"}"
Creator Audience Relationship: "${creator.audienceRelationshipType ?? ""}"
Creator Cultural Capital: "${creator.culturalCapital ?? ""}"
Creator Stuart Hall Decoding: "${creator.stuartHallDecoding ?? "Dominant"}"

Brand Barthes Myth: "${brand.barthesMyth}"
Brand Tone Register: "${(brand as Record<string, unknown>).brandTone ?? "not specified"}"
Brand Audience Tribe: "${brand.audienceTribe ?? ""}"
Brand Cultural Tension: "${brand.culturalTension ?? ""}"
Brand Archetype Classification: "${brand.brandArchetypeClassification ?? ""}"

${semanticContext}

SCORING RULES:
- If creator tone is anti-establishment, rebellious, or oppositional AND brand is institutional, corporate, or formal: mythAlignmentScore should be 1-3 (severe mismatch)
- If creator and brand share the same symbolic territory (both community-driven, both aspirational, both playful): mythAlignmentScore should be 7-10
- If creator's Stuart Hall Decoding is Oppositional: apply a -2 penalty to mythAlignmentScore
- tribMatchScore measures whether the creator's actual audience would authentically receive this brand — not just whether the brand wants that audience
- Use semantic keyword overlap as an additional signal: shared keywords between creator and brand vocabulary suggest stronger tribe match
- Consider brand audience mentions (TikTok): if audiences are talking about the brand in positive terms, boost tribMatchScore

Score 1: mythAlignmentScore (0–10) — How closely do the creator's and brand's mythological narratives and tones align? Same symbolic territory = 10, completely opposed = 1.
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

        // Phase 6: Extract music signals from creator transcripts and brand mention data
        const creatorTranscripts = ((creator as unknown as Record<string, unknown>).transcripts as Array<Record<string, unknown>> | null) ?? [];
        const creatorMusicTitles: string[] = creatorTranscripts
          .map(t => (t.musicMetadata as Record<string, unknown> | undefined)?.soundName as string | undefined)
          .filter((s): s is string => Boolean(s));
        const creatorMusicArtists: string[] = []; // TikTok API doesn't return artist separately for creators
        const brandMentionMusicTitles = (brand.mentionMusicSignals as string[] | null) ?? [];
        const brandMentionMusicArtists = (brand.mentionMusicArtists as string[] | null) ?? [];

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
          culturalVelocity: (creator.culturalVelocity as string | null) ?? "Insufficient Data",
          dataConfidenceLevel: (creator.dataConfidenceLevel as string | null) ?? "low",
          // TikTok metrics for brands
          brandTiktokEngagementRate: brand.tiktokEngagementRate ?? undefined,
          brandTiktokFollowerCount: brand.tiktokAudienceSize ?? undefined,
          brandTiktokPostFrequency: brand.tiktokMetadata ? (brand.tiktokMetadata as any).postFrequency : undefined,
          // Phase 4: Brand-side sociological framework fields (bilateral scoring)
          brandGoffmanStageConsistency: (brand as any).brandGoffmanStageConsistency ?? undefined,
          brandDriftSignal: (brand as any).brandDriftSignal ?? undefined,
          brandStuartHallDecoding: (brand as any).brandStuartHallDecoding ?? undefined,
          brandRogersAdopterStage: (brand as any).brandRogersAdopterStage ?? undefined,
          brandTurnerLiminalPhase: (brand as any).brandTurnerLiminalPhase ?? undefined,
          brandLifecyclePhase: (brand as any).brandLifecyclePhase ?? undefined,
          brandCulturalCapital: (brand as any).brandCulturalCapital ?? undefined,
          brandAudienceDecodingSplit: (brand as any).brandAudienceDecodingSplit ?? undefined,
          // Phase 6: Audience Mention Intelligence
          brandMentionSentiment: (brand as any).mentionSentiment ?? undefined,
          brandMentionSentimentConfidence: (brand as any).mentionSentimentConfidence ?? undefined,
          brandMentionHashtags: (brand.mentionHashtagCloud as string[] | null) ?? undefined,
          brandMentionKeywords: (brand.mentionRawKeywords as string[] | null) ?? undefined,
          brandMentionMusicTitles,
          brandMentionMusicArtists,
          brandMentionTotalCount: (brand as any).mentionTotalCount ?? undefined,
          brandMentionUniqueAuthors: (brand as any).mentionUniqueAuthors ?? undefined,
          // Creator music signals
          creatorMusicTitles,
          creatorMusicArtists,
        });

        // Calculate performance signals using actual brand + creator data
        const performanceSignals = calculateAllSignals(
          creator,
          brand,
          result.parrScore,
          result.qovScore,
          result.alignmentScoreRaw,
          result.pulseScoreRaw,
          result.stabilityScoreRaw,
          result.dataConfidenceLevel,
        );

        // Generate Synergy Narrative + Content Directions
        let synergyNarrative = "";
        let contentDirections: Array<{ title: string; rationale: string; exampleAngle: string }> = [];
        try {
          const synergyResponse = await invokeLLM({
            messages: [
              {
                role: "system",
                content: `You are a plain-talking creator marketing strategist writing a partnership brief for a business owner or junior marketer.
Your job is to explain — in simple, direct language — whether this creator and brand are a good match, and why.

IMPORTANT WRITING RULES:
- Write like you are explaining this to a smart business owner who has never heard of semiotics or Jungian archetypes.
- NO academic jargon. Do NOT use words like: semiotics, archetype, Barthes myth, symbolic capital, liminality, Bourdieu, Goffman, Stuart Hall, parasocial, decoding, signifier, or any other academic term.
- Instead of "archetype", say "personality type" or "the kind of person they come across as".
- Instead of "symbolic vocabulary", say "the words and ideas they both use".
- Instead of "cultural territory", say "the world they both live in" or "what they both stand for".
- Write in short, confident sentences. No fluff. No filler phrases like "it is worth noting" or "it is important to consider".
- The tone should feel like advice from a trusted colleague, not a consultant's report.

CREATOR PROFILE:
- Handle: @${creator.handle}
- Personality type: ${creator.archetype ?? "Unknown"}
- What they stand for: ${creator.barthesMyth ?? "Not available"}
- How they relate to their audience: ${creator.audienceRelationshipType ?? "Unknown"}
- Their cultural standing: ${creator.culturalCapital ?? "Unknown"}
- Content themes: ${creatorThemes.join(", ") || "Not available"}
- Top keywords from their content: ${creatorKeywords.slice(0, 15).join(", ") || "Not available"}
- What their content signals: ${creatorDecodedSymbols ? JSON.stringify(creatorDecodedSymbols).slice(0, 400) : "Not available"}

BRAND PROFILE:
- Brand: ${brand.brandName}
- Personality type: ${brand.archetype ?? "Unknown"}
- What they stand for: ${brand.barthesMyth ?? "Not available"}
- Their target customer: ${brand.audienceTribe ?? "Unknown"}
- The tension they play into: ${brand.culturalTension ?? "Not available"}
- Brand category: ${brand.brandType ?? "Unknown"}
- Brand themes: ${brandThemes.join(", ") || "Not available"}
- Top keywords from their content: ${brandKeywords.slice(0, 15).join(", ") || "Not available"}
- What their brand signals: ${brandDecodedSymbols ? JSON.stringify(brandDecodedSymbols).slice(0, 400) : "Not available"}

SHARED SIGNALS:
- Words and ideas they both use: ${result.sharedKeywords.join(", ") || "None detected"}
- Themes they share: ${result.sharedThemes.join(", ") || "None detected"}
- How much they overlap: ${result.symbolicOverlapScore}/10

SCORES:
- Cultural Match Score: ${result.caiScore}/10 (${result.caiStatus})
- Audience Acceptance Score: ${result.parrScore}/100 (${result.parrLabel})
- Alignment: ${result.alignmentScoreRaw.toFixed(1)}/10 | Momentum: ${result.pulseScoreRaw.toFixed(1)}/10 | Consistency: ${result.stabilityScoreRaw.toFixed(1)}/10

Write the following in JSON format:
1. synergyNarrative (string, 120–200 words): A clear, plain-language explanation of whether this partnership makes sense. Answer three questions in plain English: (a) Do these two belong in the same world — and why? (b) What do they have in common that their shared audience will immediately recognize? (c) What will the audience think and feel when they see this collaboration? Be specific and direct. Use real details from the data above.
2. contentDirections (array of 3 objects): Three specific content ideas grounded in what this creator and brand actually share. Each must have: title (short, punchy — max 6 words), rationale (1 plain sentence explaining why this idea will work with this audience), exampleAngle (1 concrete, specific example of a post or video — describe it like you are pitching it in a meeting).`,
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
          caiScore: result.caiScore,
          caiStatus: result.caiStatus,
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

        // Generate Cultural Borrowing Summary — what the brand gains from this creator
        let culturalBorrowingSummary: string | null = null;
        try {
          const borrowingResponse = await invokeLLM({
            messages: [
              {
                role: "system",
                content: `You are a plain-talking cultural strategist writing a single paragraph for a brand considering partnering with a creator.

Your job: explain in 2-3 direct sentences what the brand is BORROWING from this creator. Not what the brand gains in reach — what they gain CULTURALLY. What trust, identity, community, or perception does the creator carry that the brand cannot generate on its own?

Write in plain language. No jargon. Be specific. Use the creator's actual archetype, audience relationship, and tone.

CREATOR:
- Handle: @${creator.handle}
- Archetype: ${creator.archetype ?? "Unknown"}
- Tone: ${creator.toneRegister ?? "Unknown"}
- Audience relationship: ${creator.audienceRelationshipType ?? "Unknown"}
- Parasocial bond: ${creator.parasocialBondStrength ?? "Unknown"}/5
- What they stand for: ${creator.barthesMyth ?? "Not available"}
- Cultural capital type: ${creator.culturalCapital ?? "Unknown"}
- Followers: ${creator.followerCount?.toLocaleString() ?? "Unknown"}

BRAND:
- Name: ${brand.brandName}
- Archetype: ${brand.archetype ?? "Unknown"}
- Audience tribe: ${brand.audienceTribe ?? "Unknown"}
- What they stand for: ${brand.barthesMyth ?? "Not available"}
- Audience sentiment: ${brand.mentionSentiment ?? "Unknown"}

SHARED SIGNALS:
- Shared keywords: ${result.sharedKeywords.join(", ") || "None"}
- Music overlap: ${result.musicOverlap.overlapStrength}

Write ONLY the 2-3 sentence paragraph. No headers. No lists. No quotes.`,
              },
              { role: "user", content: "Write the cultural borrowing summary." },
            ],
          });
          culturalBorrowingSummary = borrowingResponse.choices[0]?.message?.content as string ?? null;
        } catch (err) {
          console.warn("[routers] Cultural borrowing summary generation failed (non-fatal):", err);
        }

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
          caiScore: result.caiScore,
          caiStatus: result.caiStatus,
          radarWarnings: result.radarWarnings,
          narrativeSummary: narrative.narrativeSummary,
          alignmentNotes: narrative.alignmentNotes as unknown as Record<string, unknown>,
          // Verified F.I.T. Impressions Score
          parrScore: result.parrScore,
          parrLabel: result.parrLabel,
          parrSignalBreakdown: result.parrSignalBreakdown as unknown as Record<string, unknown>,
          symbolicOverlapScore: result.symbolicOverlapScore,
          sharedKeywords: result.sharedKeywords as unknown as string[],
          sharedThemes: result.sharedThemes as unknown as string[],
          // QoV — Quality of View
          qovScore: result.qovScore,
          // Phase 1.5 Visual Intelligence
          alignmentNarrative: result.alignmentNarrative || null,
          culturalVelocity: result.culturalVelocity || null,
          dataConfidenceLevel: result.dataConfidenceLevel || null,
          // Synergy Narrative + Content Directions
          synergyNarrative: synergyNarrative || null,
          contentDirections: contentDirections.length > 0 ? contentDirections as unknown as Record<string, unknown>[] : null,
          // Phase 6: Music Overlap + Cultural Borrowing
          musicOverlap: result.musicOverlap as unknown as Record<string, unknown>,
          culturalBorrowingSummary: culturalBorrowingSummary || null,
          // Five Performance Signals (computed from actual brand + creator data)
          creativeIntegritySignal: performanceSignals.creativeIntegrity.score,
          creativeIntegrityConfidence: performanceSignals.creativeIntegrity.confidence,
          performanceConsistencySignal: performanceSignals.performanceConsistency.score,
          performanceConsistencyConfidence: performanceSignals.performanceConsistency.confidence,
          communityQualitySignal: performanceSignals.communityQuality.score,
          communityQualityConfidence: performanceSignals.communityQuality.confidence,
          audienceReceptivitySignal: performanceSignals.audienceReceptivity.score,
          audienceReceptivityConfidence: performanceSignals.audienceReceptivity.confidence,
          brandTrustSignal: performanceSignals.brandTrust.score,
          brandTrustConfidence: performanceSignals.brandTrust.confidence,
        });

        const matches = await listMatchRecords();
        const saved = matches[0];

        return {
          match: saved,
          creator,
          brand,
          result,
          narrative,
          performanceSignals,
        };
      }),

    getJobProgress: publicProcedure
      .input(z.object({ jobId: z.string() }))
      .query(({ input }) => {
        const job = getJob(input.jobId);
        if (!job) {
          throw new Error("Job not found");
        }
        return {
          jobId: job.jobId,
          type: job.type,
          progress: job.progress,
          results: job.results,
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
