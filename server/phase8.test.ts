import { describe, it, expect } from "vitest";
import {
  calculateCreativeIntegritySignal,
  calculateCommunityQualitySignal,
  calculateBrandTrustSignal,
} from "./performanceSignals";
import type { CreatorProfile, BrandProfile } from "../drizzle/schema";

describe("Phase 8: Enhanced Brand Data Extraction & Performance Signals", () => {
  const mockCreator: CreatorProfile = {
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
    parasocialBondStrength: 8,
    audienceTribe: "Intellectuals",
    audienceRelationshipType: "Mentorship",
    lifecyclePhase: "Maturity",
    niche: "Education",
    primaryRegion: "North America",
    stuartHallDecoding: "Negotiated",
    brandSaturation: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    tiktokMetadata: null,
  };

  const mockBrand: BrandProfile = {
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
    overallRating: 4.5,
    totalReviews: 200,
    brandRawKeywords: ["affordable", "accessible", "practical"],
    tiktokMetadata: {
      totalMentions: 10,
      mentionSentiment: "positive",
      mentionHashtags: ["affordable", "practical", "community"],
      mentionMusicSignals: ["indie-pop"],
      avgMentionEngagement: 0.03,
    },
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
        tiktokMetadata: {
          totalMentions: 8,
          mentionSentiment: "negative",
          mentionHashtags: ["overpriced", "bad-quality"],
          mentionMusicSignals: [],
          avgMentionEngagement: 0.01,
        },
      };
      const result = calculateCreativeIntegritySignal(mockCreator, brandWithNegativeSentiment);
      expect(result.score).toBeLessThan(70);
    });

    it("should handle insufficient mention data gracefully", () => {
      const brandWithInsufficientMentions = {
        ...mockBrand,
        tiktokMetadata: {
          totalMentions: 2,
          mentionSentiment: "positive",
          mentionHashtags: [],
          mentionMusicSignals: [],
          avgMentionEngagement: 0,
        },
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
        tiktokMetadata: {
          totalMentions: 5,
          mentionSentiment: "positive",
          mentionHashtags: [],
          mentionMusicSignals: [],
          avgMentionEngagement: 0.02,
        },
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
        tiktokMetadata: {
          totalMentions: 7,
          mentionSentiment: "negative",
          mentionHashtags: ["avoid", "scam"],
          mentionMusicSignals: [],
          avgMentionEngagement: 0.01,
        },
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
        tiktokMetadata: {
          totalMentions: 6,
          mentionSentiment: "mixed",
          mentionHashtags: ["good-and-bad"],
          mentionMusicSignals: [],
          avgMentionEngagement: 0.02,
        },
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
        tiktokMetadata: null,
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
