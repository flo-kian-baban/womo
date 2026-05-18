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
      multipart_form_data: options.formData,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Data API request failed (${response.status} ${response.statusText}): ${detail.slice(0, 200)}`);
  }

  const payload = await response.json().catch(() => ({}));
  if (payload && typeof payload === 'object' && 'jsonData' in payload) {
    try { return JSON.parse(payload.jsonData ?? '{}'); }
    catch { return payload.jsonData; }
  }
  return payload;
}

async function main() {
  console.log('BASE URL:', BASE?.slice(0, 50));

  // ── TikTok user info ──────────────────────────────────────────────────────
  console.log('\n=== TikTok: get_user_info ===');
  try {
    const r = await callDataApi('TikTok/get_user_info', { query: { username: 'alkhussein' } });
    console.log(JSON.stringify(r, null, 2).slice(0, 600));
    
    const secUid = r?.data?.userInfo?.user?.secUid;
    console.log('secUid:', secUid);

    if (secUid) {
      // Get video list
      console.log('\n=== TikTok: get_user_popular_posts ===');
      const posts = await callDataApi('TikTok/get_user_popular_posts', { query: { secUid, count: 5 } });
      const videos = posts?.data?.itemList ?? [];
      console.log('Videos:', videos.slice(0, 3).map(v => ({ id: v.id, desc: v.desc?.slice(0, 60) })));

      if (videos.length > 0) {
        const videoId = videos[0].id;
        
        // Try video detail to look for subtitle URLs
        console.log('\n=== TikTok: get_video_detail ===');
        const detail = await callDataApi('TikTok/get_video_detail', { query: { videoId } });
        const detailStr = JSON.stringify(detail);
        // Look for subtitle/caption data
        const subtitleMatch = detailStr.match(/"subtitleInfos":\[([^\]]*)\]/);
        const captionMatch = detailStr.match(/"captions":[^}]+/);
        console.log('Subtitle info found:', subtitleMatch ? subtitleMatch[0].slice(0, 300) : 'none');
        console.log('Caption info found:', captionMatch ? captionMatch[0].slice(0, 300) : 'none');
        
        // Try direct subtitle endpoint
        console.log('\n=== TikTok: get_video_subtitle ===');
        try {
          const sub = await callDataApi('TikTok/get_video_subtitle', { query: { videoId } });
          console.log(JSON.stringify(sub, null, 2).slice(0, 400));
        } catch (e) { console.log('Error:', e.message.slice(0, 100)); }
      }
    }
  } catch (e) { console.log('TikTok error:', e.message.slice(0, 200)); }

  // ── YouTube captions ──────────────────────────────────────────────────────
  console.log('\n=== YouTube: search_videos ===');
  try {
    const search = await callDataApi('YouTube/search_videos', { query: { q: 'alkhussein toronto halal food', maxResults: 3 } });
    console.log(JSON.stringify(search, null, 2).slice(0, 600));
    
    const items = search?.items ?? [];
    if (items.length > 0) {
      const videoId = items[0].id?.videoId;
      console.log('\n=== YouTube: get_video_captions for', videoId, '===');
      try {
        const captions = await callDataApi('YouTube/get_video_captions', { query: { videoId } });
        console.log(JSON.stringify(captions, null, 2).slice(0, 600));
      } catch (e) { console.log('Error:', e.message.slice(0, 200)); }
      
      console.log('\n=== YouTube: list_captions ===');
      try {
        const list = await callDataApi('YouTube/list_captions', { query: { videoId } });
        console.log(JSON.stringify(list, null, 2).slice(0, 600));
      } catch (e) { console.log('Error:', e.message.slice(0, 200)); }
    }
  } catch (e) { console.log('YouTube error:', e.message.slice(0, 200)); }
}

main().catch(console.error);
