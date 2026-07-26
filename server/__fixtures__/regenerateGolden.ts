/**
 * Regenerate the identity harness's golden masters — DELIBERATE ACT ONLY.
 *
 *   pnpm exec tsx server/__fixtures__/regenerateGolden.ts
 *
 * The golden files are the committed bytes of the evidence summary for each
 * banked fixture. They exist to catch UNINTENDED drift in the pure assembly
 * functions. Regenerating them is how you record an INTENDED change: run this,
 * then read the git diff carefully — every changed line is a change to what
 * Jason's engine reads. If you cannot explain a diff line, do not commit it.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { assembleCreatorResearchResult, type BankedCreatorEvidence } from "../webResearch";

const FIXTURE_DIR = path.join(import.meta.dirname);
const GOLDEN_DIR = path.join(FIXTURE_DIR, "golden");

mkdirSync(GOLDEN_DIR, { recursive: true });

const files = readdirSync(FIXTURE_DIR)
  .filter(f => f.startsWith("bankedEvidence.") && f.endsWith(".json"))
  .sort();

for (const file of files) {
  const name = file.replace(/^bankedEvidence\.|\.json$/g, "");
  const banked = JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf-8")) as BankedCreatorEvidence;
  const result = assembleCreatorResearchResult(banked);
  const out = path.join(GOLDEN_DIR, `${name}.evidenceSummary.txt`);
  writeFileSync(out, result.evidenceSummary ?? "", "utf-8");
  console.log(`wrote ${out} (${(result.evidenceSummary ?? "").length} bytes)`);
}
