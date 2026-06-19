import { z } from "zod";
import { notifyOwner } from "./notification";
import { protectedProcedure, publicProcedure, router } from "./trpc";
import { searchYouTube } from "../scraping/youtube/searchScraper";
import { getContext, retireContext } from "../scraping/browserClient";

type ApiStatusEntry = {
  name: string;
  status: "ok" | "limited" | "down";
  message: string;
  checkedAt: number;
};

async function probeGoogleMaps(): Promise<ApiStatusEntry> {
  const start = Date.now();
  try {
    // Google Maps data is extracted via HTTP fetch — verify connectivity
    const response = await fetch("https://www.google.com/maps", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(8000),
    });
    const ok = response.ok;
    return {
      name: "Google Maps",
      status: ok ? "ok" : "limited",
      message: ok
        ? `HTTP scraping available (${Date.now() - start}ms)`
        : `HTTP ${response.status} — may be rate-limited`,
      checkedAt: Date.now(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "Google Maps",
      status: "down",
      message: `Unreachable: ${msg.slice(0, 80)}`,
      checkedAt: Date.now(),
    };
  }
}

async function probeYouTube(): Promise<ApiStatusEntry> {
  const start = Date.now();
  try {
    const result = await searchYouTube("test", { type: "video", hl: "en", gl: "US" });
    const ok = Array.isArray(result?.contents);
    return {
      name: "YouTube Scraper",
      status: ok ? "ok" : "limited",
      message: ok ? `Responding (${Date.now() - start}ms)` : "Unexpected response format",
      checkedAt: Date.now(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "YouTube Scraper",
      status: "down",
      message: `Error: ${msg.slice(0, 80)}`,
      checkedAt: Date.now(),
    };
  }
}

async function probeYelp(): Promise<ApiStatusEntry> {
  const start = Date.now();
  try {
    // Yelp is scraped via Playwright — check if Yelp is accessible without DataDome block
    const { context, page } = await getContext("desktop-chrome", 1);
    try {
      await page.goto("https://www.yelp.com", { waitUntil: "domcontentloaded", timeout: 10000 });
      const title = await page.title();
      const isBlocked = title === "Access Denied" || title.toLowerCase().includes("datadome");
      if (isBlocked) {
        return {
          name: "Yelp",
          status: "limited",
          message: `Anti-bot protection active — partial availability (${Date.now() - start}ms)`,
          checkedAt: Date.now(),
        };
      }
      return {
        name: "Yelp",
        status: "ok",
        message: `Scraping available (${Date.now() - start}ms)`,
        checkedAt: Date.now(),
      };
    } finally {
      await retireContext(context);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "Yelp",
      status: "down",
      message: `Unavailable: ${msg.slice(0, 80)}`,
      checkedAt: Date.now(),
    };
  }
}

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  apiStatus: publicProcedure.query(async () => {
    // Run all three probes in parallel — each has its own timeout/error handling
    const [googleMaps, youtube, yelp] = await Promise.all([
      probeGoogleMaps(),
      probeYouTube(),
      probeYelp(),
    ]);
    const allOk = [googleMaps, youtube, yelp].every(s => s.status === "ok");
    const anyDown = [googleMaps, youtube, yelp].some(s => s.status === "down");
    return {
      overall: allOk ? "ok" : anyDown ? "degraded" : "limited",
      sources: [googleMaps, youtube, yelp],
      checkedAt: Date.now(),
    };
  }),
});
