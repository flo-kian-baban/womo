import { chromium } from "playwright";
import { mkdirSync } from "fs";
const OUT = "tmp/shots";
async function main() {
  mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 1200 }, deviceScaleFactor: 2 });
  const which = process.argv[2] ?? "creator";
  const name = process.argv[3] ?? "N-natural";
  await p.goto(`http://localhost:3000/analyze/${which}`, { waitUntil: "networkidle" });
  await p.waitForSelector("button[aria-expanded]", { timeout: 20_000 });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`✓ ${name}.png`);
  await b.close();
}
void main();
