/**
 * derive + extract_commit phase-unit tests — S2 Part 3.
 *
 * Pins the contract: what each phase declares as ready, that extract_commit is
 * genuinely FUSED (extraction and commit succeed or fail as one unit), and that
 * the phase-path assembly is deterministic and reads the AUGMENTED pool rather
 * than the capture pool — the latter being the subtle way a phased run could
 * silently lose the search contribution.
 */
import { describe, expect, it, vi } from "vitest";
import { NOT_READY, type CampaignState } from "../_core/analysisPhase";
import {
  assembleFromPhases,
  bankedPhasesFor,
  makeDerivePhase,
  makeExtractCommitPhase,
  type DerivePhaseInput,
  type DerivePhaseOutput,
  type TranscribePhaseOutput,
} from "./derivePhases";
import type { CapturePhaseOutput, AugmentPhaseOutput } from "./collectionPhases";

const emptyPool = (over: Partial<CapturePhaseOutput["pool"]> = {}) => ({
  videoIds: [], videoItems: [], viewCounts: [], videoTitles: [],
  hashtags: [], musicTitles: [], foreignVideosRejected: 0, ...over,
});

const capture: CapturePhaseOutput = {
  stats: {
    displayName: "Fixture", bio: "toronto street interviews", followerCount: 1000,
    followingCount: 10, videoCount: 50, totalLikes: 5000, location: "",
  },
  profileTitles: ["profile title"],
  profileViewCounts: [111],
  assessment: null,
  pool: emptyPool({ videoTitles: ["profile title"], viewCounts: [111] }),
};

const augment: AugmentPhaseOutput = {
  pool: emptyPool({
    videoTitles: ["search title a #alpha", "profile title"],
    hashtags: ["#alpha", "#beta"],
    viewCounts: [111, 222],
  }),
  quotaExhausted: false,
};

const transcribe: TranscribePhaseOutput = {
  transcripts: [{
    videoId: "1", videoUrl: "u", caption: "cap", transcript: "spoken words here",
    wordCount: 3, transcriptSource: "subtitle",
  }] as never,
  musicTitles: ["m"],
  engagementSignals: { totalSampled: 0, avgLikeRate: 0, avgCommentRate: 0 } as never,
  longitudinalSample: { culturalVelocity: "Focusing" } as never,
  discoveredVideoPool: [],
  foreignVideosRejected: 2,
  transcriptViewCounts: [222],
};

const input: DerivePhaseInput = { handle: "fixture.creator", capture, augment, transcribe };
const derived: DerivePhaseOutput = { contentThemeLabels: ["Theme A"], decodedSymbols: null };

const stateWith = (phases: Record<string, unknown>): CampaignState => ({
  runId: "r", handle: "fixture.creator", platform: "TikTok",
  phases: Object.fromEntries(Object.entries(phases).map(([k, output]) => [k, {
    phase: k, tool: null, status: "complete", attemptCount: 1,
    failureClass: null, nextEarliestAt: null, output,
  }])) as never,
});

describe("bankedPhasesFor — which pool feeds the evidence", () => {
  it("uses the AUGMENTED pool's titles and hashtags, not capture's", () => {
    // The subtle regression: reading capture's pool would silently drop every
    // search-discovered video from the evidence while the run still succeeds.
    const banked = bankedPhasesFor(input);
    expect(banked.augment.searchTitles).toEqual(augment.pool.videoTitles);
    expect(banked.augment.searchHashtags).toEqual(augment.pool.hashtags);
    expect(banked.augment.searchTitles).not.toEqual(capture.pool.videoTitles);
  });

  it("carries capture's profile-derived lists separately (merge order is load-bearing)", () => {
    const banked = bankedPhasesFor(input);
    expect(banked.capture.profileTitles).toEqual(["profile title"]);
    expect(banked.capture.profileViewCounts).toEqual([111]);
  });
});

describe("declared inputs", () => {
  const derive = makeDerivePhase("TikTok", {
    translateKeywordsToThemes: async () => [],
    decodeCreatorSymbols: async () => null,
  });
  const commit = makeExtractCommitPhase("TikTok", {
    extract: async () => ({}), buildSnapshot: () => ({}),
    persist: async () => ({}), summarize: () => ({ saved: "full" }),
  });

  it("derive is NOT_READY until capture, augment AND transcribe have banked", () => {
    expect(derive.inputs(stateWith({}))).toBe(NOT_READY);
    expect(derive.inputs(stateWith({ capture }))).toBe(NOT_READY);
    expect(derive.inputs(stateWith({ capture, augment }))).toBe(NOT_READY);
    expect(derive.inputs(stateWith({ capture, augment, transcribe }))).not.toBe(NOT_READY);
  });

  it("extract_commit additionally requires derive", () => {
    expect(commit.inputs(stateWith({ capture, augment, transcribe }))).toBe(NOT_READY);
    expect(commit.inputs(stateWith({ capture, augment, transcribe, derive: derived }))).not.toBe(NOT_READY);
  });

  it("derive retries generously (cheap, and the credential/quota class lives here)", () => {
    expect(derive.retry.maxAttempts).toBe(4);
    expect(derive.retry.backoffMs.transient?.length).toBe(3);
  });
});

describe("derive phase execution", () => {
  it("launches both LLM calls and reports complete when both return", async () => {
    const themes = vi.fn(async () => ["A", "B"]);
    const symbols = vi.fn(async () => ({ symbolicSummary: "s" }) as never);
    const derive = makeDerivePhase("TikTok", { translateKeywordsToThemes: themes, decodeCreatorSymbols: symbols });

    const res = await derive.run(input, { runId: "r", handle: "h", platform: "TikTok", attempt: 1 });
    expect(res.outcome).toBe("complete");
    expect(res.output?.contentThemeLabels).toEqual(["A", "B"]);
    expect(themes).toHaveBeenCalledOnce();
    expect(symbols).toHaveBeenCalledOnce();
  });

  it("reports PARTIAL (not failed) when a helper degrades to an empty result", async () => {
    const derive = makeDerivePhase("TikTok", {
      translateKeywordsToThemes: async () => [],
      decodeCreatorSymbols: async () => null,
    });
    const res = await derive.run(input, { runId: "r", handle: "h", platform: "TikTok", attempt: 1 });
    expect(res.outcome).toBe("partial");
  });

  it("classifies a thrown quota error as transient so it requeues", async () => {
    const derive = makeDerivePhase("TikTok", {
      translateKeywordsToThemes: async () => { throw new Error("HTTP 429 Too Many Requests"); },
      decodeCreatorSymbols: async () => null,
    });
    const res = await derive.run(input, { runId: "r", handle: "h", platform: "TikTok", attempt: 1 });
    expect(res.outcome).toBe("failed");
    expect(res.failureClass).toBe("transient");
  });
});

describe("extract_commit is FUSED", () => {
  it("a persist failure fails the whole phase — no orphaned extraction", async () => {
    const extract = vi.fn(async () => ({ displayName: "d", pronouns: "they/them" }));
    const commit = makeExtractCommitPhase("TikTok", {
      extract,
      buildSnapshot: () => ({}),
      persist: async () => { throw new Error("db down"); },
      summarize: () => ({ saved: "full" }),
    });
    const res = await commit.run({ ...input, derived }, { runId: "r", handle: "h", platform: "TikTok", attempt: 1 });
    expect(extract).toHaveBeenCalledOnce();      // extraction DID run…
    expect(res.outcome).toBe("failed");          // …and the phase still fails as one unit
    expect(res.output).toBeNull();
  });

  it("a partial persist is reported as partial, carrying the observation id", async () => {
    const commit = makeExtractCommitPhase("TikTok", {
      extract: async () => ({ displayName: "d" }),
      buildSnapshot: () => ({}),
      persist: async () => ({ subjectId: "s1", observationId: "o1" }),
      summarize: () => ({ saved: "partial" }),
    });
    const res = await commit.run({ ...input, derived }, { runId: "r", handle: "h", platform: "TikTok", attempt: 1 });
    expect(res.outcome).toBe("partial");
    expect(res.output?.observationId).toBe("o1");
  });

  it("snapshot is built from the SAME evidence summary handed to extraction", async () => {
    // womo_0007's whole purpose: the snapshot must record the exact inputs that
    // produced this extraction. Fusing them is what guarantees it.
    let extractedSummary = "";
    let snapshotSummary: string | undefined = "";
    const commit = makeExtractCommitPhase("TikTok", {
      extract: async (_h, _p, summary) => { extractedSummary = summary; return { displayName: "d" }; },
      buildSnapshot: (_h, _p, summary) => { snapshotSummary = summary; return {}; },
      persist: async () => ({ subjectId: "s", observationId: "o" }),
      summarize: () => ({ saved: "full" }),
    });
    await commit.run({ ...input, derived }, { runId: "r", handle: "h", platform: "TikTok", attempt: 1 });
    expect(snapshotSummary).toBe(extractedSummary);
    expect(extractedSummary.length).toBeGreaterThan(100);
  });
});

describe("assembleFromPhases", () => {
  it("is deterministic — same banked phases produce byte-identical evidence", () => {
    const a = assembleFromPhases("fixture.creator", "TikTok", input, derived);
    const b = assembleFromPhases("fixture.creator", "TikTok", input, derived);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("includes the search-discovered titles in the evidence the model reads", () => {
    const res = assembleFromPhases("fixture.creator", "TikTok", input, derived);
    expect(res.recentVideoTitles).toContain("search title a #alpha");
    expect(res.evidenceSummary).toContain("search title a");
  });
});
