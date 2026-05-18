/**
 * Deep TikTok API probe for @kaylee.nhi
 * Tests every available TikTok endpoint to find maximum data
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const FORGE_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_KEY = process.env.BUILT_IN_FORGE_API_KEY;

async function callApi(endpoint, params) {
  const url = new URL(`${FORGE_URL}/data-api/v1/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${FORGE_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: `HTTP ${res.status}`, body: text.slice(0, 200) };
  }
  return res.json();
}

const handle = "kaylee.nhi";

console.log("=".repeat(60));
console.log("DEEP TIKTOK PROBE: @" + handle);
console.log("=".repeat(60));

// 1. User info
console.log("\n--- 1. TikTok/get_user_info ---");
const userInfo = await callApi("TikTok/get_user_info", { uniqueId: handle });
const user = userInfo?.userInfo?.user ?? {};
const stats = userInfo?.userInfo?.stats ?? {};
const secUid = user?.secUid ?? "";
console.log("Display name:", user?.nickname);
console.log("Bio:", user?.signature);
console.log("Followers:", stats?.followerCount);
console.log("Following:", stats?.followingCount);
console.log("Total videos:", stats?.videoCount);
console.log("Total likes:", stats?.heartCount);
console.log("secUid:", secUid?.slice(0, 30) + "...");
console.log("Verified:", user?.verified);
console.log("Region:", user?.region);

// 2. Popular posts
if (secUid) {
  console.log("\n--- 2. TikTok/get_user_popular_posts ---");
  const popular = await callApi("TikTok/get_user_popular_posts", { secUid, count: "30" });
  const items = popular?.itemList ?? popular?.data?.itemList ?? [];
  console.log("Popular posts count:", items.length);
  for (const item of items.slice(0, 10)) {
    const desc = item?.desc ?? "";
    const playCount = item?.stats?.playCount ?? 0;
    const diggCount = item?.stats?.diggCount ?? 0;
    const commentCount = item?.stats?.commentCount ?? 0;
    const shareCount = item?.stats?.shareCount ?? 0;
    const videoId = item?.id ?? "";
    const hashtags = (item?.textExtra ?? []).filter(t => t.hashtagName).map(t => "#" + t.hashtagName);
    console.log(`  [${videoId}] "${desc.slice(0, 80)}" | views:${playCount} likes:${diggCount} comments:${commentCount} shares:${shareCount}`);
    if (hashtags.length) console.log(`    Hashtags: ${hashtags.join(", ")}`);
  }
  
  // 3. Try to get video list (different from popular)
  console.log("\n--- 3. TikTok/get_user_video_list ---");
  const videoList = await callApi("TikTok/get_user_video_list", { secUid, count: "30" });
  const vlItems = videoList?.itemList ?? videoList?.data?.itemList ?? [];
  console.log("Video list count:", vlItems.length);
  if (vlItems.length > 0) {
    for (const item of vlItems.slice(0, 10)) {
      const desc = item?.desc ?? "";
      const hashtags = (item?.textExtra ?? []).filter(t => t.hashtagName).map(t => "#" + t.hashtagName);
      console.log(`  "${desc.slice(0, 80)}"`);
      if (hashtags.length) console.log(`    Hashtags: ${hashtags.join(", ")}`);
    }
  } else {
    console.log("  Raw response keys:", Object.keys(videoList ?? {}));
    console.log("  Raw:", JSON.stringify(videoList)?.slice(0, 300));
  }
}

// 4. TikTok search for user's videos
console.log("\n--- 4. TikTok/search_tiktok_video_general (by handle) ---");
const search = await callApi("TikTok/search_tiktok_video_general", { keyword: handle });
const searchItems = search?.data ?? search?.itemList ?? [];
console.log("Search results count:", searchItems.length);
for (const item of searchItems.slice(0, 10)) {
  const desc = item?.desc ?? "";
  const authorId = item?.author?.uniqueId ?? "";
  const hashtags = (item?.textExtra ?? []).filter(t => t.hashtagName).map(t => "#" + t.hashtagName);
  const isOwn = authorId.toLowerCase() === handle.toLowerCase();
  console.log(`  [own:${isOwn}] @${authorId}: "${desc.slice(0, 80)}"`);
  if (hashtags.length && isOwn) console.log(`    Hashtags: ${hashtags.join(", ")}`);
}

// 5. Try to get comments on a video
if (secUid) {
  console.log("\n--- 5. TikTok/get_user_popular_posts (for video IDs) ---");
  const popular2 = await callApi("TikTok/get_user_popular_posts", { secUid, count: "5" });
  const items2 = popular2?.itemList ?? popular2?.data?.itemList ?? [];
  if (items2.length > 0) {
    const firstVideoId = items2[0]?.id;
    console.log("First video ID:", firstVideoId);
    
    if (firstVideoId) {
      console.log("\n--- 6. TikTok/get_video_comments ---");
      const comments = await callApi("TikTok/get_video_comments", { aweme_id: firstVideoId, count: "20" });
      const commentItems = comments?.comments ?? comments?.data?.comments ?? [];
      console.log("Comments count:", commentItems.length);
      for (const c of commentItems.slice(0, 5)) {
        const text = c?.text ?? "";
        const likes = c?.digg_count ?? 0;
        console.log(`  [${likes} likes] "${text.slice(0, 100)}"`);
      }
      if (commentItems.length === 0) {
        console.log("  Raw keys:", Object.keys(comments ?? {}));
        console.log("  Raw:", JSON.stringify(comments)?.slice(0, 400));
      }
      
      // 7. Video detail
      console.log("\n--- 7. TikTok/get_video_detail ---");
      const detail = await callApi("TikTok/get_video_detail", { aweme_id: firstVideoId });
      const videoDetail = detail?.itemInfo?.itemStruct ?? detail?.data ?? {};
      console.log("Video desc:", (videoDetail?.desc ?? "").slice(0, 100));
      const textExtra = videoDetail?.textExtra ?? [];
      const tags = textExtra.filter(t => t.hashtagName).map(t => "#" + t.hashtagName);
      console.log("Hashtags from detail:", tags.join(", "));
      console.log("Raw detail keys:", Object.keys(detail ?? {}));
    }
  }
}

// 8. Try hashtag search for food/travel
console.log("\n--- 8. TikTok/search_tiktok_video_general (food toronto) ---");
const foodSearch = await callApi("TikTok/search_tiktok_video_general", { keyword: "kaylee nhi food" });
const foodItems = foodSearch?.data ?? foodSearch?.itemList ?? [];
console.log("Food search results:", foodItems.length);
for (const item of foodItems.slice(0, 5)) {
  const desc = item?.desc ?? "";
  const authorId = item?.author?.uniqueId ?? "";
  console.log(`  @${authorId}: "${desc.slice(0, 80)}"`);
}

console.log("\n=".repeat(60));
console.log("PROBE COMPLETE");
