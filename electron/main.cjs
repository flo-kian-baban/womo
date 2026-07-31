/**
 * Connex F.I.T. — Electron main process.
 *
 * Runs in two modes from one file:
 *   DEV       (`pnpm spike:electron`) — spawns the server through the working
 *             tree's toolchain, exactly as the de-risking spike did.
 *   PACKAGED  (.dmg) — forks a bundled `dist/server.cjs` under Electron's own
 *             Node. No pnpm, no tsx, no Vite, no working tree.
 *
 * The renderer is our own localhost app and there is deliberately NO preload
 * and NO contextBridge surface. "Check for Updates" lives in the application
 * menu, in the main process, for exactly that reason: a version check is not
 * worth opening an IPC channel into a renderer that currently has none.
 */

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const https = require("node:https");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const PACKAGED = app.isPackaged;
const REPO_ROOT = path.resolve(__dirname, "..");
const SERVER_PORT = 3100; // never collides with `pnpm start:local` on :3000
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const READINESS_TIMEOUT_MS = 60_000;
const SHUTDOWN_GRACE_MS = 8_000;

const GITHUB_RELEASES_API = "https://api.github.com/repos/flo-kian-baban/womo/releases/latest";
const GITHUB_RELEASES_PAGE = "https://github.com/flo-kian-baban/womo/releases/latest";

if (!PACKAGED) app.commandLine.appendSwitch("remote-debugging-port", "9222");

// ─── Logging ─────────────────────────────────────────────────────────────────
// In a packaged app there is no terminal, so the log file IS the boot log —
// it is where the `profile: local` proof is read from.
const logPath = process.env.SPIKE_LOG || path.join(
  PACKAGED ? app.getPath("userData") : os.tmpdir(),
  PACKAGED ? "connex-fit.log" : "womo-electron-spike.log",
);
fs.mkdirSync(path.dirname(logPath), { recursive: true });
const logStream = fs.createWriteStream(logPath, { flags: "a" });
function log(line) {
  const stamped = `[main ${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  logStream.write(stamped + "\n");
}

// ─── Part 6: config lives in userData, never in the artifact ─────────────────
/**
 * The packaged app must not ship credentials. `.env` is gitignored, holds the
 * shared database URL and the API keys, and is NEVER copied into the build —
 * the electron-builder `files` list contains only `electron/main.cjs`,
 * `dist/**` and `package.json`.
 *
 * So the packaged app reads its config from the per-user application-support
 * directory instead, via DOTENV_CONFIG_PATH, which `dotenv/config` honours
 * natively — no app-code change was needed for this.
 *
 * Returns true when a usable config exists.
 */
function ensureUserConfig() {
  const userEnvPath = path.join(app.getPath("userData"), ".env");
  if (fs.existsSync(userEnvPath)) {
    const body = fs.readFileSync(userEnvPath, "utf-8");
    const configured = /^\s*DATABASE_URL\s*=\s*\S+/m.test(body)
      && !/YOUR_PROJECT_REF|your-google-ai-studio-key/.test(body);
    return { path: userEnvPath, configured };
  }

  // First launch: seed a template the analyst can fill in. The template is
  // written here rather than shipped as a file so the artifact stays free of
  // anything resembling a credential.
  const template = [
    "# ─── Connex F.I.T. configuration ──────────────────────────────────────",
    "# Fill in the values below, save this file, then quit and reopen the app.",
    "# Get them from Kian / the team vault. This file stays on your Mac and is",
    "# never sent anywhere except to the services named.",
    "",
    "# [required] Shared Supabase connection-pooler URL — the database every",
    "# analyst shares. Analyses you run appear for everyone.",
    "DATABASE_URL=postgresql://postgres.YOUR_PROJECT_REF:YOUR_PASSWORD@aws-0-us-east-2.pooler.supabase.com:5432/postgres",
    "",
    "# [required] Google AI Studio key — the analysis model.",
    "GEMINI_API_KEY=your-google-ai-studio-key",
    "",
    "# [required for brand analysis] Google Maps Places API key.",
    "GOOGLE_MAPS_API_KEY=your-google-maps-key",
    "",
    "# [optional] Raise for hard creators, e.g. 600000 (10 min). Default 300000.",
    "# ANALYSIS_TIMEOUT_MS=300000",
    "",
  ].join("\n");
  fs.writeFileSync(userEnvPath, template, { mode: 0o600 });
  log(`first launch — wrote config template to ${userEnvPath}`);
  return { path: userEnvPath, configured: false };
}

// ─── The server child ────────────────────────────────────────────────────────
let serverChild = null;
let serverExited = null; // Promise resolving when the child is truly gone

function startServer() {
  const userConfig = ensureUserConfig();

  /*
    ── Part 4: BROWSER_PROFILE=local is MANDATORY, not defensive ─────────────
    `resolveBrowserProfile()` (server/scraping/browserClient.ts) treats
    PLAYWRIGHT_BROWSERS_PATH as a CONTAINER MARKER — it was set by our
    Dockerfile, so its presence meant "running in the deployed image". A
    packaged app must set that same variable to find its bundled Chromium,
    which would resolve the container profile and relaunch Chromium with
    --single-process: the crash class (a renderer crash kills the whole
    browser) that took multiple sessions to eliminate.

    It would happen ONLY in the packaged build and never in dev testing, which
    is what makes it worth this comment. The explicit override has top
    precedence in that function, so it wins over the marker.
  */
  const env = {
    ...process.env,
    PORT: String(SERVER_PORT),
    BROWSER_PROFILE: "local",
  };

  if (PACKAGED) {
    env.WOMO_PACKAGED = "1";
    env.DOTENV_CONFIG_PATH = userConfig.path;
    // Bundled Chromium, outside the asar (extraResources). Setting this is what
    // makes the override above mandatory rather than merely prudent.
    env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, "ms-playwright");
    // The client build sits beside the server bundle inside the asar.
    env.WOMO_CLIENT_DIR = path.join(__dirname, "..", "dist", "public");
    // Electron's own Node runs the bundle — no system Node, no pnpm, no tsx.
    env.ELECTRON_RUN_AS_NODE = "1";
  }

  const [cmd, args] = PACKAGED
    ? [process.execPath, [path.join(__dirname, "..", "dist", "server.cjs")]]
    : ["pnpm", ["exec", "tsx", "server/_core/index.ts"]];

  log(`spawning server: ${PACKAGED ? "forked bundle under ELECTRON_RUN_AS_NODE" : "pnpm exec tsx"} (PORT=${SERVER_PORT}, BROWSER_PROFILE=local)`);

  /*
    ── Part 5: SIGTERM actually reaches the server now ───────────────────────
    The spike spawned `pnpm exec tsx …`. pnpm does not forward signals to its
    child, so quitting the window SIGTERM'd the wrapper and orphaned the real
    tsx→node server — observed live: the window closed and the server kept
    port 3100, a Chromium pool and a database connection.

    Packaged mode has no wrapper at all: Electron's binary IS the process that
    receives the signal, so the app's own graceful shutdown handler (which
    closes the Playwright pool) runs. `detached: false` additionally keeps the
    child in our process group so a group kill is possible as a last resort.
  */
  serverChild = spawn(cmd, args, {
    cwd: PACKAGED ? undefined : REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  serverExited = new Promise((resolve) => {
    serverChild.on("exit", (code, signal) => {
      log(`server child exited (code=${code}, signal=${signal})`);
      serverChild = null;
      resolve();
    });
  });

  serverChild.stdout.on("data", (d) => logStream.write(d));
  serverChild.stderr.on("data", (d) => logStream.write(d));
  serverChild.on("error", (err) => log(`server spawn error: ${err.message}`));

  return userConfig;
}

/** SIGTERM, wait, then SIGKILL. Resolves only when the child is really gone. */
async function stopServer() {
  if (!serverChild) return;
  log("sending SIGTERM to server child (graceful browser-pool shutdown)");
  const pid = serverChild.pid;
  serverChild.kill("SIGTERM");

  const timedOut = await Promise.race([
    serverExited.then(() => false),
    new Promise((r) => setTimeout(() => r(true), SHUTDOWN_GRACE_MS)),
  ]);

  if (timedOut) {
    log(`server did not exit within ${SHUTDOWN_GRACE_MS}ms — SIGKILL`);
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    await Promise.race([serverExited, new Promise((r) => setTimeout(r, 2000))]);
  }
  log("server child confirmed stopped");
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
      req.setTimeout(2000, () => { req.destroy(); retry(); });
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

// ─── Part 7: Check for Updates ───────────────────────────────────────────────
/**
 * Checks GitHub Releases, compares to the running version, and — per the
 * agreed decision — tells the analyst to quit and reopen rather than
 * installing anything itself. No auto-update, no silent replacement.
 */
function compareSemver(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map(Number);
  const pb = String(b).replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(GITHUB_RELEASES_API, {
      headers: { "User-Agent": "connex-fit-updater", Accept: "application/vnd.github+json" },
    }, (res) => {
      if (res.statusCode === 404) { res.resume(); return reject(new Error("no releases published yet")); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`GitHub returned ${res.statusCode}`)); }
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on("error", reject);
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error("timed out contacting GitHub")); });
  });
}

async function checkForUpdates() {
  const current = app.getVersion();
  log(`update check — running ${current}`);
  let release;
  try {
    release = await fetchLatestRelease();
  } catch (err) {
    log(`update check failed: ${err.message}`);
    await dialog.showMessageBox({
      type: "warning",
      message: "Could not check for updates",
      detail: `${err.message}\n\nYou are running version ${current}.`,
      buttons: ["OK"],
    });
    return;
  }

  const latest = release.tag_name || release.name || "0.0.0";
  if (compareSemver(latest, current) <= 0) {
    log(`update check — ${current} is current (latest ${latest})`);
    await dialog.showMessageBox({
      type: "info",
      message: "You're up to date",
      detail: `Connex F.I.T. ${current} is the latest version.`,
      buttons: ["OK"],
    });
    return;
  }

  log(`update available: ${latest}`);
  const { response } = await dialog.showMessageBox({
    type: "info",
    message: `Version ${latest} is available`,
    detail:
      `You're running ${current}.\n\n` +
      `Download opens in your browser. When the .dmg finishes, quit Connex F.I.T., ` +
      `drag the new version into Applications, and open it again.\n\n` +
      `Because the app isn't code-signed, macOS will block the first open: go to ` +
      `System Settings → Privacy & Security and click "Open Anyway".`,
    buttons: ["Download", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) await shell.openExternal(release.html_url || GITHUB_RELEASES_PAGE);
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Check for Updates…", click: () => { void checkForUpdates(); } },
        {
          label: "Open Configuration File",
          click: () => { void shell.openPath(path.join(app.getPath("userData"), ".env")); },
        },
        { label: "Show Log", click: () => { void shell.showItemInFolder(logPath); } },
        { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { label: "Edit", submenu: [
      { role: "undo" }, { role: "redo" }, { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    ] },
    { label: "View", submenu: [
      { role: "reload" }, { role: "forceReload" }, { type: "separator" },
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" },
      { role: "togglefullscreen" },
      ...(PACKAGED ? [] : [{ role: "toggleDevTools" }]),
    ] },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "Connex F.I.T.",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  win.loadURL(SERVER_URL);
  log(`window opened at ${SERVER_URL}`);
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  log(`electron ${process.versions.electron} / node ${process.versions.node} ready (packaged=${PACKAGED})`);
  buildMenu();
  const userConfig = startServer();

  if (PACKAGED && !userConfig.configured) {
    // First launch, or a template nobody filled in. Say so plainly and put the
    // file in front of them rather than failing with database errors on every
    // page — which is what an unconfigured app looks like from the inside.
    await dialog.showMessageBox({
      type: "info",
      message: "Set up Connex F.I.T.",
      detail:
        "Before the app can run analyses it needs a database URL and two API keys.\n\n" +
        "The configuration file will open now. Fill in the values from Kian / the " +
        "team vault, save the file, then quit and reopen Connex F.I.T.",
      buttons: ["Open Configuration File"],
    });
    await shell.openPath(userConfig.path);
  }

  try {
    await waitForServer(READINESS_TIMEOUT_MS);
    log("server ready");
    createWindow();
  } catch (err) {
    log(`FATAL: ${err instanceof Error ? err.message : err}`);
    dialog.showErrorBox(
      "Connex F.I.T. could not start",
      `The analysis server did not come up.\n\nLog: ${logPath}`,
    );
    await stopServer();
    app.exit(1);
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/*
  Quit is ASYNCHRONOUS because stopping the server is. `before-quit` is
  cancelled once so the browser pool can close, then quit is re-issued. Without
  this the process would exit while SIGTERM was still in flight — which is the
  orphan bug wearing a different hat.
*/
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void stopServer().then(() => app.exit(0));
});

app.on("window-all-closed", () => app.quit());
