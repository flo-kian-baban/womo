/**
 * Electron spike — minimal wrapper (de-risking only, NOT the polished app).
 *
 * What this proves: (1) the unchanged Womo app runs inside an Electron window;
 * (2) Playwright can launch its own Chromium both from Electron's main process
 * (the probe below) and from the spawned server child (the real scraper).
 *
 * Architecture (approved in the spike work order): the app server is spawned
 * UNCHANGED as a child process on PORT=3100 using the system Node toolchain
 * (`pnpm exec tsx server/_core/index.ts`) — byte-identical runtime to
 * `pnpm start:local`, zero app-code changes. Electron only: spawn, wait for
 * readiness, open a window, forward SIGTERM on quit (which triggers the app's
 * graceful Playwright-pool shutdown in server/_core/index.ts).
 *
 * The renderer is our own localhost app, so no preload/IPC surface is needed.
 * A CDP port is exposed so the acceptance test can drive the real renderer.
 */

const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SERVER_PORT = 3100; // avoids colliding with a dev server on :3000
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const READINESS_TIMEOUT_MS = 60_000;

// Acceptance harness: lets the spike's test driver attach to the REAL renderer.
app.commandLine.appendSwitch("remote-debugging-port", "9222");

// ─── Logging ─────────────────────────────────────────────────────────────────
const logPath = process.env.SPIKE_LOG || path.join(os.tmpdir(), "womo-electron-spike.log");
const logStream = fs.createWriteStream(logPath, { flags: "a" });
function log(line) {
  const stamped = `[spike ${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  logStream.write(stamped + "\n");
}

// ─── Server child (the unchanged app) ────────────────────────────────────────
let serverChild = null;

function startServer() {
  log(`spawning server child: pnpm exec tsx server/_core/index.ts (PORT=${SERVER_PORT})`);
  // NOTE: PLAYWRIGHT_BROWSERS_PATH must never be set here — it is a container
  // marker for the app's browser-profile detection (browserClient.ts) and would
  // silently re-enable --single-process. Pass the user env through untouched.
  serverChild = spawn("pnpm", ["exec", "tsx", "server/_core/index.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(SERVER_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverChild.stdout.on("data", (d) => logStream.write(d));
  serverChild.stderr.on("data", (d) => logStream.write(d));
  serverChild.on("exit", (code, signal) => {
    log(`server child exited (code=${code}, signal=${signal})`);
    serverChild = null;
  });
}

function waitForServer(deadlineMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const req = http.get(SERVER_URL, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve();
        retry();
      });
      req.on("error", retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > deadlineMs) {
        return reject(new Error(`server not ready after ${deadlineMs}ms`));
      }
      setTimeout(tick, 500);
    };
    tick();
  });
}

// ─── Main-process Playwright probe ───────────────────────────────────────────
// Directly answers the spike's core question: can Playwright launch a separate
// Chromium from Electron's own main process? Uses the app's LOCAL-profile
// stealth args, mirrored here (wrapper code cannot import the TS module —
// source of truth: server/scraping/browserClient.ts STEALTH_ARGS).
async function playwrightProbe() {
  try {
    const { chromium } = require(path.join(REPO_ROOT, "node_modules", "playwright"));
    const browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--disable-infobars"],
    });
    const page = await browser.newPage();
    await page.goto("data:text/html,<title>probe</title>ok");
    const title = await page.title();
    await browser.close();
    log(`PROBE PASS — Playwright Chromium launched from Electron main (page title: "${title}")`);
    return true;
  } catch (err) {
    log(`PROBE FAIL — ${err instanceof Error ? err.stack : err}`);
    return false;
  }
}

// ─── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({ width: 1440, height: 900 });
  win.loadURL(SERVER_URL);
  log(`window opened at ${SERVER_URL}`);
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  log(`electron ${process.versions.electron} / node ${process.versions.node} ready`);
  startServer();
  playwrightProbe(); // independent of the server — runs concurrently
  try {
    await waitForServer(READINESS_TIMEOUT_MS);
    log("server ready");
    createWindow();
  } catch (err) {
    log(`FATAL: ${err instanceof Error ? err.message : err}`);
    app.quit();
  }
});

function stopServer() {
  if (serverChild) {
    log("sending SIGTERM to server child (graceful browser-pool shutdown)");
    serverChild.kill("SIGTERM");
  }
}

app.on("window-all-closed", () => {
  stopServer();
  app.quit();
});

app.on("before-quit", stopServer);
