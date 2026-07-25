import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { setupVite } from "./vite";

// ─── Process-level safety net ────────────────────────────────────────────────
// A single unhandled rejection or uncaught exception must not silently wedge or
// crash the instance without a trace. Log both; for uncaughtException the process
// is in an undefined state, so exit and restart clean (tsx watch respawns it in
// dev; otherwise relaunch manually).
process.on("unhandledRejection", (reason) => {
  console.error("[process] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[process] Uncaught exception:", err);
  process.exit(1);
});

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // Local-only app: always serve the client through Vite middleware (no build
  // step, no static dist). Runs the same regardless of NODE_ENV.
  await setupVite(app, server);

  // ─── Port binding ────────────────────────────────────────────────────────────
  // Bind directly to process.env.PORT (default 3000) — no port scanning.
  // If the port is taken, fail immediately with a clear error; set PORT in .env
  // to run on a different one.
  const port = parseInt(process.env.PORT || "3000", 10);

  server.listen(port, () => {
    console.log(`[server] Listening on port ${port}`);

    // Eager DB connectivity probe (select 1) — the pg Pool constructor never
    // connects, so without this a dead database only surfaces at first query.
    // Non-fatal: logs a warning so a bad DATABASE_URL is visible at boot.
    import("../db").then(({ probeDatabaseConnectivity }) =>
      probeDatabaseConnectivity().catch(err =>
        console.error("[startup] DB connectivity probe threw unexpectedly:", err),
      )
    );

    // Pre-flight browser check — runs in background AFTER the server is
    // already listening so health checks are never blocked by Playwright init.
    import("../scraping/browserClient").then(({ ensureBrowser }) =>
      ensureBrowser()
        .then(() => console.log("[startup] Playwright browser ready"))
        .catch(err => {
          console.warn(
            "[startup] Playwright browser check failed — scraping features will not work.",
            err instanceof Error ? err.message : err,
          );
        })
    );
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error("[server] Failed to bind port:", err.message);
    process.exit(1);
  });

  // ─── Graceful shutdown on SIGTERM ────────────────────────────────────────────
  // NOT dead code in local-only mode: tsx watch terminates the child with SIGTERM
  // on every file-change restart. Closing the Playwright browser pool here is what
  // prevents leaked headless Chromium processes accumulating across dev restarts.
  process.on("SIGTERM", () => {
    console.log("[server] SIGTERM received — shutting down gracefully");
    server.close(async () => {
      try {
        const { shutdown } = await import("../scraping/browserClient");
        await shutdown();
        console.log("[server] Shutdown complete");
      } catch {
        // ignore shutdown errors
      }
      process.exit(0);
    });
    // Force-kill after 10s if graceful shutdown hangs
    setTimeout(() => {
      console.error("[server] Shutdown timeout — force exiting");
      process.exit(1);
    }, 10_000);
  });
}

startServer().catch(console.error);
