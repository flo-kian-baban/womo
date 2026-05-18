// Test the correct callDataApi format
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
      body: options.body,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Data API request failed (${response.status}): ${detail}`);
  }

  const payload = await response.json().catch(() => ({}));
  if (payload && typeof payload === "object" && "jsonData" in payload) {
    try { return JSON.parse(payload.jsonData ?? "{}"); } catch { return payload.jsonData; }
  }
  return payload;
}

// Test 1: YouTube search for mrdavehill
console.log("=== YouTube search: mrdavehill comedian musician ===");
try {
  const yt = await callDataApi("Youtube/search", {
    query: { q: "Dave Hill mrdavehill comedian musician instagram", hl: "en", gl: "US" }
  });
  const contents = yt?.contents ?? [];
  for (const item of contents.slice(0, 5)) {
    const v = item?.video;
    if (v) {
      console.log("Title:", v.title);
      console.log("Desc:", (v.descriptionSnippet || "").slice(0, 150));
      console.log("---");
    }
  }
} catch(e) { console.error("YouTube failed:", e.message); }

// Test 2: Instagram Data API
console.log("\n=== Instagram API: mrdavehill ===");
try {
  const ig = await callDataApi("Instagram/get_user_info", {
    query: { username: "mrdavehill" }
  });
  console.log(JSON.stringify(ig, null, 2).slice(0, 1000));
} catch(e) { console.error("Instagram API failed:", e.message); }

// Test 3: Instagram posts
console.log("\n=== Instagram posts: mrdavehill ===");
try {
  const posts = await callDataApi("Instagram/get_user_posts", {
    query: { username: "mrdavehill" }
  });
  console.log(JSON.stringify(posts, null, 2).slice(0, 1000));
} catch(e) { console.error("Instagram posts failed:", e.message); }
