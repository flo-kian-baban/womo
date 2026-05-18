import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(resolve(__dirname, '.env'), 'utf-8');
  for (const line of env.split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  }
} catch {}

const FORGE_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_KEY = process.env.BUILT_IN_FORGE_API_KEY;

async function call(apiId, query = {}) {
  const baseUrl = FORGE_URL.endsWith('/') ? FORGE_URL : FORGE_URL + '/';
  const fullUrl = new URL('webdevtoken.v1.WebDevService/CallApi', baseUrl).toString();
  const resp = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'connect-protocol-version': '1',
      'authorization': 'Bearer ' + FORGE_KEY
    },
    body: JSON.stringify({ apiId, query }),
  });
  const text = await resp.text();
  try {
    const p = JSON.parse(text);
    if (p && 'jsonData' in p) { try { return JSON.parse(p.jsonData); } catch { return p.jsonData; } }
    return p;
  } catch { return text; }
}

console.log('=== DEEP PROBE @camfant ===\n');

// Get full first item from search
const search = await call('TikTok/search_tiktok_video_general', { keyword: 'camfant' });
const items = search?.item_list ?? [];
console.log('Total search results:', items.length);

if (items.length > 0) {
  const item = items[0];
  console.log('\n--- FULL FIRST ITEM ---');
  console.log('desc:', JSON.stringify(item.desc));
  console.log('stats:', JSON.stringify(item.stats));
  console.log('statistics:', JSON.stringify(item.statistics));
  console.log('challenges:', JSON.stringify(item.challenges?.slice(0,5)));
  console.log('music title:', item.music?.title);
  console.log('music author:', item.music?.authorName);
  console.log('textExtra:', JSON.stringify(item.textExtra?.slice(0,5)));
  
  // Print ALL items with their desc and challenges
  console.log('\n--- ALL ITEMS ---');
  items.forEach((it, i) => {
    const desc = it.desc ?? '';
    const challenges = (it.challenges ?? []).map(c => '#' + (c.title ?? c.name ?? '')).join(' ');
    const music = it.music?.title ?? '';
    const views = it.stats?.playCount ?? it.statistics?.play_count ?? 0;
    console.log(i+1 + '. desc="' + desc.slice(0,80) + '" challenges="' + challenges + '" music="' + music.slice(0,40) + '" views=' + views);
  });
}

// Try getting video detail for a specific video to see if it has more data
if (items.length > 0) {
  const videoId = items[4]?.id;
  if (videoId) {
    console.log('\n--- VIDEO DETAIL for id=' + videoId + ' ---');
    try {
      const detail = await call('TikTok/get_video_detail', { video_id: videoId });
      const v = detail?.itemInfo?.itemStruct ?? detail;
      console.log('desc:', v?.desc);
      console.log('challenges:', JSON.stringify(v?.challenges?.slice(0,5)));
      console.log('textExtra:', JSON.stringify(v?.textExtra?.slice(0,5)));
    } catch(e) { console.log('video detail failed:', e.message); }
  }
}

// Try fetching TikTok profile page HTML to see what's available
console.log('\n--- TIKTOK HTML SCRAPE ---');
try {
  const resp = await fetch('https://www.tiktok.com/@camfant', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });
  const html = await resp.text();
  
  // Extract desc fields
  const descs = html.match(/"desc":"([^"]{3,200})"/g) ?? [];
  console.log('desc fields from HTML (' + descs.length + '):');
  descs.slice(0, 15).forEach((d, i) => {
    const text = d.replace(/^"desc":"/, '').replace(/"$/, '');
    if (!text.includes('Followers') && !text.includes('Watch')) {
      console.log(i+1 + '. ' + text.slice(0, 100));
    }
  });
  
  // Extract challenge/hashtag data
  const hashtags = html.match(/"challengeName":"([^"]+)"/g) ?? [];
  const uniqueTags = [...new Set(hashtags.map(h => h.replace(/^"challengeName":"/, '').replace(/"$/, '')))];
  console.log('\nHashtags from HTML:', uniqueTags.slice(0, 20).join(', '));
  
  // Extract nickname/bio
  const nicknameMatch = html.match(/"nickname":"([^"]+)"/);
  const sigMatch = html.match(/"signature":"([^"]+)"/);
  console.log('\nnickname:', nicknameMatch?.[1]);
  console.log('signature:', sigMatch?.[1]?.slice(0, 100));
} catch(e) { console.log('HTML scrape failed:', e.message); }

console.log('\n=== DONE ===');
