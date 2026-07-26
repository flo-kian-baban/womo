/**
 * EVIDENCE IDENTITY HARNESS — the acceptance criterion for the entire
 * phased-architecture program (S1, Part 6).
 *
 * ─── What this proves ───────────────────────────────────────────────────────
 * ASSEMBLY IDENTITY. Given one set of banked stage outputs, the evidence handed
 * to Jason's extraction step is BYTE-IDENTICAL between:
 *   (a) the frozen pre-seam assembly — a verbatim copy of the inline tail of
 *       researchTikTokCreator as it existed before the M1 seam (below), and
 *   (b) the current assembly — assembleCreatorResearchResult(banked).
 * It asserts byte-equality of the three surfaces that actually reach the model:
 * `evidenceSummary`, and the womo_0007 snapshot's `inputsJson` + `promptText`
 * (+ promptMeta). It also pins those bytes against a committed golden master,
 * so a later session cannot quietly drift the pure functions.
 *
 * As phases land (S2+), the ONLY thing that changes is who fills the banked
 * struct — a phase reading the ledger instead of a local variable. This harness
 * is what makes that substitution safe: any divergence in the plumbing shows up
 * here as a byte diff, before it can reach scoring.
 *
 * ─── What this CANNOT prove ─────────────────────────────────────────────────
 * LIVE SCRAPE DETERMINISM. Two live runs of the same creator legitimately
 * differ — TikTok returns different videos, view counts move, search results
 * churn. No harness can make those byte-equal, and chasing it would fail even
 * comparing today's pipeline against itself. That is precisely why the proof is
 * anchored on FIXED banked inputs: it isolates the thing the program actually
 * changes (how evidence is gathered and banked) from the thing it does not
 * touch (what the network returned that day). Live-run equivalence is verified
 * separately and structurally — matching snapshot keys/shapes plus the frozen
 * golden scoring suite — never by byte-comparing two scrapes.
 *
 * Fixtures: every `__fixtures__/bankedEvidence.*.json` is exercised, so adding a
 * fixture captured from a real run (WOMO_EVIDENCE_FIXTURE=<path>) automatically
 * extends the proof to genuine stage outputs.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assembleCreatorResearchResult,
  buildCreatorEvidenceSummary,
  type BankedCreatorEvidence,
  type CreatorResearchResult,
} from "./webResearch";
import { formatDecodedSymbolsBlock } from "./symbolDecoder";
import { buildCreatorEvidenceSnapshotPayload } from "./routers";

const FIXTURE_DIR = path.join(import.meta.dirname, "__fixtures__");
const GOLDEN_DIR = path.join(FIXTURE_DIR, "golden");

// ─── (a) FROZEN pre-seam reference ───────────────────────────────────────────
// Verbatim copy of the assembly tail of researchTikTokCreator as it stood at
// commit 2282b17 (before the M1 seam), with the former local variables read off
// the banked struct. DO NOT "improve" this function — its whole value is that
// it is a museum piece. If a future change makes this disagree with
// assembleCreatorResearchResult, the change is what is wrong.
function frozenPreSeamAssembly(b: BankedCreatorEvidence): CreatorResearchResult {
  const {
    handle,
    capture: { displayName, bio, followerCount, followingCount, videoCount, totalLikes, location },
    collection: { transcripts, musicTitles, engagementSignals, longitudinalSample, discoveredVideoPool, foreignVideosRejected },
    prepared: { allTitles, topHashtags, rawKeywords, contentThemes, transcriptExcerpts, totalViews, avgViews, engagementRate },
    derived: { contentThemeLabels, decodedSymbols: tikTokDecodedSymbols },
  } = b;

  const tikTokDecodedSymbolsBlock = tikTokDecodedSymbols ? formatDecodedSymbolsBlock(tikTokDecodedSymbols) : "";

  const evidenceSummary = buildCreatorEvidenceSummary({
    handle, platform: "TikTok", displayName, bio, followerCount, videoCount,
    totalLikes, totalViews, avgViews, engagementRate, location,
    videoTitles: allTitles, topHashtags, rawKeywords, contentThemeLabels, contentThemes,
    musicSignals: musicTitles, transcripts, engagementSignals,
    decodedSymbolsBlock: tikTokDecodedSymbolsBlock,
  });

  // Compute data confidence level
  const dataConfidenceLevel: CreatorResearchResult["dataConfidenceLevel"] =
    transcripts.length >= 6 ? "high" :
      transcripts.length >= 3 ? "medium" :
        "low";

  return {
    handle, platform: "TikTok", displayName, bio, followerCount, followingCount, videoCount,
    totalLikes, totalViews, avgViews, engagementRate, location,
    profileUrl: `https://www.tiktok.com/@${handle}`,
    recentVideoTitles: allTitles, topHashtags, rawKeywords,
    contentThemeLabels, contentThemes,
    transcripts, transcriptCount: transcripts.length, transcriptExcerpts,
    decodedSymbols: tikTokDecodedSymbols as Record<string, unknown> | null,
    evidenceSummary,
    longitudinalSample,
    culturalVelocity: longitudinalSample?.culturalVelocity,
    dataConfidenceLevel,
    // Session 8: computed iff the engagement-signals block was built (sampled videos).
    sociologicalFieldsComputed: engagementSignals.totalSampled > 0,
    foreignVideosRejected,
    discoveredVideoPool,
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function loadFixtures(): Array<{ name: string; banked: BankedCreatorEvidence }> {
  const files = readdirSync(FIXTURE_DIR)
    .filter(f => f.startsWith("bankedEvidence.") && f.endsWith(".json"))
    .sort();
  return files.map(f => ({
    name: f.replace(/^bankedEvidence\.|\.json$/g, ""),
    banked: JSON.parse(readFileSync(path.join(FIXTURE_DIR, f), "utf-8")) as BankedCreatorEvidence,
  }));
}

const fixtures = loadFixtures();

describe("evidence identity harness", () => {
  it("has at least one banked-evidence fixture to prove against", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)("fixture: $name", ({ name, banked }) => {
    const reference = frozenPreSeamAssembly(banked);
    const current = assembleCreatorResearchResult(banked);

    it("evidenceSummary is BYTE-IDENTICAL (the text the model actually reads)", () => {
      expect(current.evidenceSummary).toBe(reference.evidenceSummary);
      // Guard against a vacuous pass on an empty summary.
      expect(current.evidenceSummary!.length).toBeGreaterThan(200);
    });

    it("the whole CreatorResearchResult is byte-identical, field for field", () => {
      expect(JSON.stringify(current)).toBe(JSON.stringify(reference));
    });

    it("womo_0007 snapshot inputsJson + promptText + promptMeta are byte-identical", () => {
      const refSnap = buildCreatorEvidenceSnapshotPayload(banked.handle, "TikTok", reference.evidenceSummary, reference);
      const curSnap = buildCreatorEvidenceSnapshotPayload(banked.handle, "TikTok", current.evidenceSummary, current);
      expect(curSnap.inputsJson).toBe(refSnap.inputsJson);
      expect(curSnap.promptText).toBe(refSnap.promptText);
      expect(JSON.stringify(curSnap.promptMeta)).toBe(JSON.stringify(refSnap.promptMeta));
      // The prompt must actually carry the evidence, or byte-equality is trivial.
      expect(curSnap.promptText).toContain(banked.handle);
      expect(curSnap.promptText.length).toBeGreaterThan(200);
    });

    it("matches the committed golden master (catches pure-function drift)", () => {
      const goldenPath = path.join(GOLDEN_DIR, `${name}.evidenceSummary.txt`);
      if (!existsSync(goldenPath)) {
        throw new Error(
          `Missing golden master: ${goldenPath}\n` +
          `Regenerate deliberately (and review the diff) with:\n` +
          `  pnpm exec tsx server/__fixtures__/regenerateGolden.ts`,
        );
      }
      expect(current.evidenceSummary).toBe(readFileSync(goldenPath, "utf-8"));
    });

    it("assembly is pure: repeatable output, and the banked input is never mutated", () => {
      const before = JSON.stringify(banked);
      const again = assembleCreatorResearchResult(banked);
      expect(JSON.stringify(again)).toBe(JSON.stringify(current));
      expect(JSON.stringify(banked)).toBe(before);
    });

    it("exercises the evidence blocks that make this fixture meaningful", () => {
      // A fixture that renders no engagement/transcript/symbol blocks would make
      // byte-equality easy and worthless. Assert the summary is fully loaded.
      const s = current.evidenceSummary!;
      expect(s).toContain("TRANSCRIPT");
      expect(banked.collection.engagementSignals.totalSampled).toBeGreaterThan(0);
      expect(banked.derived.decodedSymbols).toBeTruthy();
      expect(banked.prepared.allTitles.length).toBeGreaterThan(0);
    });
  });
});
