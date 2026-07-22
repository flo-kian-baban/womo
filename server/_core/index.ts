import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ENV } from "./env";

async function startServer() {
  const app = express();
  const server = createServer(app);

  // ─── Trust proxy ────────────────────────────────────────────────────────────
  // Required for Railway (and any reverse-proxy deployment):
  //  - Makes req.protocol return "https" correctly
  //  - Makes req.ip resolve to the real client IP (not the proxy)
  //  - Required for secure cookie detection and rate-limit IP extraction
  app.set("trust proxy", 1);

  // ─── CORS ─────────────────────────────────────────────────────────────────
  // Reads ALLOWED_ORIGINS env var (comma-separated). In Railway, set this to
  // your Vercel deployment URL, e.g. https://your-app.vercel.app
  const allowedOrigins = ENV.allowedOrigins.split(",").map(o => o.trim());
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,trpc-accept");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Health check — registered early so Railway/load-balancer probes respond
  // immediately, before any slow initialisation (e.g. Playwright browser).
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ─── Port binding ────────────────────────────────────────────────────────────
  // Bind directly to process.env.PORT — no port scanning.
  // Railway injects PORT automatically; Dockerfile EXPOSE 8080 matches.
  // If the port is unavailable, fail immediately so Railway restarts the container.
  const port = parseInt(process.env.PORT || "3000", 10);

  server.listen(port, () => {
    console.log(`[server] Listening on port ${port}`);

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
  // Railway sends SIGTERM before killing a container during deploys/restarts.
  // This allows in-flight requests to complete and the browser pool to close cleanly.
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
