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

## MANDATORY at packaging — `asarUnpack` must cover ffmpeg-static

Instagram reel transcription extracts the audio track before sending it to the
model (whole MP4s were refused over the size ceiling on 6 of 26 attempts and
wasted ~99% of the upload). That runs `ffmpeg` as a CHILD PROCESS, from the
bundled `ffmpeg-static` binary — which lands the same way Playwright does:

> **electron-builder packs `node_modules` into `app.asar`, and a path inside
> asar is not a real file on disk. `spawn` cannot execute it.**

Both halves are required and only one is already done:

1. **DONE, in code.** `resolveFfmpeg()` in `server/_core/voiceTranscription.ts`
   rewrites `app.asar/` → `app.asar.unpacked/` in the path `ffmpeg-static`
   resolves, verifies the candidate actually runs, and falls back to a system
   `ffmpeg` and then to null (extraction skipped, whole video sent).
2. **TO DO, in the builder config.** `asarUnpack` must include
   `**/node_modules/ffmpeg-static/**` — under pnpm the real files live under
   `node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/`, so the
   glob has to reach through `.pnpm` or the rewrite will point at a directory
   that was never extracted.

Also: `ffmpeg-static` fetches its binary in a POSTINSTALL, which pnpm 10 blocks
by default — it is listed in `pnpm.onlyBuiltDependencies` beside `electron` for
exactly that reason. A CI or fresh clone that skips build scripts gets the
package without the ~45 MB binary; `resolveFfmpeg()` degrades to the system
binary rather than failing, so the symptom is quietly larger uploads, not a
crash. Verify the binary exists in the packaged app rather than assuming.

**How to verify in the packaged app:** transcribe one reel and look for
`[voiceTranscription] ffmpeg: …app.asar.unpacked…` followed by
`extracted audio N MB video → M MB audio/mpeg`. If the log says
`system binary on PATH` inside a packaged app, the unpack glob is wrong and it
is working only because the build machine happens to have ffmpeg installed.
