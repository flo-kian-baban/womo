import 'dotenv/config';

const FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY;

async function callDataApi(apiId, options = {}) {
  const baseUrl = FORGE_API_URL.endsWith("/") ? FORGE_API_URL : `${FORGE_API_URL}/`;
  const fullUrl = new URL("webdevtoken.v1.WebDevService/CallApi", baseUrl).toString();
  const response = await fetch(fullUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "connect-protocol-version": "1",
      authorization: `Bearer ${FORGE_API_KEY}`,
    },
    body: JSON.stringify({
      apiId,
      query: options.query,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Data API request failed (${response.status} ${response.statusText}): ${detail}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (payload && typeof payload === "object" && "jsonData" in payload) {
    try { return JSON.parse(payload.jsonData ?? "{}"); } catch { return payload.jsonData; }
  }
  return payload;
}

// Test 1: Search for ranahal videos and check if author stats are included
console.log("=== TEST 1: Video search for @ranahal ===");
try {
  const result = await callDataApi("TikTok/search_tiktok_video_general", {
    query: { keyword: "@ranahal", count: "3" }
  });
  const items = result?.data || result?.videos || result?.itemList || [];
  const arr = Array.isArray(items) ? items : [];
  console.log("Result count:", arr.length);
  if (arr.length > 0) {
    const v = arr[0];
    console.log("Author uniqueId:", v?.author?.uniqueId || v?.authorMeta?.name);
    console.log("Author stats:", JSON.stringify(v?.authorStats || v?.author?.stats || v?.authorInfo?.stats, null, 2));
    console.log("Video stats:", JSON.stringify(v?.stats, null, 2));
  }
} catch (err) {
  console.error("Search error:", err.message);
}

// Test 2: Try user info endpoint
console.log("\n=== TEST 2: TikTok user info ===");
try {
  const result = await callDataApi("TikTok/get_user_info", {
    query: { uniqueId: "ranahal" }
  });
  console.log("User info result:", JSON.stringify(result?.userInfo?.stats, null, 2));
} catch (err) {
  console.error("User info error:", err.message);
}

// Test 3: Try alternative endpoint names
console.log("\n=== TEST 3: Alternative endpoints ===");
const endpoints = [
  "TikTok/user_info",
  "TikTok/get_user",
  "TikTok/profile",
  "TikTok/get_profile_info",
];
for (const ep of endpoints) {
  try {
    const result = await callDataApi(ep, { query: { uniqueId: "ranahal" } });
    console.log(`${ep}: SUCCESS -`, JSON.stringify(result).slice(0, 100));
  } catch (err) {
    console.log(`${ep}: FAILED - ${err.message.slice(0, 80)}`);
  }
}
