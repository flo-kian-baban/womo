# Electron spike (de-risking wrapper — NOT the polished app)

Proves the local-only Womo app runs inside an Electron window and that
Playwright scraping works through the wrapper. No auto-update, no signing, no
packaging — that is a later session.

## Run

```bash
pnpm spike:electron
```

[main.cjs](main.cjs) spawns the **unchanged** app server as a child process
(`pnpm exec tsx server/_core/index.ts`, `PORT=3100` so it never collides with a
`pnpm start:local` on :3000), waits for readiness, and opens a window at
`http://localhost:3100`. Quitting the window sends the child SIGTERM, which
triggers the app's graceful Playwright-pool shutdown. A main-process Playwright
probe logs whether Chromium launches from Electron's own process. Logs go to
`$SPIKE_LOG` (default: `<tmpdir>/womo-electron-spike.log`).

## ⚠️ CRITICAL for the packaging session: the PLAYWRIGHT_BROWSERS_PATH trap

The app's browser-profile detection
([server/scraping/browserClient.ts:164-175](../server/scraping/browserClient.ts))
treats **`PLAYWRIGHT_BROWSERS_PATH` as a container marker**. Electron packaging
guides routinely set that variable to point at bundled browsers. If a packaged
build sets it, the scraper silently resolves the **container** profile and
relaunches Chromium with **`--single-process`** — the exact crash class
(renderer crash kills the whole browser) that took multiple sessions to
eliminate, and it would happen **only in the packaged build**, not in dev.

**The packaged app MUST set `BROWSER_PROFILE=local` in the server child's
environment.** This explicit override has top precedence in
`resolveBrowserProfile()` and is REQUIRED, not optional, per the spike sign-off.
Verify in the packaged build's boot log:
`[browserClient] Launching Chromium with stealth plugin (profile: local)`.

## What the spike deliberately does NOT cover

Packaged-app concerns (assessed in the spike report, built later): running the
server under Electron's own Node (`ELECTRON_RUN_AS_NODE` fork of a bundled
server), `asarUnpack` for Playwright (child processes cannot spawn from inside
asar), `.env` relocation to `userData`, code-signing/notarization.
