// Use the same pattern as server/_core/dataApi.ts
const BASE = process.env.BUILT_IN_FORGE_API_URL;
const KEY = process.env.BUILT_IN_FORGE_API_KEY;

async function callDataApi(connectorName, action, params) {
  const url = `${BASE}/api/data_api/call`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      connector_name: connectorName,
      action,
      params,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.log(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return null;
  }
  return res.json();
}

async function main() {
  // Step 1: Get TikTok user info correctly
  console.log('=== TikTok user info ===');
  const userInfo = await callDataApi('tiktok', 'get_user_info', { username: 'alkhussein' });
  console.log(JSON.stringify(userInfo, null, 2).slice(0, 600));

  const secUid = userInfo?.data?.userInfo?.user?.secUid;
  console.log('\nsecUid:', secUid);

  if (secUid) {
    // Step 2: Get video list
    console.log('\n=== Popular posts ===');
    const posts = await callDataApi('tiktok', 'get_user_popular_posts', { secUid, count: 5 });
    const videos = posts?.data?.itemList ?? [];
    console.log('Videos found:', videos.length);
    videos.slice(0, 3).forEach(v => console.log(' -', v.id, '|', v.desc?.slice(0, 80)));

    if (videos.length > 0) {
      const videoId = videos[0].id;
      console.log('\n=== Video detail for', videoId, '===');
      const detail = await callDataApi('tiktok', 'get_video_detail', { videoId });
      console.log(JSON.stringify(detail, null, 2).slice(0, 800));
      
      // Check if there are subtitle URLs in the video detail
      const subtitleLinks = JSON.stringify(detail).match(/subtitle[^"]*url[^"]*"[^"]+"/gi);
      console.log('\nSubtitle URLs found:', subtitleLinks);
    }
  }

  // Step 3: YouTube captions
  console.log('\n=== YouTube search ===');
  const ytSearch = await callDataApi('youtube', 'search_videos', { query: 'alkhussein toronto halal food tiktok', maxResults: 3 });
  console.log(JSON.stringify(ytSearch, null, 2).slice(0, 600));

  // Step 4: Try YouTube captions API
  // MrBeast video as a known test case
  const testVideoId = 'dQw4w9WgXcQ'; // Rick Astley - well-known video with captions
  console.log('\n=== YouTube captions for test video ===');
  const captions = await callDataApi('youtube', 'get_video_captions', { videoId: testVideoId });
  console.log(JSON.stringify(captions, null, 2).slice(0, 600));
  
  const captionsList = await callDataApi('youtube', 'list_captions', { videoId: testVideoId });
  console.log('\nlist_captions:', JSON.stringify(captionsList, null, 2).slice(0, 600));
}

main().catch(console.error);
