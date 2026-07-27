/**
 * Screenshot every campaign state against the FORCED fixture database.
 *
 * Drives the real app at localhost:3000 (started with the womo-fixtures launch
 * config, which points DATABASE_URL at the isolated local Postgres). Nothing
 * here mocks the client — these are real renderings of real ledger rows.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "fs";

const OUT = "tmp/shots";
const BASE = "http://localhost:3000";

async function shot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) {
  await page.screenshot({ path: `${OUT}/${name}.png`, clip });
  console.log(`  ✓ ${name}.png`);
}

/** Expand one row by the handle it displays, and wait for the panel. */
async function expand(page: Page, handle: string) {
  const btn = page.locator("button[aria-expanded]").filter({ hasText: handle }).first();
  if ((await btn.getAttribute("aria-expanded")) === "false") await btn.click();
  await page.waitForTimeout(700);
  return btn;
}

async function collapseAll(page: Page) {
  const open = page.locator('button[aria-expanded="true"]');
  for (let i = await open.count(); i > 0; i--) {
    await page.locator('button[aria-expanded="true"]').first().click();
    await page.waitForTimeout(120);
  }
}

/** Bounding box of a row's whole container (header + expanded panel). */
async function boxOf(page: Page, handle: string) {
  return page.evaluate((h) => {
    const btns = Array.from(document.querySelectorAll("button[aria-expanded]"));
    const b = btns.find(x => (x.textContent ?? "").includes(h));
    const row = b?.parentElement?.parentElement;
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16 };
  }, handle);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 }, deviceScaleFactor: 2 });

  // ── The creator queue, whole ──
  await page.goto(`${BASE}/analyze/creator`, { waitUntil: "networkidle" });
  await page.waitForSelector("button[aria-expanded]", { timeout: 15_000 });
  await page.waitForTimeout(800);
  console.log("creator queue:");
  await shot(page, "01-creator-queue-all-states");

  // ── Individual state details ──
  const details: Array<[string, string]> = [
    ["soren.delacroix", "02-parked-for-a-human"],
    ["ilse.vandermeer", "03-parked-with-retry"],
    ["theo.rivas", "04-committed-with-gaps"],
    ["nadia.okafor", "05-partial-persistence"],
    ["quiet.harbour", "06-refused-empty-subject"],
    ["bram.solheim", "07-refused-min-data"],
    ["crag.wells", "08-failed"],
    ["wren.castellano", "09-finding4-ledger-vs-projection"],
    ["maya.linden", "10-complete-clean"],
  ];
  for (const [handle, name] of details) {
    await collapseAll(page);
    await expand(page, handle);
    const box = await boxOf(page, handle);
    if (!box) { console.log(`  ! ${handle} not found`); continue; }
    // Keep the clip inside the viewport; scroll the row to the top first.
    await page.evaluate((h) => {
      const btns = Array.from(document.querySelectorAll("button[aria-expanded]"));
      const b = btns.find(x => (x.textContent ?? "").includes(h));
      b?.parentElement?.parentElement?.scrollIntoView({ block: "start" });
      window.scrollBy(0, -24);
    }, handle);
    await page.waitForTimeout(400);
    const box2 = await boxOf(page, handle);
    if (!box2) continue;
    await shot(page, name, {
      x: box2.x, y: Math.max(0, box2.y),
      width: box2.width, height: Math.min(box2.height, 1200 - Math.max(0, box2.y)),
    });
  }

  // ── The brand queue: six phases, and the not-attempted Instagram case ──
  await collapseAll(page);
  await page.goto(`${BASE}/analyze/brand`, { waitUntil: "networkidle" });
  await page.waitForSelector("button[aria-expanded]", { timeout: 15_000 });
  await page.waitForTimeout(800);
  console.log("brand queue:");
  await shot(page, "11-brand-queue-six-phases");

  await expand(page, "corvidcoffee");
  await page.waitForTimeout(300);
  const bbox = await boxOf(page, "corvidcoffee");
  if (bbox) await shot(page, "12-brand-running-shape", {
    x: bbox.x, y: Math.max(0, bbox.y), width: bbox.width,
    height: Math.min(bbox.height, 1200 - Math.max(0, bbox.y)),
  });

  await collapseAll(page);
  await expand(page, "thistlepress");
  await page.waitForTimeout(300);
  const tbox = await boxOf(page, "thistlepress");
  if (tbox) await shot(page, "13-brand-instagram-not-attempted", {
    x: tbox.x, y: Math.max(0, tbox.y), width: tbox.width,
    height: Math.min(tbox.height, 1200 - Math.max(0, tbox.y)),
  });

  await browser.close();
  console.log("\ndone");
}

void main();
