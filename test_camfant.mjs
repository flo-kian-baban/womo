import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env
const envPath = resolve(__dirname, '.env');
try {
  const env = readFileSync(envPath, 'utf-8');
  for (const line of env.split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  }
} catch {}

const FORGE_URL = process.env.BUILT_IN_FORGE_API_URL || 'https://api.manus.im';
const FORGE_KEY = process.env.BUILT_IN_FORGE_API_KEY;

async function callDataApi(endpoint, params) {
  const url = `${FORGE_URL}/api/data/${endpoint}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${FORGE_KEY}`,
    },
    body: JSON.stringify(params),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

console.log('=== DIAGNOSING @camfant ===\n');

// Step 1: User info
try {
  const info = await callDataApi('TikTok/get_user_info', { query: { uniqueId: 'camfant' } });
  const user = info?.userInfo?.user ?? info?.user ?? info;
  const stats = info?.userInfo?.stats ?? info?.stats ?? {};
  console.log('USER INFO:');
  console.log('  nickname:', user?.nickname);
  console.log('  signature:', user?.signature);
  console.log('  followers:', stats?.followerCount ?? user?.followerCount);
  console.log('  secUid:', (user?.secUid ?? '').slice(0, 30) + '...');
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
    console.log(`  ${i+1}. [@${author}] "${desc}" (${views} views)`);
  });
} catch(e) { console.log('  FAILED:', e.message); }

// Step 3: Search for camfant food
console.log('\nSEARCH: keyword=camfant food');
try {
  const search = await callDataApi('TikTok/search_tiktok_video_general', { query: { keyword: 'camfant food' } });
  const items = search?.item_list ?? [];
  console.log(`  Got ${items.length} results:`);
  items.slice(0, 8).forEach((item, i) => {
    const author = item?.author?.uniqueId ?? item?.author?.nickname ?? 'unknown';
    const desc = (item?.desc ?? '').slice(0, 120);
    console.log(`  ${i+1}. [@${author}] "${desc}"`);
  });
} catch(e) { console.log('  FAILED:', e.message); }

// Step 4: Search for camfant travel
console.log('\nSEARCH: keyword=camfant travel');
try {
  const search = await callDataApi('TikTok/search_tiktok_video_general', { query: { keyword: 'camfant travel' } });
  const items = search?.item_list ?? [];
  console.log(`  Got ${items.length} results:`);
  items.slice(0, 8).forEach((item, i) => {
    const author = item?.author?.uniqueId ?? item?.author?.nickname ?? 'unknown';
    const desc = (item?.desc ?? '').slice(0, 120);
    console.log(`  ${i+1}. [@${author}] "${desc}"`);
  });
} catch(e) { console.log('  FAILED:', e.message); }

// Step 5: Try TikTok user search
console.log('\nSEARCH: TikTok user search for camfant');
try {
  const search = await callDataApi('TikTok/search_tiktok_user', { query: { keyword: 'camfant' } });
  const users = search?.user_list ?? search?.userList ?? [];
  console.log(`  Got ${users.length} user results:`);
  users.slice(0, 5).forEach((u, i) => {
    const user = u?.user_info ?? u?.userInfo?.user ?? u;
    console.log(`  ${i+1}. @${user?.unique_id ?? user?.uniqueId} - ${user?.nickname} - ${user?.signature?.slice(0,80)}`);
  });
} catch(e) { console.log('  FAILED:', e.message); }

console.log('\n=== DONE ===');
