/** READ-ONLY: the ledger's own account of the newest campaigns, for comparison
 *  against what the queue view displays. */
import "dotenv/config";
import { listCampaigns, deriveCampaignState } from "../../server/queue/analysisQueue";

async function main() {
  const list = await listCampaigns(60, { includeTerminal: true });
  const recent = list.slice(0, 8);
  for (const c of recent) {
    const gaps = c.phases.filter(p => p.blockedGap).map(p => p.phase);
    const parked = c.phases.filter(p => p.nextEarliestAt && new Date(p.nextEarliestAt).getTime() > Date.now());
    console.log(
      `${c.handle}@${c.platform}  run=${c.runId.slice(0,8)}\n` +
      `   server state : ${deriveCampaignState(c.phases)}\n` +
      `   phases       : ${c.phases.map(p => `${p.phase}=${p.status}${p.failureClass ? "/" + p.failureClass : ""}${p.attemptCount > 1 ? "(a" + p.attemptCount + ")" : ""}`).join(" ")}\n` +
      `   observation  : ${c.observationId ?? "none"}\n` +
      (gaps.length ? `   blockedGap   : ${gaps.join(",")}\n` : "") +
      (parked.length ? `   parked until : ${parked.map(p => `${p.phase}@${new Date(p.nextEarliestAt!).toISOString()}`).join(",")}\n` : "") +
      (c.message ? `   message      : ${c.message.slice(0, 110)}\n` : ""),
    );
  }
  process.exit(0);
}
void main();
