const BASE = process.env.BUILT_IN_FORGE_API_URL;
const KEY = process.env.BUILT_IN_FORGE_API_KEY;

async function callDataApi(apiId, options = {}) {
  const baseUrl = BASE.endsWith('/') ? BASE : `${BASE}/`;
  const fullUrl = new URL('webdevtoken.v1.WebDevService/CallApi', baseUrl).toString();
  const response = await fetch(fullUrl, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'connect-protocol-version': '1', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ apiId, query: options.query, body: options.body, path_params: options.pathParams }),
  });
  if (!response.ok) { const d = await response.text().catch(() => ''); throw new Error(`${response.status}: ${d.slice(0, 300)}`); }
  const payload = await response.json().catch(() => ({}));
  if (payload && typeof payload === 'object' && 'jsonData' in payload) {
    try { return JSON.parse(payload.jsonData ?? '{}'); } catch { return payload.jsonData; }
  }
  return payload;
}

async function main() {
  // Parse YouTube search results properly
  console.log('=== YouTube: search for alkhussein ===');
  const yt = await callDataApi('Youtube/search', { query: { gl: 'US', hl: 'en', q: 'alkhussein toronto food' } });
  
  // The structure has "contents" array
  const contents = yt?.contents ?? [];
  console.log('Contents count:', contents.length);
  
  // Extract video IDs from the contents
  const videoIds = [];
  for (const item of contents) {
    if (item.video) {
      const vid = item.video;
      const videoId = vid.videoId;
      const title = vid.title;
      if (videoId) {
        videoIds.push(videoId);
        console.log('Video:', videoId, '|', title?.slice(0, 70));
      }
    }
  }
  
  if (videoIds.length > 0) {
    const testVideoId = videoIds[0];
    console.log('\n=== YouTube: probe caption APIs for', testVideoId, '===');
    
    // Try all possible caption API IDs
    const captionApiIds = [
      'Youtube/captions',
      'Youtube/get_captions', 
      'Youtube/video_captions',
      'Youtube/get_video_captions',
      'Youtube/transcript',
      'Youtube/get_transcript',
      'Youtube/subtitles',
    ];
    
    for (const apiId of captionApiIds) {
      try {
        const r = await callDataApi(apiId, { query: { videoId: testVideoId } });
        console.log(`✅ ${apiId}: ${JSON.stringify(r).slice(0, 200)}`);
      } catch (e) {
        console.log(`❌ ${apiId}: ${e.message.slice(0, 80)}`);
      }
    }
  }
  
  // TikTok: probe for video list with correct params
  console.log('\n=== TikTok: probe get_user_posts ===');
  const secUid = 'MS4wLjABAAAA8T7MYxIntVl-crhV2dR1X4S88utklCnyT9mLBCnqR07jSUgEczoRzEOpMl5WZ9Pq';
  
  for (const action of ['get_user_posts', 'get_user_feed', 'get_user_video_list', 'get_user_popular_posts']) {
    try {
      const r = await callDataApi(`TikTok/${action}`, { query: { secUid, count: '5', cursor: '0' } });
      const videos = r?.data?.itemList ?? r?.itemList ?? r?.data?.videos ?? [];
      console.log(`✅ TikTok/${action}: ${videos.length} videos`);
      if (videos.length > 0) {
        console.log('  First video:', videos[0].id, '|', videos[0].desc?.slice(0, 60));
        break;
      }
    } catch (e) {
      console.log(`❌ TikTok/${action}: ${e.message.slice(0, 80)}`);
    }
  }
  
  // Check if TikTok video detail has subtitle URLs
  console.log('\n=== TikTok: video detail subtitle check ===');
  // Use a known video ID from alkhussein
  try {
    const search = await callDataApi('TikTok/search_videos', { query: { keyword: 'alkhussein food toronto', count: '3' } });
    console.log('search_videos:', JSON.stringify(search).slice(0, 300));
  } catch (e) { console.log('search_videos error:', e.message.slice(0, 100)); }
}

main().catch(console.error);
