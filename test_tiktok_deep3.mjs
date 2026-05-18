/**
 * Targeted TikTok probe - focus on getting video content for small creators
 */
const FORGE_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_KEY = process.env.BUILT_IN_FORGE_API_KEY;

async function callDataApi(apiId, query = {}) {
  const baseUrl = FORGE_URL.endsWith('/') ? FORGE_URL : FORGE_URL + '/';
  const fullUrl = new URL('webdevtoken.v1.WebDevService/CallApi', baseUrl).toString();
  const response = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'connect-protocol-version': '1',
      authorization: 'Bearer ' + FORGE_KEY,
    },
    body: JSON.stringify({ apiId, query }),
  });
  const payload = await response.json().catch(() => ({}));
  if (payload && 'jsonData' in payload) {
    try { return JSON.parse(payload.jsonData ?? '{}'); } catch { return payload.jsonData; }
  }
  return payload;
}

const handle = 'kaylee.nhi';

// Get full secUid
const userInfo = await callDataApi('TikTok/get_user_info', { uniqueId: handle });
const user = userInfo?.userInfo?.user ?? {};
const secUid = user?.secUid ?? '';
console.log('Full secUid:', secUid);
console.log('Bio:', user?.signature);

// Try popular posts with full secUid
console.log('\n--- Popular posts with full secUid ---');
const popular = await callDataApi('TikTok/get_user_popular_posts', { secUid });
console.log('Keys:', Object.keys(popular ?? {}));
console.log('Raw (first 600):', JSON.stringify(popular).slice(0, 600));

// Try search with just the name
console.log('\n--- Search: kaylee nhi ---');
const s1 = await callDataApi('TikTok/search_tiktok_video_general', { keyword: 'kaylee nhi' });
const items1 = s1?.item_list ?? [];
console.log('Count:', items1.length);
for (const item of items1.slice(0, 8)) {
  const authorId = item?.author?.unique_id ?? '';
  const desc = item?.desc ?? '';
  const hashtags = (item?.text_extra ?? []).filter(t => t.hashtag_name).map(t => '#' + t.hashtag_name);
  const isOwn = authorId === handle;
  if (isOwn) {
    console.log('OWN: "' + desc.slice(0, 100) + '"');
    if (hashtags.length) console.log('  Tags:', hashtags.join(', '));
  }
}

// Try search with food + toronto (her known content)
console.log('\n--- Search: kaylee nhi food toronto ---');
const s2 = await callDataApi('TikTok/search_tiktok_video_general', { keyword: 'kaylee nhi food toronto' });
const items2 = s2?.item_list ?? [];
console.log('Count:', items2.length);
for (const item of items2.slice(0, 5)) {
  const authorId = item?.author?.unique_id ?? '';
  const desc = item?.desc ?? '';
  console.log('@' + authorId + ': "' + desc.slice(0, 80) + '"');
}

// Try fetching TikTok profile page directly via HTTP to scrape video data
console.log('\n--- HTTP scrape of TikTok profile page ---');
try {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate',
    'Connection': 'keep-alive',
  };
  const res = await fetch('https://www.tiktok.com/@' + handle, { headers });
  const html = await res.text();
  console.log('HTTP status:', res.status, '| HTML length:', html.length);
  
  // Extract video descriptions from __UNIVERSAL_DATA_FOR_REHYDRATION__
  const jsonMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      // Navigate to video list
      const defaultScope = data?.['__DEFAULT_SCOPE__'] ?? {};
      const webappDetail = defaultScope?.['webapp.user-detail'] ?? {};
      const itemList = webappDetail?.itemList ?? [];
      console.log('Videos from page JSON:', itemList.length);
      for (const item of itemList.slice(0, 15)) {
        const desc = item?.desc ?? '';
        const tags = (item?.textExtra ?? []).filter(t => t.hashtagName).map(t => '#' + t.hashtagName);
        const plays = item?.stats?.playCount ?? 0;
        console.log('  [' + plays + ' views] "' + desc.slice(0, 80) + '"');
        if (tags.length) console.log('    Tags:', tags.join(', '));
      }
    } catch(e) {
      console.log('JSON parse error:', e.message);
    }
  } else {
    // Try to find video descriptions in the HTML
    const descMatches = html.match(/"desc":"([^"]{10,150})"/g) ?? [];
    console.log('desc matches in HTML:', descMatches.length);
    for (const m of descMatches.slice(0, 10)) {
      console.log(' ', m.slice(0, 100));
    }
    
    // Try SIGI_STATE
    const sigiMatch = html.match(/window\['SIGI_STATE'\]\s*=\s*(\{[\s\S]*?\});/);
    if (sigiMatch) {
      console.log('Found SIGI_STATE');
      try {
        const sigiData = JSON.parse(sigiMatch[1]);
        console.log('SIGI keys:', Object.keys(sigiData));
      } catch(e) {
        console.log('SIGI parse error');
      }
    }
  }
} catch(e) {
  console.log('HTTP scrape error:', e.message);
}

// Try TikTok API with different endpoint names
console.log('\n--- Trying alternate TikTok endpoints ---');
const endpoints = [
  ['TikTok/get_user_videos', { uniqueId: handle }],
  ['TikTok/get_user_feed', { secUid }],
  ['TikTok/user_videos', { uniqueId: handle }],
  ['TikTok/get_videos_by_user', { uniqueId: handle }],
];
for (const [ep, params] of endpoints) {
  const r = await callDataApi(ep, params);
  const keys = Object.keys(r ?? {});
  const hasError = 'error' in (r ?? {});
  if (!hasError) {
    console.log(ep + ': keys=' + keys.join(','));
    console.log('  Raw:', JSON.stringify(r).slice(0, 200));
  } else {
    console.log(ep + ': NOT FOUND');
  }
}
