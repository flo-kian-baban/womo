import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { makeRequest, PlacesSearchResult } from "./map";
import { callDataApi } from "./dataApi";

type ApiStatusEntry = {
  name: string;
  status: "ok" | "limited" | "down";
  message: string;
  checkedAt: number;
};

async function probeGoogleMaps(): Promise<ApiStatusEntry> {
  const start = Date.now();
  try {
    const result = await makeRequest<PlacesSearchResult>(
      "/maps/api/place/textsearch/json",
      { query: "Starbucks Toronto" }
    );
    const ok = result.status === "OK" || result.status === "ZERO_RESULTS";
    return {
      name: "Google Maps",
      status: ok ? "ok" : "limited",
      message: ok ? `Responding (${Date.now() - start}ms)` : `Status: ${result.status}`,
      checkedAt: Date.now(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isQuota = msg.includes("OVER_QUERY_LIMIT") || msg.includes("429") || msg.includes("quota");
    return {
      name: "Google Maps",
      status: "down",
      message: isQuota ? "Daily quota reached — resets at midnight Pacific" : `Error: ${msg.slice(0, 80)}`,
      checkedAt: Date.now(),
    };
  }
}

async function probeYouTube(): Promise<ApiStatusEntry> {
  const start = Date.now();
  try {
    const result = await callDataApi("Youtube/search", {
      query: { q: "test", type: "video", hl: "en", gl: "US" },
    }) as { items?: unknown[] };
    const ok = Array.isArray(result?.items);
    return {
      name: "YouTube Data API",
      status: ok ? "ok" : "limited",
      message: ok ? `Responding (${Date.now() - start}ms)` : "Unexpected response format",
      checkedAt: Date.now(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isQuota = msg.includes("quota") || msg.includes("429") || msg.includes("403");
    return {
      name: "YouTube Data API",
      status: "down",
      message: isQuota ? "Daily quota reached — resets at midnight Pacific" : `Error: ${msg.slice(0, 80)}`,
      checkedAt: Date.now(),
    };
  }
}

async function probeYelp(): Promise<ApiStatusEntry> {
  const start = Date.now();
  try {
    // Yelp is scraped via HTTP — probe with a lightweight HEAD request
    const response = await fetch(
      "https://www.yelp.com/search?find_desc=coffee&find_loc=Toronto",
      {
        method: "HEAD",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ConnexBot/1.0)" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (response.status === 200 || response.status === 301 || response.status === 302) {
      return {
        name: "Yelp",
        status: "ok",
        message: `Reachable (${Date.now() - start}ms)`,
        checkedAt: Date.now(),
      };
    }
    if (response.status === 403 || response.status === 429) {
      return {
        name: "Yelp",
        status: "down",
        message: "Rate limited — try again later",
        checkedAt: Date.now(),
      };
    }
    return {
      name: "Yelp",
      status: "limited",
      message: `HTTP ${response.status}`,
      checkedAt: Date.now(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "Yelp",
      status: "down",
      message: `Unreachable: ${msg.slice(0, 80)}`,
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

  notifyOwner: adminProcedure
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
