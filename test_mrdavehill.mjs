/**
 * Integration test: verify that the web research layer correctly identifies
 * @mrdavehill as a comedian/musician, not a financial/business influencer.
 *
 * Run from project root: node test_mrdavehill.mjs
 */

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

function extractHandle(input) {
  return input
    .replace(/https?:\/\/(www\.)?(instagram\.com|tiktok\.com)\/@?/, '')
    .replace(/\/$/, '')
    .replace(/^@/, '')
    .split('/')[0]
    .split('?')[0]
    .trim();
}

console.log('=== Integration Test: @mrdavehill Instagram Research ===\n');

const handle = extractHandle('https://www.instagram.com/mrdavehill/');
console.log('Handle:', handle);

// Step 1: YouTube video search
console.log('\n--- Step 1: YouTube video search ---');
const ytVideo = await callDataApi('Youtube/search', {
  query: { q: `${handle} instagram`, hl: 'en', gl: 'US' }
});
const videoTitles = [];
for (const item of (ytVideo?.contents ?? []).slice(0, 10)) {
  const v = item?.video;
  if (v) {
    if (v.title) videoTitles.push(v.title);
    if (v.descriptionSnippet) videoTitles.push(v.descriptionSnippet);
    console.log('  Video:', v.title);
  }
}

// Step 2: YouTube channel search
console.log('\n--- Step 2: YouTube channel search ---');
const ytChannel = await callDataApi('Youtube/search', {
  query: { q: handle, type: 'channel', hl: 'en', gl: 'US' }
});
let bio = '';
for (const item of (ytChannel?.contents ?? []).slice(0, 3)) {
  const c = item?.channel;
  if (c) {
    console.log('  Channel:', c.title, '|', c.subscriberCountText);
    if (c.descriptionSnippet) { bio = c.descriptionSnippet; console.log('  Bio:', bio); }
  }
}

// Step 3: Verify evidence contains comedy/music keywords
console.log('\n--- Step 3: Evidence Verification ---');
const allEvidence = [...videoTitles, bio].join(' ').toLowerCase();
const comedyKeywords = ['comedian', 'comedy', 'standup', 'stand-up', 'funny', 'humor', 'comic'];
const musicKeywords = ['musician', 'music', 'guitar', 'band', 'album', 'song', 'rock'];
const financeKeywords = ['finance', 'financial', 'business', 'investment', 'stocks', 'money', 'entrepreneur'];

const foundComedy = comedyKeywords.filter(k => allEvidence.includes(k));
const foundMusic = musicKeywords.filter(k => allEvidence.includes(k));
const foundFinance = financeKeywords.filter(k => allEvidence.includes(k));

console.log('Comedy keywords found:', foundComedy);
console.log('Music keywords found:', foundMusic);
console.log('Finance keywords found (should be empty):', foundFinance);

const passed = (foundComedy.length > 0 || foundMusic.length > 0) && foundFinance.length === 0;
console.log('\n=== TEST RESULT:', passed ? '✅ PASS' : '❌ FAIL', '===');
if (!passed) {
  console.log('Expected: comedy/music keywords present, finance keywords absent');
  console.log('Got comedy:', foundComedy.length, '| music:', foundMusic.length, '| finance:', foundFinance.length);
  process.exit(1);
}
console.log('Evidence correctly identifies @mrdavehill as comedian/musician.');
