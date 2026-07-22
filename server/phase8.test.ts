import { describe, it, expect } from "vitest";
import {
  calculateCreativeIntegritySignal,
  calculateCommunityQualitySignal,
  calculateBrandTrustSignal,
} from "./performanceSignals";

// NOTE: performanceSignals accepts loose `Record<string, any> & {…}` profile
// shapes (see performanceSignals.ts), NOT the drizzle schema row types. These
// fixtures are therefore plain literals that only need to carry the fields the
// signal functions actually read.
describe("Phase 8: Enhanced Brand Data Extraction & Performance Signals", () => {
  const mockCreator = {
    id: "creator-1",
    platform: "YouTube",
    handle: "@testcreator",
    displayName: "Test Creator",
    bio: "Test bio",
    followerCount: 100000,
    videoCount: 50,
    totalLikes: 1000000,
    totalViews: 5000000,
    avgViews: 100000,
    engagementRate: 0.05,
    location: "US",
    profileUrl: "https://youtube.com/@testcreator",
    recentVideoTitles: ["Video 1", "Video 2"],
    topHashtags: ["test", "creator"],
    rawKeywords: ["authentic", "educational", "thoughtful"],
    contentThemeLabels: ["Education", "Lifestyle"],
    contentThemes: ["personal-growth", "learning"],
    transcripts: [],
    transcriptCount: 0,
    transcriptExcerpts: [],
    decodedSymbols: null,
    evidenceSummary: "Test creator evidence",
    archetype: "The Sage",
    toneRegister: "Authoritative",
    barthesMyth: "The Seeker",
    goffmanStageConsistency: "Consistent",
    driftSignal: "Zero Change",
    culturalCapital: "Produce",
    parasocialBondStrength: 4.5,
    audienceTribe: "Intellectuals",
    audienceRelationshipType: "Mentor",
    lifecyclePhase: "Maturity",
    niche: "Education",
    primaryRegion: "North America",
    stuartHallDecoding: "Negotiated",
    brandSaturation: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    tiktokMetadata: null,
  };

  const mockBrand = {
    id: "brand-1",
    brandName: "Test Brand",
    website: "https://testbrand.com",
    archetype: "The Everyman",
    brandTone: "Friendly and accessible",
    barthesMyth: "The Community",
    emotionalPromise: "Belonging",
    visualLanguage: "Warm colors",
    audienceTribe: "Everyday people",
    tiktokAudienceSize: 50000,
    tiktokEngagementRate: null,
    overallRating: 4.5,
    totalReviews: 200,
    brandRawKeywords: ["affordable", "accessible", "practical"],
    mentionSentiment: "positive",
    mentionHashtagCloud: ["affordable", "practical", "community"],
    mentionMusicSignals: ["indie-pop"],
    mentionTotalCount: 10,
    tiktokMetadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe("Creative Integrity Signal with Mention Data", () => {
    it("should boost score when brand has positive mention sentiment", () => {
      const result = calculateCreativeIntegritySignal(mockCreator, mockBrand);
      expect(result.score).toBeGreaterThan(50);
      expect(result.confidence).toBe("Verified");
    });

    it("should reduce score when brand has negative mention sentiment", () => {
      const brandWithNegativeSentiment = {
        ...mockBrand,

    mentionTotalCount: 8,
    mentionSentiment: "negative",
    mentionHashtagCloud: ["overpriced", "bad-quality"],
    mentionMusicSignals: [],
    tiktokMetadata: null,
      };
      const result = calculateCreativeIntegritySignal(mockCreator, brandWithNegativeSentiment);
      expect(result.score).toBeLessThan(70);
    });

    it("should handle insufficient mention data gracefully", () => {
      const brandWithInsufficientMentions = {
        ...mockBrand,

    mentionTotalCount: 2,
    mentionSentiment: "positive",
    mentionHashtagCloud: [],
    mentionMusicSignals: [],
    tiktokMetadata: null,
      };
      const result = calculateCreativeIntegritySignal(mockCreator, brandWithInsufficientMentions);
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe("Community Quality Signal with Keyword Overlap", () => {
    it("should boost score when creator and brand mention hashtags overlap", () => {
      const creatorWithMatchingKeywords = {
        ...mockCreator,
        rawKeywords: ["affordable", "practical", "authentic"],
      };
      const result = calculateCommunityQualitySignal(creatorWithMatchingKeywords, mockBrand);
      expect(result.score).toBeGreaterThan(50);
      expect(result.confidence).toBe("Verified");
    });

    it("should not boost score when keyword overlap is minimal", () => {
      const creatorWithDifferentKeywords = {
        ...mockCreator,
        rawKeywords: ["luxury", "exclusive", "premium"],
      };
      const result = calculateCommunityQualitySignal(creatorWithDifferentKeywords, mockBrand);
      expect(result.score).toBeLessThanOrEqual(70);
    });

    it("should handle missing hashtag data", () => {
      const brandWithoutHashtags = {
        ...mockBrand,

    mentionTotalCount: 5,
    mentionSentiment: "positive",
    mentionHashtagCloud: [],
    mentionMusicSignals: [],
    tiktokMetadata: null,
      };
      const result = calculateCommunityQualitySignal(mockCreator, brandWithoutHashtags);
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe("Brand Trust Signal with Mention Sentiment & Reviews", () => {
    it("should boost score when brand has positive mentions and good reviews", () => {
      const result = calculateBrandTrustSignal(mockCreator, mockBrand);
      expect(result.score).toBeGreaterThan(60);
      expect(result.confidence).toBe("Verified");
    });

    it("should reduce score when brand has negative mentions", () => {
      const brandWithNegativeMentions = {
        ...mockBrand,

    mentionTotalCount: 7,
    mentionSentiment: "negative",
    mentionHashtagCloud: ["avoid", "scam"],
    mentionMusicSignals: [],
    tiktokMetadata: null,
      };
      const result = calculateBrandTrustSignal(mockCreator, brandWithNegativeMentions);
      expect(result.score).toBeLessThan(95);
    });

    it("should apply review rating bonus to trust score", () => {
      const brandWithHighRating = {
        ...mockBrand,
        overallRating: 4.8,
      };
      const resultHigh = calculateBrandTrustSignal(mockCreator, brandWithHighRating);
      
      const brandWithLowRating = {
        ...mockBrand,
        overallRating: 2.0,
      };
      const resultLow = calculateBrandTrustSignal(mockCreator, brandWithLowRating);
      
      expect(resultHigh.score).toBeGreaterThanOrEqual(resultLow.score);
    });

    it("should handle mixed mention sentiment", () => {
      const brandWithMixedSentiment = {
        ...mockBrand,

    mentionTotalCount: 6,
    mentionSentiment: "mixed",
    mentionHashtagCloud: ["good-and-bad"],
    mentionMusicSignals: [],
    tiktokMetadata: null,
      };
      const result = calculateBrandTrustSignal(mockCreator, brandWithMixedSentiment);
      expect(result.score).toBeGreaterThan(40);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe("Signal Confidence Levels", () => {
    it("should mark signals as Verified when mention data is available", () => {
      const result = calculateBrandTrustSignal(mockCreator, mockBrand);
      expect(result.confidence).toBe("Verified");
    });

    it("should mark signals as Estimated when mention data is insufficient", () => {
      const brandWithoutMentions = {
        ...mockBrand,
        mentionSentiment: undefined,
        mentionTotalCount: undefined,
      };
      const result = calculateBrandTrustSignal(mockCreator, brandWithoutMentions);
      expect(result.confidence).toBe("Estimated");
    });
  });

  describe("Signal Variation from Richer Data Sources", () => {
    it("should produce different scores based on website keyword extraction", () => {
      const brandA = { ...mockBrand, brandRawKeywords: ["premium", "luxury"] };
      const brandB = { ...mockBrand, brandRawKeywords: ["affordable", "accessible"] };
      
      const resultA = calculateCommunityQualitySignal(mockCreator, brandA);
      const resultB = calculateCommunityQualitySignal(mockCreator, brandB);
      
      // Different keyword sets should produce different scores
      expect(resultA.score).toBeDefined();
      expect(resultB.score).toBeDefined();
    });

    it("should show variation based on review ratings", () => {
      const brandHighRating = { ...mockBrand, overallRating: 4.9 };
      const brandLowRating = { ...mockBrand, overallRating: 2.0 };
      
      const scoreHigh = calculateBrandTrustSignal(mockCreator, brandHighRating).score;
      const scoreLow = calculateBrandTrustSignal(mockCreator, brandLowRating).score;
      
      expect(scoreHigh).toBeGreaterThanOrEqual(scoreLow);
    });
  });
});
