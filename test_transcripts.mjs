const BASE = process.env.BUILT_IN_FORGE_API_URL;
const KEY = process.env.BUILT_IN_FORGE_API_KEY;

async function callApi(connector, action, params) {
  const res = await fetch(`${BASE}/api/data_api/call`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ connector_name: connector, action, params })
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 500) }; }
}

async function main() {
  console.log('=== TIKTOK: Get user + video IDs ===');
  const user = await callApi('tiktok', 'get_user_info', { username: 'alkhussein' });
  const secUid = user?.data?.userInfo?.user?.secUid;
  console.log('secUid:', secUid);

  if (secUid) {
    const posts = await callApi('tiktok', 'get_user_popular_posts', { secUid, count: 3 });
    const videos = posts?.data?.itemList ?? [];
    console.log('Videos:', videos.map(v => ({ id: v.id, desc: v.desc?.slice(0, 60) })));

    if (videos.length > 0) {
      const videoId = videos[0].id;
      console.log('\n=== TIKTOK: Transcript attempts for video', videoId, '===');
      
      for (const action of ['get_video_transcript', 'get_video_captions', 'get_video_subtitles', 'get_video_detail', 'get_video_comments']) {
        const r = await callApi('tiktok', action, { videoId, video_id: videoId, id: videoId });
        const summary = JSON.stringify(r).slice(0, 200);
        console.log(`${action}:`, summary);
      }
    }
  }

  console.log('\n=== YOUTUBE: Transcript attempts ===');
  // First find a YouTube video ID for alkhussein
  const ytSearch = await callApi('youtube', 'search_videos', { query: 'alkhussein toronto food', maxResults: 3 });
  const ytVideos = ytSearch?.items ?? [];
  console.log('YT videos:', ytVideos.map(v => ({ id: v.id?.videoId, title: v.snippet?.title?.slice(0, 60) })));

  if (ytVideos.length > 0) {
    const ytVideoId = ytVideos[0].id?.videoId;
    if (ytVideoId) {
      for (const action of ['get_video_captions', 'get_video_transcript', 'get_captions', 'list_captions']) {
        const r = await callApi('youtube', action, { videoId: ytVideoId, video_id: ytVideoId, id: ytVideoId });
        const summary = JSON.stringify(r).slice(0, 200);
        console.log(`YT ${action}:`, summary);
      }
    }
  }

  console.log('\n=== YOUTUBE: List available actions ===');
  const ytActions = await callApi('youtube', 'list_actions', {});
  console.log('YT actions:', JSON.stringify(ytActions).slice(0, 500));
  
  const ttActions = await callApi('tiktok', 'list_actions', {});
  console.log('TT actions:', JSON.stringify(ttActions).slice(0, 500));
}

main().catch(console.error);
