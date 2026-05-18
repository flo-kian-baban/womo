const BASE = process.env.BUILT_IN_FORGE_API_URL;
const KEY = process.env.BUILT_IN_FORGE_API_KEY;

async function callDataApi(apiId, options = {}) {
  const baseUrl = BASE.endsWith('/') ? BASE : `${BASE}/`;
  const fullUrl = new URL('webdevtoken.v1.WebDevService/CallApi', baseUrl).toString();

  const response = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'connect-protocol-version': '1',
      authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({ apiId, query: options.query, body: options.body, path_params: options.pathParams }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${response.status}: ${detail.slice(0, 300)}`);
  }

  const payload = await response.json().catch(() => ({}));
  if (payload && typeof payload === 'object' && 'jsonData' in payload) {
    try { return JSON.parse(payload.jsonData ?? '{}'); }
    catch { return payload.jsonData; }
  }
  return payload;
}

async function main() {
  // Get secUid properly - it's nested differently
  console.log('=== TikTok: get_user_info ===');
  const r = await callDataApi('TikTok/get_user_info', { query: { uniqueId: 'alkhussein' } });
  
  // The secUid is in r.userInfo.user.secUid (not r.data.userInfo...)
  const secUid = r?.userInfo?.user?.secUid;
  console.log('secUid:', secUid);
  console.log('Followers:', r?.userInfo?.stats?.followerCount);
  console.log('Bio:', r?.userInfo?.user?.signature);

  if (secUid) {
    console.log('\n=== TikTok: get_user_popular_posts ===');
    const posts = await callDataApi('TikTok/get_user_popular_posts', { query: { secUid, count: 5 } });
    const videos = posts?.data?.itemList ?? posts?.itemList ?? [];
    console.log('Videos found:', videos.length);
    videos.slice(0, 5).forEach(v => console.log(' -', v.id, '|', v.desc?.slice(0, 80)));

    if (videos.length > 0) {
      const videoId = videos[0].id;
      
      // Check video detail for subtitle URLs
      console.log('\n=== TikTok: get_video_detail for', videoId, '===');
      try {
        const detail = await callDataApi('TikTok/get_video_detail', { query: { videoId } });
        const detailStr = JSON.stringify(detail);
        
        // Look for subtitle/caption/SRT data
        const hasSubtitle = detailStr.toLowerCase().includes('subtitle');
        const hasCaption = detailStr.toLowerCase().includes('caption');
        const hasSrt = detailStr.toLowerCase().includes('.srt');
        const hasVtt = detailStr.toLowerCase().includes('.vtt');
        console.log('Has subtitle:', hasSubtitle, '| Has caption:', hasCaption, '| Has .srt:', hasSrt, '| Has .vtt:', hasVtt);
        
        if (hasSubtitle) {
          const idx = detailStr.toLowerCase().indexOf('subtitle');
          console.log('Subtitle context:', detailStr.slice(Math.max(0, idx-10), idx+300));
        }
        
        // Check top-level keys
        const item = detail?.itemInfo?.itemStruct ?? detail;
        console.log('Top-level keys:', Object.keys(item ?? {}).join(', '));
      } catch (e) { console.log('Error:', e.message.slice(0, 200)); }
      
      // Try subtitle endpoint
      console.log('\n=== TikTok: get_video_subtitle ===');
      try {
        const sub = await callDataApi('TikTok/get_video_subtitle', { query: { videoId } });
        console.log(JSON.stringify(sub, null, 2).slice(0, 500));
      } catch (e) { console.log('Error:', e.message.slice(0, 200)); }
    }
  }

  // YouTube - try the correct API IDs
  console.log('\n=== YouTube: try different API IDs ===');
  for (const apiId of ['Youtube/search', 'YouTube/search', 'youtube/search', 'Youtube/search_videos']) {
    try {
      const r = await callDataApi(apiId, { query: { q: 'alkhussein toronto food', maxResults: '2' } });
      console.log(`${apiId}: SUCCESS -`, JSON.stringify(r).slice(0, 200));
      break;
    } catch (e) {
      console.log(`${apiId}: ${e.message.slice(0, 80)}`);
    }
  }
  
  // YouTube captions
  console.log('\n=== YouTube: captions API IDs ===');
  for (const apiId of ['Youtube/get_captions', 'Youtube/captions', 'Youtube/list_captions', 'Youtube/get_video_captions']) {
    try {
      const r = await callDataApi(apiId, { query: { videoId: 'dQw4w9WgXcQ', part: 'snippet' } });
      console.log(`${apiId}: SUCCESS -`, JSON.stringify(r).slice(0, 200));
    } catch (e) {
      console.log(`${apiId}: ${e.message.slice(0, 80)}`);
    }
  }
}

main().catch(console.error);
