import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env
try {
  const env = readFileSync(resolve(__dirname, '.env'), 'utf-8');
  for (const line of env.split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  }
} catch {}

const FORGE_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_KEY = process.env.BUILT_IN_FORGE_API_KEY;

console.log('FORGE_URL:', FORGE_URL ? FORGE_URL.slice(0, 40) + '...' : 'NOT SET');
console.log('FORGE_KEY:', FORGE_KEY ? 'SET (' + FORGE_KEY.length + ' chars)' : 'NOT SET');

async function callDataApi(apiId, options = {}) {
  const baseUrl = FORGE_URL.endsWith('/') ? FORGE_URL : `${FORGE_URL}/`;
  const fullUrl = new URL('webdevtoken.v1.WebDevService/CallApi', baseUrl).toString();
  const resp = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'connect-protocol-version': '1',
      'authorization': `Bearer ${FORGE_KEY}`,
    },
    body: JSON.stringify({
      apiId,
      query: options.query,
      body: options.body,
      path_params: options.pathParams,
    }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  const payload = await resp.json();
  if (payload && 'jsonData' in payload) {
    try { return JSON.parse(payload.jsonData); } catch { return payload.jsonData; }
  }
  return payload;
}

console.log('\n=== DIAGNOSING @camfant ===\n');

// Step 1: User info
try {
  const info = await callDataApi('TikTok/get_user_info', { query: { uniqueId: 'camfant' } });
  const user = info?.userInfo?.user ?? info?.user ?? {};
  const stats = info?.userInfo?.stats ?? info?.stats ?? {};
  console.log('USER INFO:');
  console.log('  nickname:', user?.nickname);
  console.log('  signature:', user?.signature);
  console.log('  followers:', stats?.followerCount ?? user?.followerCount);
  console.log('  videoCount:', stats?.videoCount);
  console.log('  secUid:', (user?.secUid ?? '').slice(0, 40));
} catch(e) { console.log('user info FAILED:', e.message); }

// Step 2: Search for camfant
console.log('\nSEARCH: keyword=camfant');
try {
  const search = await callDataApi('TikTok/search_tiktok_video_general', { query: { keyword: 'camfant' } });
  const items = search?.item_list ?? [];
  console.log(`  Got ${items.length} results:`);
  items.slice(0, 15).forEach((item, i) => {
    const author = item?.author?.uniqueId ?? item?.author?.nickname ?? 'unknown';
    const desc = (item?.desc ?? '').slice(0, 120);
    const views = item?.statistics?.play_count ?? 0;
    console.log(`  ${i+1}. [@${author}] "${desc}"`);
  });
} catch(e) { console.log('  FAILED:', e.message); }

// Step 3: TikTok user search
console.log('\nUSER SEARCH: camfant');
try {
  const search = await callDataApi('TikTok/search_tiktok_user', { query: { keyword: 'camfant' } });
  const users = search?.user_list ?? search?.userList ?? [];
  console.log(`  Got ${users.length} user results:`);
  users.slice(0, 5).forEach((u, i) => {
    const user = u?.user_info ?? u?.userInfo?.user ?? u;
    console.log(`  ${i+1}. @${user?.unique_id ?? user?.uniqueId} - ${user?.nickname} - ${(user?.signature ?? '').slice(0,80)}`);
  });
} catch(e) { console.log('  FAILED:', e.message); }

// Step 4: YouTube search for camfant
console.log('\nYouTube SEARCH: camfant tiktok');
try {
  const yt = await callDataApi('Youtube/search', { query: { q: 'camfant tiktok', hl: 'en', gl: 'US' } });
  const contents = yt?.contents ?? [];
  console.log(`  Got ${contents.length} results:`);
  contents.slice(0, 8).forEach((item, i) => {
    const v = item?.video;
    if (v) console.log(`  ${i+1}. "${v.title}" - ${(v.descriptionSnippet ?? '').slice(0, 80)}`);
  });
} catch(e) { console.log('  FAILED:', e.message); }

console.log('\n=== DONE ===');
