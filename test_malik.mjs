/**
 * Diagnostic: what does the research layer actually return for @malik.the.prince19?
 * This runs the EXACT same code path as the server does when the user submits the form.
 */
import { config } from "dotenv";
config();

const FORGE_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_KEY = process.env.BUILT_IN_FORGE_API_KEY;

if (!FORGE_URL || !FORGE_KEY) {
  console.error("Missing BUILT_IN_FORGE_API_URL or BUILT_IN_FORGE_API_KEY");
  process.exit(1);
}

async function callDataApi(endpoint, params = {}) {
  const url = `${FORGE_URL}/data_api/request`;
  const body = { endpoint, ...params };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FORGE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

const handle = "malik.the.prince19";

console.log("=== STEP 1: TikTok user info ===");
try {
  const userInfo = await callDataApi("TikTok/get_user_info", {
    query: { uniqueId: handle },
  });
  const user = userInfo?.userInfo?.user ?? userInfo?.user ?? userInfo;
  const stats = userInfo?.userInfo?.stats ?? userInfo?.stats ?? {};
  console.log("Display name:", user?.nickname ?? "NOT FOUND");
  console.log("Bio:", user?.signature ?? "NOT FOUND");
  console.log("Followers:", stats?.followerCount ?? "NOT FOUND");
  console.log("Following:", stats?.followingCount ?? "NOT FOUND");
  console.log("Total likes:", stats?.heartCount ?? "NOT FOUND");
  console.log("Video count:", stats?.videoCount ?? "NOT FOUND");
  console.log("Verified:", user?.verified ?? false);
  console.log("secUid:", user?.secUid ?? "NOT FOUND");
  console.log("Full user keys:", Object.keys(user ?? {}));
  console.log("Full stats keys:", Object.keys(stats ?? {}));
} catch (e) {
  console.error("User info failed:", e.message);
}

console.log("\n=== STEP 2: TikTok search for handle ===");
try {
  const searchRes = await callDataApi("TikTok/search_tiktok_video_general", {
    query: { keyword: handle, count: 20 },
  });
  const items = searchRes?.item_list ?? searchRes?.data?.item_list ?? searchRes?.itemList ?? [];
  console.log(`Found ${items.length} videos`);
  for (const item of items.slice(0, 10)) {
    const desc = item?.desc ?? "";
    const author = item?.author?.uniqueId ?? item?.author?.nickname ?? "unknown";
    const plays = item?.stats?.playCount ?? item?.statistics?.play_count ?? 0;
    const music = item?.music?.title ?? "";
    const challenges = (item?.challenges ?? []).map(c => c.title ?? c.name ?? "").filter(Boolean);
    console.log(`  [${author}] "${desc}" | plays: ${plays} | music: "${music}" | tags: ${challenges.join(", ")}`);
  }
} catch (e) {
  console.error("Search failed:", e.message);
}

console.log("\n=== STEP 3: TikTok search for handle + food ===");
try {
  const searchRes = await callDataApi("TikTok/search_tiktok_video_general", {
    query: { keyword: `${handle} food`, count: 10 },
  });
  const items = searchRes?.item_list ?? searchRes?.data?.item_list ?? searchRes?.itemList ?? [];
  console.log(`Found ${items.length} videos`);
  for (const item of items.slice(0, 5)) {
    const desc = item?.desc ?? "";
    const author = item?.author?.uniqueId ?? "unknown";
    const plays = item?.stats?.playCount ?? 0;
    console.log(`  [${author}] "${desc}" | plays: ${plays}`);
  }
} catch (e) {
  console.error("Food search failed:", e.message);
}

console.log("\n=== STEP 4: TikTok popular posts (by secUid) ===");
try {
  // First get secUid
  const userInfo = await callDataApi("TikTok/get_user_info", {
    query: { uniqueId: handle },
  });
  const secUid = userInfo?.userInfo?.user?.secUid ?? "";
  console.log("secUid:", secUid ? secUid.slice(0, 30) + "..." : "NOT FOUND");

  if (secUid) {
    const postsRes = await callDataApi("TikTok/get_user_popular_posts", {
      query: { secUid, count: 20 },
    });
    const items = postsRes?.itemList ?? postsRes?.item_list ?? [];
    console.log(`Popular posts found: ${items.length}`);
    for (const item of items.slice(0, 5)) {
      const desc = item?.desc ?? "";
      const plays = item?.stats?.playCount ?? 0;
      console.log(`  "${desc}" | plays: ${plays}`);
    }
  }
} catch (e) {
  console.error("Popular posts failed:", e.message);
}

console.log("\n=== STEP 5: YouTube search for context ===");
try {
  const ytRes = await callDataApi("Youtube/search", {
    query: { q: `malik the prince19 tiktok`, hl: "en", gl: "US" },
  });
  const contents = ytRes?.contents ?? [];
  console.log(`YouTube results: ${contents.length}`);
  for (const item of contents.slice(0, 5)) {
    const v = item?.video ?? item?.channel ?? {};
    const title = v?.title ?? "";
    const desc = v?.descriptionSnippet ?? "";
    console.log(`  "${title}" — ${desc}`);
  }
} catch (e) {
  console.error("YouTube search failed:", e.message);
}

console.log("\n=== STEP 6: TikTok profile HTML scrape ===");
try {
  const res = await fetch(`https://www.tiktok.com/@${handle}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const html = await res.text();
  console.log("HTML length:", html.length);

  // Extract bio from HTML
  const sigMatch = html.match(/"signature":"([^"]+)"/);
  const nickMatch = html.match(/"nickname":"([^"]+)"/);
  const followerMatch = html.match(/"followerCount":(\d+)/);
  console.log("Signature from HTML:", sigMatch?.[1] ?? "NOT FOUND");
  console.log("Nickname from HTML:", nickMatch?.[1] ?? "NOT FOUND");
  console.log("Followers from HTML:", followerMatch?.[1] ?? "NOT FOUND");

  // Extract video descriptions
  const descMatches = html.match(/"desc":"([^"]{3,200})"/g) ?? [];
  console.log(`Video descs found in HTML: ${descMatches.length}`);
  for (const m of descMatches.slice(0, 10)) {
    console.log("  ", m.slice(0, 80));
  }
} catch (e) {
  console.error("HTML scrape failed:", e.message);
}
