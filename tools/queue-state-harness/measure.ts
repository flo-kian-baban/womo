/** READ-ONLY measurement for Gap B: what does a per-row capture-health fetch cost? */
import "dotenv/config";
import { listCampaigns } from "../../server/queue/analysisQueue";
import { getRunDiagnostics } from "../../server/db";

const t = async <T,>(f: () => Promise<T>): Promise<[T, number]> => {
  const s = Date.now(); const r = await f(); return [r, Date.now() - s];
};

async function main() {
  const [list, listMs] = await t(() => listCampaigns(50, { includeTerminal: true }));
  console.log(`listCampaigns(50, includeTerminal): ${listMs}ms → ${list.length} campaigns`);
  const withObs = list.filter(c => c.observationId);
  console.log(`  committed (have observationId): ${withObs.length}`);

  const sample = withObs.slice(0, 8);
  const times: number[] = [];
  for (const c of sample) {
    const [, ms] = await t(() => getRunDiagnostics(c.observationId!));
    times.push(ms);
    console.log(`  getRunDiagnostics ${c.handle}@${c.platform}: ${ms}ms`);
  }
  if (times.length) {
    const sum = times.reduce((a, b) => a + b, 0);
    console.log(`\nserial mean ${Math.round(sum / times.length)}ms, total ${sum}ms for ${times.length}`);
    const [, parMs] = await t(() => Promise.all(sample.map(c => getRunDiagnostics(c.observationId!))));
    console.log(`same ${sample.length} in PARALLEL (what a list render does): ${parMs}ms`);
  }
  process.exit(0);
}
void main();
