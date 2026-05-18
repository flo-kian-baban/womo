// Mirrors the exact callDataApi implementation from server/_core/dataApi.ts
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
    body: JSON.stringify({
      apiId,
      query: options.query,
      body: options.body,
      path_params: options.pathParams,
    }),
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
  // TikTok uses uniqueId not username
  console.log('=== TikTok: get_user_info with uniqueId ===');
  try {
    const r = await callDataApi('TikTok/get_user_info', { query: { uniqueId: 'alkhussein' } });
    console.log(JSON.stringify(r, null, 2).slice(0, 800));
    
    const secUid = r?.data?.userInfo?.user?.secUid;
    console.log('\nsecUid:', secUid);

    if (secUid) {
      console.log('\n=== TikTok: get_user_popular_posts ===');
      const posts = await callDataApi('TikTok/get_user_popular_posts', { query: { secUid, count: 5 } });
      const videos = posts?.data?.itemList ?? [];
      console.log('Videos:', videos.slice(0, 3).map(v => ({ id: v.id, desc: v.desc?.slice(0, 70) })));

      if (videos.length > 0) {
        const videoId = videos[0].id;
        
        // Check if video detail has subtitle URLs embedded
        console.log('\n=== TikTok: get_video_detail ===');
        try {
          const detail = await callDataApi('TikTok/get_video_detail', { query: { videoId } });
          const detailStr = JSON.stringify(detail);
          // Look for subtitle data
          if (detailStr.includes('subtitle') || detailStr.includes('caption')) {
            const idx = detailStr.indexOf('subtitle');
            console.log('Subtitle context:', detailStr.slice(Math.max(0, idx-20), idx+200));
          } else {
            console.log('No subtitle/caption data in video detail');
            console.log('Keys in itemInfo:', Object.keys(detail?.itemInfo?.itemStruct ?? {}));
          }
        } catch (e) { console.log('Error:', e.message.slice(0, 200)); }
        
        // Try subtitle endpoint
        console.log('\n=== TikTok: get_video_subtitle ===');
        try {
          const sub = await callDataApi('TikTok/get_video_subtitle', { query: { videoId } });
          console.log(JSON.stringify(sub, null, 2).slice(0, 500));
        } catch (e) { console.log('Error:', e.message.slice(0, 200)); }
      }
    }
  } catch (e) { console.log('TikTok error:', e.message.slice(0, 300)); }

  // YouTube - use body not query for search
  console.log('\n=== YouTube: search_videos ===');
  try {
    const search = await callDataApi('YouTube/search_videos', { body: { q: 'alkhussein toronto halal food', maxResults: 3 } });
    console.log(JSON.stringify(search, null, 2).slice(0, 600));
  } catch (e) {
    console.log('body error:', e.message.slice(0, 200));
    // Try with query
    try {
      const search2 = await callDataApi('YouTube/search_videos', { query: { q: 'alkhussein toronto halal food', maxResults: '3' } });
      console.log(JSON.stringify(search2, null, 2).slice(0, 600));
    } catch (e2) { console.log('query error:', e2.message.slice(0, 200)); }
  }
  
  // YouTube captions - try with a known video
  console.log('\n=== YouTube: list_captions for known video ===');
  // Use a MrBeast video ID as test
  const testVid = 'fHsa9DqmId8';
  try {
    const caps = await callDataApi('YouTube/list_captions', { query: { videoId: testVid } });
    console.log(JSON.stringify(caps, null, 2).slice(0, 600));
  } catch (e) { console.log('Error:', e.message.slice(0, 200)); }
}

main().catch(console.error);
