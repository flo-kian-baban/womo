/**
 * A BLOCKED CAPTURE IS NOT AN EMPTY CREATOR.
 *
 * ─── The regression class ───────────────────────────────────────────────────
 * Both used to collapse into `partial`, and the scheduler treats partial as
 * usable output — so a rate-limited capture committed a thin profile instead of
 * waiting a minute and trying again. It is invisible by construction: the run
 * "succeeds", the profile exists, and nothing says the evidence was never
 * collected. Measured on the live ledger before this change: kaylee.nhi
 * committed with 5 block pages and 5 silent failures recorded against it.
 *
 * The discriminator is the capture tool's own `assessment.genuineEmpty` — a
 * CONFIRMED zero from a healthy structured read. Anything else that came back
 * empty is unproven, and unproven means transient.
 *
 * The platform toolset is stubbed rather than mocked at the network layer, so
 * these assertions are about the PHASE's decision and nothing else.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PhaseRunContext } from "../_core/analysisPhase";

const capture = vi.fn();
const seedPool = vi.fn();

vi.mock("./platformTools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./platformTools")>();
  return {
    ...actual,
    toolsetFor: () => ({
      capture: { platform: "TikTok", name: "stub:capture", capture, seedPool },
      augment: null,
      transcribe: { platform: "TikTok", name: "stub:transcribe", selectSample: () => [], transcribe: async () => [], assemble: () => ({}) },
      gate: () => ({ ok: true }),
      evidenceExtras: () => "",
      engagementRate: () => 0,
      profileUrl: (h: string) => `https://example.test/${h}`,
    }),
  };
});

const { makeCapturePhase } = await import("./collectionPhases");

const ctx: PhaseRunContext = { runId: "r1", handle: "creator", platform: "TikTok", attempt: 1 };
const STATS = {
  displayName: "d", bio: "b", followerCount: 100, followingCount: 1,
  videoCount: 40, totalLikes: 0, location: "",
};

/** Capture returns a profile but N pooled videos. */
function capturing(videos: number, assessment: unknown) {
  capture.mockResolvedValue({
    stats: STATS, profileTitles: [], profileViewCounts: [], assessment, nativeProfile: null,
  });
  seedPool.mockImplementation((_h: string, _c: unknown, pool: { videoItems: unknown[]; seen: Set<string> }) => {
    for (let i = 0; i < videos; i++) {
      pool.seen.add(`v${i}`);
      pool.videoItems.push({ id: `v${i}`, caption: "", views: 0, likes: 0, comments: 0, saves: 0,
        shares: 0, createTime: 0, musicOriginal: false, musicTitle: "", musicArtist: "",
        duetEnabled: false, stitchEnabled: false, isAd: false, durationMs: 0 });
    }
  });
}

beforeEach(() => { capture.mockReset(); seedPool.mockReset(); });

describe("capture — blocked vs genuinely empty", () => {
  it("BLOCKED (zero captured, emptiness unproven) is a TRANSIENT failure, so the scheduler parks it", async () => {
    capturing(0, { genuineEmpty: false, statedVideoCount: 40, statedCountSource: "rehydration" });
    const result = await makeCapturePhase("TikTok").run({ handle: "creator" } as never, ctx);

    expect(result.outcome).toBe("failed");
    expect(result.failureClass).toBe("transient");
    expect(result.attempts[0]?.detail).toContain("unproven");
  });

  it("an ABSENT assessment is also unproven — the safe reading is 'blocked', not 'no such creator'", async () => {
    // A degraded capture loses profile fields, which is exactly when the
    // assessment goes missing. Reading that as "genuinely empty" is how a live
    // creator gets a no-content rejection.
    capturing(0, undefined);
    const result = await makeCapturePhase("TikTok").run({ handle: "creator" } as never, ctx);
    expect(result.outcome).toBe("failed");
    expect(result.failureClass).toBe("transient");
  });

  it("GENUINE EMPTY still terminates fast and is never retried", async () => {
    capturing(0, { genuineEmpty: true, statedVideoCount: 0, statedCountSource: "xhr" });
    const result = await makeCapturePhase("TikTok").run({ handle: "creator" } as never, ctx);

    expect(result.outcome).toBe("genuine_empty");
    expect(result.failureClass).toBe("genuine_empty");
  });

  it("a capture WITH content is complete, unchanged", async () => {
    capturing(7, { genuineEmpty: false });
    const result = await makeCapturePhase("TikTok").run({ handle: "creator" } as never, ctx);
    expect(result.outcome).toBe("complete");
    expect(result.failureClass).toBeUndefined();
  });

  it("a blocked capture still BANKS what it read, so an exhausted retry can commit from it", async () => {
    // The profile itself usually survives a block; only the content list is
    // missing. Discarding the stats would make the committed-with-gap outcome
    // empty rather than thin.
    capturing(0, { genuineEmpty: false });
    const result = await makeCapturePhase("TikTok").run({ handle: "creator" } as never, ctx);

    const out = result.output as { stats?: typeof STATS; pool?: { videoItems: unknown[] } };
    expect(out.stats).toEqual(STATS);
    expect(out.pool?.videoItems).toEqual([]);
  });
});
