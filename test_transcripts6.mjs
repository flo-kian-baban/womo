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
  const secUid = 'MS4wLjABAAAA8T7MYxIntVl-crhV2dR1X4S88utklCnyT9mLBCnqR07jSUgEczoRzEOpMl5WZ9Pq';

  // All params must be strings for the proto API
  console.log('=== TikTok: get_user_popular_posts (count as string) ===');
  try {
    const posts = await callDataApi('TikTok/get_user_popular_posts', { query: { secUid, count: '5' } });
    const videos = posts?.data?.itemList ?? posts?.itemList ?? [];
    console.log('Videos found:', videos.length);
    videos.slice(0, 5).forEach(v => console.log(' -', v.id, '|', v.desc?.slice(0, 80)));

    if (videos.length > 0) {
      const videoId = videos[0].id;
      
      // Check video detail for subtitle URLs
      console.log('\n=== TikTok: get_video_detail for', videoId, '===');
      const detail = await callDataApi('TikTok/get_video_detail', { query: { videoId } });
      const detailStr = JSON.stringify(detail);
      
      const hasSubtitle = detailStr.toLowerCase().includes('subtitle');
      const hasCaption = detailStr.toLowerCase().includes('caption');
      const hasSrt = detailStr.toLowerCase().includes('.srt');
      const hasVtt = detailStr.toLowerCase().includes('.vtt');
      console.log('Has subtitle:', hasSubtitle, '| Has caption:', hasCaption, '| Has .srt:', hasSrt, '| Has .vtt:', hasVtt);
      
      if (hasSubtitle) {
        const idx = detailStr.toLowerCase().indexOf('subtitle');
        console.log('Subtitle context:', detailStr.slice(Math.max(0, idx-10), idx+400));
      }
      
      // Check video.desc and video.textExtra for hashtags
      const item = detail?.itemInfo?.itemStruct ?? detail?.data?.itemInfo?.itemStruct;
      if (item) {
        console.log('\nVideo desc:', item.desc);
        console.log('TextExtra (hashtags):', JSON.stringify(item.textExtra?.slice(0, 5)));
        console.log('Video keys:', Object.keys(item).join(', '));
      }
    }
  } catch (e) { console.log('Error:', e.message.slice(0, 300)); }

  // Try get_user_videos as alternative
  console.log('\n=== TikTok: get_user_videos ===');
  try {
    const vids = await callDataApi('TikTok/get_user_videos', { query: { secUid, count: '5' } });
    console.log(JSON.stringify(vids, null, 2).slice(0, 400));
  } catch (e) { console.log('Error:', e.message.slice(0, 200)); }

  // YouTube - try the correct API ID format from dataApi.ts example: "Youtube/search"
  console.log('\n=== YouTube: try correct API ID ===');
  try {
    const r = await callDataApi('Youtube/search', { query: { gl: 'US', hl: 'en', q: 'alkhussein toronto food' } });
    console.log('Youtube/search SUCCESS:', JSON.stringify(r).slice(0, 400));
    
    // Get a video ID from results
    const items = r?.organic_results ?? r?.items ?? r?.results ?? [];
    console.log('Items:', items.slice(0, 2).map(i => ({ id: i.video_id ?? i.id, title: i.title?.slice(0, 60) })));
    
    if (items.length > 0) {
      const videoId = items[0].video_id ?? items[0].id?.videoId;
      if (videoId) {
        // Try YouTube captions
        console.log('\n=== Youtube: captions for', videoId, '===');
        for (const apiId of ['Youtube/captions', 'Youtube/get_captions', 'Youtube/video_captions']) {
          try {
            const caps = await callDataApi(apiId, { query: { videoId } });
            console.log(`${apiId}: SUCCESS -`, JSON.stringify(caps).slice(0, 200));
          } catch (e) { console.log(`${apiId}: ${e.message.slice(0, 80)}`); }
        }
      }
    }
  } catch (e) { console.log('Youtube/search error:', e.message.slice(0, 200)); }
}

main().catch(console.error);
