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
  // Get YouTube channel for alkhussein
  console.log('=== YouTube: channel search ===');
  const channelSearch = await callDataApi('Youtube/search', { query: { gl: 'US', hl: 'en', q: 'alkhussein toronto' } });
  const contents = channelSearch?.contents ?? [];
  
  // Find the channel
  for (const item of contents) {
    if (item.channel) {
      console.log('Channel:', JSON.stringify(item.channel).slice(0, 300));
    }
  }
  
  // Get video IDs
  const videoIds = [];
  for (const item of contents) {
    if (item.video?.videoId) videoIds.push({ id: item.video.videoId, title: item.video.title });
  }
  console.log('\nVideos found:', videoIds.length);
  videoIds.forEach(v => console.log(' -', v.id, '|', v.title?.slice(0, 70)));
  
  if (videoIds.length > 0) {
    // Get video details including description
    console.log('\n=== YouTube: get_video_details ===');
    for (const vid of videoIds.slice(0, 3)) {
      try {
        const detail = await callDataApi('Youtube/get_video_details', { query: { videoId: vid.id } });
        const desc = detail?.description ?? detail?.snippet?.description ?? detail?.details?.description;
        const keywords = detail?.keywords ?? detail?.snippet?.tags;
        console.log(`\nVideo: ${vid.title?.slice(0, 60)}`);
        console.log('Description:', desc?.slice(0, 300));
        console.log('Keywords:', keywords?.slice(0, 10));
      } catch (e) { console.log('get_video_details error:', e.message.slice(0, 100)); }
    }
    
    // Try get_video_info
    console.log('\n=== YouTube: get_video_info ===');
    try {
      const info = await callDataApi('Youtube/get_video_info', { query: { videoId: videoIds[0].id } });
      console.log(JSON.stringify(info, null, 2).slice(0, 600));
    } catch (e) { console.log('get_video_info error:', e.message.slice(0, 100)); }
  }
  
  // Also check if TikTok video detail has description/hashtag data
  console.log('\n=== TikTok: get_video_detail ===');
  // Use a hardcoded recent alkhussein video ID from the popular posts
  const ttVideoId = '7349052836534714629'; // example
  try {
    const detail = await callDataApi('TikTok/get_video_detail', { query: { videoId: ttVideoId } });
    const item = detail?.itemInfo?.itemStruct ?? detail?.data?.itemInfo?.itemStruct;
    if (item) {
      console.log('desc:', item.desc);
      console.log('textExtra:', JSON.stringify(item.textExtra?.slice(0, 5)));
      console.log('subtitleInfos:', JSON.stringify(item.video?.subtitleInfos?.slice(0, 2)));
    } else {
      console.log('Raw:', JSON.stringify(detail).slice(0, 300));
    }
  } catch (e) { console.log('Error:', e.message.slice(0, 200)); }
}

main().catch(console.error);
