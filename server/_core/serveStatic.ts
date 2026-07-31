/**
 * Static client serving — the packaged app's only serving path.
 *
 * ─── Why this is its own module and not part of vite.ts ─────────────────────
 * `vite.ts` imports `../../vite.config`, which imports Vite and its build
 * plugins — all devDependencies. If `serveStatic` lived beside `setupVite`
 * (where Phase 1 deleted it from), then bundling the server for the packaged
 * app would pull the whole Vite toolchain in behind it, and the bundle would
 * fail to load on a machine that has no devDependencies — which is every
 * machine that installs the .dmg.
 *
 * Splitting the two serving strategies into two modules is what lets the
 * packaged bundle contain exactly one of them. The dead branch in index.ts is
 * eliminated at build time (esbuild `--define` on WOMO_PACKAGED), so `vite`
 * never appears in `dist/server.cjs` at all — verified by grepping the bundle,
 * not assumed.
 *
 * ─── What came back from 1fa1d4c, and what deliberately did not ─────────────
 * Phase 1 ("retire the production build path") removed six things. This
 * restores ONE of them — the static file serving — plus the build scripts.
 * It does NOT restore: NODE_ENV=production crash-fast env validation, the DB
 * probe's production exit(1) branch, ENV.isProduction, or the client's
 * VITE_API_URL split machinery. Those were hosted-era concerns and the app is
 * local-first; a packaged desktop app is not a deployment.
 *
 * Note the branch key: WOMO_PACKAGED, not NODE_ENV. Reintroducing
 * NODE_ENV=production semantics is exactly how the other five would creep
 * back in, one "while we're here" at a time.
 */
import express, { type Express } from "express";
import fs from "fs";
import path from "path";

/**
 * Resolve the built client directory.
 *
 * In the packaged app the server runs as a bundled `dist/server.cjs` inside
 * `app.asar`, and the client sits beside it at `dist/public`. `__dirname` is
 * the bundle's own directory, which is correct in both the packaged layout and
 * a local `pnpm build` — but ONLY because the bundle is emitted to `dist/`
 * alongside `public/`. If the esbuild outdir ever moves, this moves with it.
 *
 * WOMO_CLIENT_DIR overrides it outright, which is what makes this testable
 * without a package.
 */
function resolveClientDir(): string {
  const override = process.env.WOMO_CLIENT_DIR;
  if (override) return override;
  return path.resolve(__dirname, "public");
}

export function serveStatic(app: Express): void {
  const distPath = resolveClientDir();

  if (!fs.existsSync(distPath)) {
    // Loud, because in a packaged app this is unrecoverable: there is no Vite
    // to fall back to and every page would 404 with no explanation. The
    // original logged and carried on, which in a desktop app means a white
    // window and no clue why.
    console.error(
      `[serveStatic] FATAL: no client build at ${distPath}. ` +
      `The packaged app cannot serve its UI. This means the build ran without ` +
      `\`vite build\`, or the esbuild outdir moved away from dist/public.`,
    );
    throw new Error(`client build missing at ${distPath}`);
  }

  console.log(`[serveStatic] serving client from ${distPath}`);
  app.use(express.static(distPath));

  // SPA fallback — any unmatched path renders the shell and the router takes
  // over client-side. Registered after express.static so real assets win.
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
