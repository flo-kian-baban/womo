/**
 * INSTAGRAM IDENTITY HARNESS — the regression gate for porting Instagram onto
 * the phase contract (S4).
 *
 * ─── Why this exists, and why it is shaped like this ────────────────────────
 * TikTok's assembly is proven against `frozenPreSeamAssembly`, a verbatim copy
 * of the pre-seam code kept as a museum piece. Instagram has no such copy — the
 * MONOLITH is its reference, and porting it to the contract is exactly what
 * removes that reference from the live path.
 *
 * So a real monolith run recorded its banked inputs AND the evidence text it
 * produced from them (`monolithBaseline.instagram*.json`, captured via
 * WOMO_MONOLITH_BASELINE). This asserts the SHARED assembly reproduces that text
 * from the same inputs. Same proof shape as the TikTok harness, with a recorded
 * reference instead of a frozen function.
 *
 * ─── What it cannot prove ───────────────────────────────────────────────────
 * That two live Instagram scrapes agree — they never do. This isolates OUR
 * assembly of a fixed input from the network's variance, exactly as the TikTok
 * harness does.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import {
  assembleCreatorResearchResult,
  type BankedCreatorEvidence,
} from "./webResearch";
import { toolsetFor } from "./phases/platformTools";

const FIXTURE_DIR = path.join(import.meta.dirname, "__fixtures__");

interface MonolithBaseline {
  banked: BankedCreatorEvidence;
  extras: string;
  expectedEvidenceSummary: string;
}

const baselines = existsSync(FIXTURE_DIR)
  ? readdirSync(FIXTURE_DIR)
      .filter(f => f.startsWith("monolithBaseline.instagram") && f.endsWith(".json"))
      .map(f => ({ name: f, data: JSON.parse(readFileSync(path.join(FIXTURE_DIR, f), "utf8")) as MonolithBaseline }))
  : [];

describe("instagram identity harness", () => {
  it("has at least one recorded monolith baseline to prove against", () => {
    expect(baselines.length).toBeGreaterThan(0);
  });

  for (const { name, data } of baselines) {
    describe(name, () => {
      it("the baseline is non-trivial (guards against a vacuous pass)", () => {
        // A fixture that is empty would make every assertion below pass while
        // proving nothing. The bar is per-platform: Instagram has no search
        // augmentation and no 6-3-3 sample, so the meaningful signals are posts,
        // titles and evidence size.
        const b = data.banked;
        expect(b.platform).toBe("Instagram");
        expect(b.collection.discoveredVideoPool?.length ?? 0).toBeGreaterThanOrEqual(5);
        expect(b.prepared.allTitles.length).toBeGreaterThanOrEqual(5);
        expect(b.prepared.rawKeywords.length).toBeGreaterThan(0);
        expect(b.derived.contentThemeLabels.length).toBeGreaterThan(0);
        expect(data.expectedEvidenceSummary.length).toBeGreaterThan(2000);
      });

      it("records that Instagram computes NO engagement signals or longitudinal sample", () => {
        // Not an accident of capture: Instagram has never computed either, and
        // the contract now records the absence instead of a fabricated empty.
        expect(data.banked.collection.engagementSignals).toBeUndefined();
        expect(data.banked.collection.longitudinalSample).toBeUndefined();
      });

      it("EVIDENCE SUMMARY is byte-identical to what the monolith produced", () => {
        // The one that matters: this is the text handed to Jason's extraction.
        const rebuilt = assembleCreatorResearchResult(data.banked, data.extras);
        expect(rebuilt.evidenceSummary).toBe(data.expectedEvidenceSummary);
      });

      it("reproduces the monolith's sociologicalFieldsComputed=false", () => {
        // Absent engagement signals must land as false through the shared path,
        // with no Instagram special case.
        const rebuilt = assembleCreatorResearchResult(data.banked, data.extras);
        expect(rebuilt.sociologicalFieldsComputed).toBe(false);
      });

      it("assembly is pure and does not mutate the banked input", () => {
        const before = JSON.stringify(data.banked);
        const a = assembleCreatorResearchResult(data.banked, data.extras);
        const b = assembleCreatorResearchResult(data.banked, data.extras);
        expect(a.evidenceSummary).toBe(b.evidenceSummary);
        expect(JSON.stringify(data.banked)).toBe(before);
      });
    });
  }
});

describe("instagram evidenceExtras", () => {
  it("returns the recorded extras for the recorded capture", () => {
    // The live captures produced an EMPTY block: is_business_account is set only
    // by the GraphQL scrape path, and both captures came back via
    // playwright-mobile-xhr. Asserting the recorded value keeps that honest
    // rather than pretending the fixtures exercise the non-empty branch.
    for (const { data } of baselines) {
      expect(data.extras).toBe("");
    }
  });

  it("appends the business block VERBATIM when the account is a business one", () => {
    // The branch the live fixtures cannot reach — exercised synthetically and
    // labelled as such.
    const extras = toolsetFor("Instagram").evidenceExtras({
      handle: "shop",
      capture: {
        nativeProfile: {
          posts: [], source: "graphql",
          isBusinessAccount: true, category: "Restaurant",
          isVerified: true, externalUrl: "https://example.com",
        },
      },
    });
    expect(extras).toBe(
      "\nINSTAGRAM BUSINESS SIGNALS:\n  Business Account: YES\n  Category: Restaurant\n  Verified: YES\n  External URL: https://example.com",
    );
  });

  it("contributes nothing for a non-business account", () => {
    expect(toolsetFor("Instagram").evidenceExtras({
      handle: "person",
      capture: { nativeProfile: { posts: [], source: "xhr", isBusinessAccount: false, category: "", isVerified: false, externalUrl: "" } },
    })).toBe("");
  });
});
