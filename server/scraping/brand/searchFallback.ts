/**
 * Brand Search Fallback — Phase 1
 *
 * Replaces: callDataApi("Google/search") fallback in webResearch.ts
 *
 * Uses DuckDuckGo HTML search as the primary search engine (no API key,
 * no JavaScript required, no rate limiting at low volume) and falls back
 * to Google HTML search as secondary.
 */

import { fetchHtml } from "../httpClient";

// ─── Response Types ───────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

/** Matches the shape consumed at webResearch.ts:2081–2098 */
export interface WebSearchResponse {
  results: SearchResult[];
}

// ─── DuckDuckGo HTML Search ───────────────────────────────────────────────────

/**
 * Search using DuckDuckGo's HTML-only endpoint.
 * This is the most reliable fallback: no API key, no JS, no rate limits.
 */
async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    const html = await fetchHtml(url, {
      timeout: 10000,
      maxRetries: 2,
    });

    const results: SearchResult[] = [];

    // DuckDuckGo HTML results structure:
    // <a class="result__a" href="...">Title</a>
    // <a class="result__snippet">Snippet text</a>
    const resultBlocks = html.match(/<div class="result results_links[\s\S]*?<\/div>\s*<\/div>/g) ?? [];

    for (const block of resultBlocks.slice(0, 10)) {
      // Extract title + URL from the result link
      const linkMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
      if (!linkMatch) continue;

      let resultUrl = linkMatch[1];
      const title = stripHtmlTags(linkMatch[2]).trim();

      // DuckDuckGo wraps URLs in a redirect; extract the actual URL
      const actualUrlMatch = resultUrl.match(/[?&]uddg=([^&]+)/);
      if (actualUrlMatch) {
        resultUrl = decodeURIComponent(actualUrlMatch[1]);
      }

      // Extract snippet
      const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      const snippet = snippetMatch ? stripHtmlTags(snippetMatch[1]).trim() : "";

      if (title) {
        results.push({ title, snippet, url: resultUrl });
      }
    }

    console.log(`[searchFallback] DuckDuckGo: ${results.length} results for "${query}"`);
    return results;
  } catch (err) {
    console.warn(`[searchFallback] DuckDuckGo search failed:`, (err as Error).message);
    return [];
  }
}

// ─── Google HTML Search (Secondary Fallback) ──────────────────────────────────

/**
 * Search using Google's HTML search page.
 * Higher risk of being blocked, but works at low volume with realistic headers.
 */
async function searchGoogle(query: string): Promise<SearchResult[]> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=US`;

  try {
    const html = await fetchHtml(url, {
      timeout: 10000,
      maxRetries: 2,
      extraHeaders: {
        Referer: "https://www.google.com/",
      },
    });

    const results: SearchResult[] = [];

    // Google renders results in <div class="g"> blocks
    // Title is in <h3>..., URL in <a href="...">, snippet in data-sncf or span
    const resultBlocks = html.match(/<div class="g"[\s\S]*?<\/div><\/div><\/div>/g) ??
      html.match(/<div class="[^"]*g[^"]*"[\s\S]{100,3000}?<\/div>/g) ?? [];

    for (const block of resultBlocks.slice(0, 10)) {
      // Extract URL
      const urlMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
      const resultUrl = urlMatch?.[1] ?? "";
      if (!resultUrl || resultUrl.includes("google.com")) continue;

      // Extract title from <h3>
      const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
      const title = titleMatch ? stripHtmlTags(titleMatch[1]).trim() : "";

      // Extract snippet — various patterns Google uses
      const snippetMatch =
        block.match(/<span class="[^"]*"[^>]*>([\s\S]{30,500}?)<\/span>/g) ??
        block.match(/<div[^>]*data-sncf[^>]*>([\s\S]*?)<\/div>/);
      let snippet = "";
      if (snippetMatch) {
        // Take the longest span as the snippet
        if (Array.isArray(snippetMatch)) {
          const texts = snippetMatch.map(m => stripHtmlTags(m).trim());
          snippet = texts.sort((a, b) => b.length - a.length)[0] ?? "";
        } else {
          snippet = stripHtmlTags(snippetMatch[1] ?? "").trim();
        }
      }

      if (title) {
        results.push({ title, snippet, url: resultUrl });
      }
    }

    console.log(`[searchFallback] Google: ${results.length} results for "${query}"`);
    return results;
  } catch (err) {
    console.warn(`[searchFallback] Google search failed:`, (err as Error).message);
    return [];
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Search the web for a query. Primary: DuckDuckGo. Fallback: Google.
 * Replaces `callDataApi("Google/search", { query: { q, gl, hl } })`.
 */
export async function searchWeb(
  query: string,
  _options?: { gl?: string; hl?: string },
): Promise<WebSearchResponse> {
  // Try DuckDuckGo first
  let results = await searchDuckDuckGo(query);

  // Fall back to Google if DuckDuckGo returned nothing
  if (results.length === 0) {
    console.log(`[searchFallback] DuckDuckGo returned no results, trying Google...`);
    results = await searchGoogle(query);
  }

  return { results };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}
