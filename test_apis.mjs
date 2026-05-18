const FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY;

async function callDataApi(apiId, options = {}) {
  const baseUrl = FORGE_API_URL.endsWith('/') ? FORGE_API_URL : FORGE_API_URL + '/';
  const fullUrl = new URL('webdevtoken.v1.WebDevService/CallApi', baseUrl).toString();
  const response = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'connect-protocol-version': '1',
      authorization: 'Bearer ' + FORGE_API_KEY,
    },
    body: JSON.stringify({ apiId, query: options.query }),
  });
  const payload = await response.json().catch(() => ({}));
  if (payload?.jsonData) {
    try { return JSON.parse(payload.jsonData); } catch { return payload.jsonData; }
  }
  return payload;
}

// Test YouTube search - we know this works
console.log('=== YouTube search for mrdavehill ===');
const yt = await callDataApi('Youtube/search', {
  query: { q: 'Dave Hill mrdavehill comedian musician instagram', hl: 'en', gl: 'US' }
});
const contents = yt?.contents ?? [];
for (const item of contents.slice(0, 6)) {
  const v = item?.video;
  if (v) {
    console.log('Title:', v.title);
    console.log('Desc:', (v.descriptionSnippet || '').slice(0, 200));
    console.log('---');
  }
}

// Test YouTube channel search
console.log('\n=== YouTube channel search ===');
const ytCh = await callDataApi('Youtube/search', {
  query: { q: 'mrdavehill', type: 'channel', hl: 'en', gl: 'US' }
});
console.log(JSON.stringify(ytCh, null, 2).slice(0, 600));

// Test TikTok search for instagram creator
console.log('\n=== TikTok search for mrdavehill ===');
try {
  const tt = await callDataApi('Tiktok/search_tiktok_video_general', {
    query: { keyword: 'mrdavehill comedian' }
  });
  console.log(JSON.stringify(tt, null, 2).slice(0, 600));
} catch(e) { console.error('TikTok search failed:', e.message); }
