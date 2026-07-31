# Packaging the Mac app — build, install, and what an analyst will hit

The app ships as an unsigned arm64 `.dmg`. This document is the build
procedure, the first-launch setup an analyst performs, and — most importantly —
the friction they will meet before the app ever opens.

---

## 1. Build

```bash
pnpm run package:mac
```

That runs four steps in order; each can be run alone while iterating:

| Script | What it does |
|---|---|
| `build:client` | `vite build` → `dist/public` (~1.5 MB) |
| `build:server` | esbuild → `dist/server.cjs` (~3.2 MB) |
| `build:browser` | stages Chromium into `build/ms-playwright` (190 MB) |
| `electron-builder --mac --arm64` | → `release/Connex FIT-<version>-arm64.dmg` (~253 MB) |

**arm64 only, deliberately.** A universal build roughly doubles both Electron
and Chromium for a machine we do not know we need to support. If an analyst
turns out to be on Intel, add `x64` to `build.mac.target[].arch` and rebuild —
that is a rebuild, not a redesign.

### Why the server is bundled at all

`tsx` is a devDependency and cannot ship. esbuild compiles the TypeScript
server into one CommonJS file, which Electron then forks under its **own** Node
(`ELECTRON_RUN_AS_NODE=1`) — no system Node, no pnpm, no working tree.

**Only these stay external**, because each resolves its own path or binary at
runtime and must remain a real file: `playwright`, `playwright-core`,
`playwright-extra`, `puppeteer-extra-plugin-stealth`, `ffmpeg-static`,
`pg-native`. All six are CommonJS — checked, because an ESM-only external is
exactly what broke the first build (§5).

Everything else is bundled, including the client-serving branch: `WOMO_PACKAGED`
is replaced with a literal at build time so esbuild **deletes** the Vite branch
rather than leaving it unreached. Verified by grepping the bundle — it contains
zero references to `vite`, `vite.config` or `createViteServer`.

---

## 2. First launch — what Jason does

### Before the app will open at all

The app is **not code-signed or notarized**, and on current macOS this is worse
than the old right-click-Open workaround suggests:

1. Double-clicking gives **"Apple could not verify 'Connex FIT' is free of
   malware."** There is no "Open" button on that dialog.
2. Right-click → Open **no longer clears it** on current macOS.
3. The real path is **System Settings → Privacy & Security**, scroll to the
   Security section, and click **"Open Anyway"** next to the blocked app.
   Then open the app again and confirm once more.

**This repeats on every single update**, because each downloaded `.dmg` carries
a fresh quarantine attribute. It is not a one-time cost.

Removing it requires an Apple Developer ID (US$99/yr) plus notarization. That is
a business decision, not a code one. For a single analyst the friction is
tolerable; before this goes to more people, signing should come first.

### Then: configuration

On first launch the app writes a config template to

```
~/Library/Application Support/Connex FIT/.env
```

…shows a dialog explaining what is needed, and opens the file. Jason fills in
three values from the team vault and saves:

- `DATABASE_URL` — the shared Supabase connection-pooler URL
- `GEMINI_API_KEY` — Google AI Studio
- `GOOGLE_MAPS_API_KEY` — brand analysis

Then **quit and reopen**. The app reads config only at startup.

**No credentials are ever in the artifact.** The electron-builder `files` list
contains only `electron/main.cjs`, `dist/**` and `package.json`; `.env` is
gitignored and never enters the build. Config lives per-user in Application
Support and is read via `DOTENV_CONFIG_PATH`, which `dotenv` honours natively —
no app code was changed for it.

Menu shortcuts: **Connex FIT → Open Configuration File** and **→ Show Log**.

---

## 3. Updates

**Connex FIT → Check for Updates…** in the application menu.

It queries GitHub Releases, compares against the running version, and — if a
newer one exists — offers to open the download in a browser. It does **not**
install anything. The analyst quits, drags the new version into Applications,
and reopens (through the Gatekeeper dance in §2 again).

It lives in the application menu, not as an in-app button, on purpose: a button
in the renderer would need a preload script and a `contextBridge` surface, and
the renderer currently has neither. A version check is not worth opening an IPC
channel into it.

---

## 4. The two binaries that cannot live in the archive

electron-builder packs the app into `app.asar`. A path inside asar is a virtual
archive entry, not a real file, and **`spawn` cannot execute it**. Two things
resolve their own path at runtime and therefore must be unpacked:

| Binary | Config | Where it lands |
|---|---|---|
| **ffmpeg** (audio extraction) | `asarUnpack` | `Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg` |
| **Chromium** (scraping) | `extraResources` | `Contents/Resources/ms-playwright/` |

**Verify in the packaged app, never in dev.** For ffmpeg the boot log must say:

```
[voiceTranscription] ffmpeg: /Applications/Connex FIT.app/Contents/Resources/app.asar.unpacked/…
```

If it says `system binary on PATH`, **the unpack glob is wrong** and it only
appears to work because the build machine happens to have ffmpeg installed.

The `asarUnpack` list carries two globs — the plain path and a `.pnpm` one.
electron-builder dereferences pnpm's symlinks when packing, so the plain glob
is the one that matches today; the `.pnpm` glob is insurance if the linker
strategy ever changes.

### Chromium: the headless shell only

The app launches `chromium_headless_shell` (190 MB), never full Chromium
(341 MB) — confirmed by reading the live process, not by reading docs. Playwright
launches happily from a browsers directory containing **only** the shell, also
verified. Shipping both would add 341 MB for a binary that never runs.

---

## 5. `BROWSER_PROFILE=local` is mandatory — do not remove it

This is the one that would bite silently and only in Jason's build.

`resolveBrowserProfile()` treats **`PLAYWRIGHT_BROWSERS_PATH` as a container
marker** — it was set by the old Dockerfile, so its presence meant "running in
the deployed image". The packaged app **must** set that same variable to find
its bundled Chromium. Without an override it would therefore resolve the
container profile and relaunch Chromium with `--single-process` — the crash
class (a renderer crash kills the whole browser) that took multiple sessions to
eliminate.

It would never reproduce in dev. `electron/main.cjs` sets `BROWSER_PROFILE=local`
in the forked server's environment; the explicit override has top precedence.

**How to verify after any packaging change** — from a packaged run, not a config
file:

```
[browserClient] Launching Chromium with stealth plugin (profile: local)
```

and in `pipeline_runs.error_log.memory`, `singleProcess: false`.

---

## 6. Two traps this build already hit

Recorded so they are not rediscovered.

### Dots in `productName` break the app entirely

`productName: "Connex F.I.T."` produced an app that would not launch:
`FATAL … Unable to find helper app`. macOS consumed the trailing dot as the
`.app` extension separator, so the bundle became `Connex F.I.T.app` while
`CFBundleName` kept the dot — and Electron then looked for
`Connex F.I.T. Helper.app`, which electron-builder had written as
`Connex F.I.T Helper.app`. **Keep the product name free of dots.** It is now
`Connex FIT`.

`productName` must also be **top-level** in `package.json`, not only under
`build`. `app.getName()` reads the top-level field and it decides both the
menu-bar label and the `userData` directory; with it only under `build`, config
landed in `~/Library/Application Support/connex-fit-engine` and the menu read
`connex-fit-engine`.

### An ESM-only external breaks every analysis

The first bundle used `--packages=external`, leaving every dependency as a
runtime `require()`. `p-limit@5` is `"type": "module"`; under Node's
`require(esm)` the namespace comes back where esbuild's interop expects a
CommonJS default, so `pLimit(...)` threw **"is not a function"** and every
analysis failed at the queue — while the app itself booted perfectly.

Bundling converts ESM→CJS correctly and fixes the whole class. If a package is
ever added to the external list, **check `"type"` in its package.json first**.

---

## 7. Acceptance checklist

Re-run all of this after any packaging change. A dev-mode run proves nothing.

- [ ] Launches from the `.dmg` (install to /Applications with `ditto`, not
      `cp -R` — `cp -R` breaks the framework symlinks)
- [ ] Boot log: `profile: local`
- [ ] `pipeline_runs.error_log.memory.singleProcess` = `false`
- [ ] ffmpeg log points into `app.asar.unpacked`, not a system binary
- [ ] Chromium runs from `Contents/Resources/ms-playwright/`
- [ ] One creator analysis commits end to end through the queue
- [ ] One match calculates and persists
- [ ] Quit leaves zero processes and releases port 3100
