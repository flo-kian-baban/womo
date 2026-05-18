/**
 * Deep TikTok API probe using the correct callDataApi format
 */
const FORGE_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_KEY = process.env.BUILT_IN_FORGE_API_KEY;

async function callDataApi(apiId, options = {}) {
  const baseUrl = FORGE_URL.endsWith("/") ? FORGE_URL : FORGE_URL + "/";
  const fullUrl = new URL("webdevtoken.v1.WebDevService/CallApi", baseUrl).toString();
  const response = await fetch(fullUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "connect-protocol-version": "1",
      authorization: `Bearer ${FORGE_KEY}`,
    },
    body: JSON.stringify({
      apiId,
      query: options.query,
      body: options.body,
      path_params: options.pathParams,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { error: `HTTP ${response.status}`, detail: text.slice(0, 200) };
  }
  const payload = await response.json().catch(() => ({}));
  if (payload && typeof payload === "object" && "jsonData" in payload) {
    try { return JSON.parse(payload.jsonData ?? "{}"); } catch { return payload.jsonData; }
  }
  return payload;
}

const handle = "kaylee.nhi";
console.log("=".repeat(60));
console.log("DEEP TIKTOK PROBE (correct format): @" + handle);
console.log("=".repeat(60));

// 1. User info
console.log("\n--- 1. TikTok/get_user_info ---");
const userInfo = await callDataApi("TikTok/get_user_info", { query: { uniqueId: handle } });
console.log("Top keys:", Object.keys(userInfo ?? {}));
const user = userInfo?.userInfo?.user ?? userInfo?.user ?? {};
const stats = userInfo?.userInfo?.stats ?? userInfo?.stats ?? {};
const secUid = user?.secUid ?? "";
console.log("Display name:", user?.nickname);
console.log("Bio:", user?.signature);
console.log("Followers:", stats?.followerCount);
console.log("Videos:", stats?.videoCount);
console.log("Likes:", stats?.heartCount);
console.log("secUid:", secUid?.slice(0, 40) + "...");

// 2. Popular posts
if (secUid) {
  console.log("\n--- 2. TikTok/get_user_popular_posts (secUid) ---");
  const popular = await callDataApi("TikTok/get_user_popular_posts", { query: { secUid, count: "30" } });
  console.log("Top keys:", Object.keys(popular ?? {}));
  const items = popular?.itemList ?? popular?.data?.itemList ?? popular?.aweme_list ?? [];
  console.log("Popular posts count:", items.length);
  const videoIds = [];
  for (const item of items.slice(0, 15)) {
    const desc = item?.desc ?? item?.aweme_info?.desc ?? "";
    const playCount = item?.stats?.playCount ?? item?.statistics?.play_count ?? 0;
    const diggCount = item?.stats?.diggCount ?? item?.statistics?.digg_count ?? 0;
    const commentCount = item?.stats?.commentCount ?? item?.statistics?.comment_count ?? 0;
    const videoId = item?.id ?? item?.aweme_id ?? "";
    const hashtags = (item?.textExtra ?? item?.text_extra ?? [])
      .filter(t => t.hashtagName ?? t.hashtag_name)
      .map(t => "#" + (t.hashtagName ?? t.hashtag_name));
    if (videoId) videoIds.push(videoId);
    console.log(`  [${videoId}] "${desc.slice(0, 80)}" | views:${playCount} likes:${diggCount} comments:${commentCount}`);
    if (hashtags.length) console.log(`    Hashtags: ${hashtags.join(", ")}`);
  }

  // 3. Try video list endpoint
  console.log("\n--- 3. TikTok/get_user_video_list ---");
  const videoList = await callDataApi("TikTok/get_user_video_list", { query: { secUid, count: "30" } });
  console.log("Top keys:", Object.keys(videoList ?? {}));
  const vlItems = videoList?.itemList ?? videoList?.data?.itemList ?? videoList?.aweme_list ?? [];
  console.log("Video list count:", vlItems.length);
  for (const item of vlItems.slice(0, 10)) {
    const desc = item?.desc ?? "";
    const hashtags = (item?.textExtra ?? []).filter(t => t.hashtagName).map(t => "#" + t.hashtagName);
    console.log(`  "${desc.slice(0, 80)}"`);
    if (hashtags.length) console.log(`    Hashtags: ${hashtags.join(", ")}`);
  }

  // 4. Try comments on first video
  if (videoIds.length > 0) {
    const firstId = videoIds[0];
    console.log(`\n--- 4. TikTok/get_video_comments (video: ${firstId}) ---`);
    const comments = await callDataApi("TikTok/get_video_comments", { query: { aweme_id: firstId, count: "20" } });
    console.log("Top keys:", Object.keys(comments ?? {}));
    const commentItems = comments?.comments ?? comments?.data?.comments ?? [];
    console.log("Comments count:", commentItems.length);
    for (const c of commentItems.slice(0, 8)) {
      const text = c?.text ?? "";
      const likes = c?.digg_count ?? 0;
      console.log(`  [${likes} likes] "${text.slice(0, 100)}"`);
    }
    if (commentItems.length === 0) {
      console.log("  Raw:", JSON.stringify(comments)?.slice(0, 400));
    }

    // 5. Video detail
    console.log(`\n--- 5. TikTok/get_video_detail (video: ${firstId}) ---`);
    const detail = await callDataApi("TikTok/get_video_detail", { query: { aweme_id: firstId } });
    console.log("Top keys:", Object.keys(detail ?? {}));
    const vd = detail?.itemInfo?.itemStruct ?? detail?.aweme_detail ?? detail?.data ?? {};
    console.log("Desc:", (vd?.desc ?? "").slice(0, 100));
    const tags = (vd?.textExtra ?? vd?.text_extra ?? []).filter(t => t.hashtagName ?? t.hashtag_name).map(t => "#" + (t.hashtagName ?? t.hashtag_name));
    console.log("Hashtags:", tags.join(", "));
  }
}

// 5. TikTok search
console.log("\n--- 6. TikTok/search_tiktok_video_general ---");
const search = await callDataApi("TikTok/search_tiktok_video_general", { query: { keyword: handle } });
console.log("Top keys:", Object.keys(search ?? {}));
const searchItems = search?.data ?? search?.itemList ?? [];
console.log("Search count:", searchItems.length);
for (const item of searchItems.slice(0, 8)) {
  const desc = item?.desc ?? "";
  const authorId = item?.author?.uniqueId ?? "";
  console.log(`  @${authorId}: "${desc.slice(0, 80)}"`);
}

// 6. Try user posts endpoint
console.log("\n--- 7. TikTok/get_user_posts ---");
const posts = await callDataApi("TikTok/get_user_posts", { query: { uniqueId: handle, count: "30" } });
console.log("Top keys:", Object.keys(posts ?? {}));
const postItems = posts?.itemList ?? posts?.data?.itemList ?? posts?.aweme_list ?? [];
console.log("Posts count:", postItems.length);
for (const item of postItems.slice(0, 10)) {
  const desc = item?.desc ?? "";
  const hashtags = (item?.textExtra ?? []).filter(t => t.hashtagName).map(t => "#" + t.hashtagName);
  console.log(`  "${desc.slice(0, 80)}"`);
  if (hashtags.length) console.log(`    Hashtags: ${hashtags.join(", ")}`);
}

// 7. Try user liked videos
console.log("\n--- 8. TikTok/get_user_liked_videos ---");
const liked = await callDataApi("TikTok/get_user_liked_videos", { query: { uniqueId: handle, count: "20" } });
console.log("Top keys:", Object.keys(liked ?? {}));

// 8. Try profile
console.log("\n--- 9. TikTok/get_user_profile ---");
const profile = await callDataApi("TikTok/get_user_profile", { query: { uniqueId: handle } });
console.log("Top keys:", Object.keys(profile ?? {}));
console.log("Raw:", JSON.stringify(profile)?.slice(0, 300));

console.log("\n" + "=".repeat(60));
console.log("PROBE COMPLETE");
