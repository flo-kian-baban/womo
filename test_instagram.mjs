// Test Instagram data accessibility
// Testing with @mrdavehill (comedian/musician we know)

const HANDLE = 'mrdavehill';
const PROFILE_URL = `https://www.instagram.com/${HANDLE}/`;

console.log('=== Test 1: Instagram Profile Page ===');
console.log('URL:', PROFILE_URL);

try {
  const res = await fetch(PROFILE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });
  const html = await res.text();
  console.log('Status:', res.status, '| HTML length:', html.length);

  // Look for shared data / window._sharedData
  const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.*?});<\/script>/s);
  if (sharedDataMatch) {
    console.log('✅ Found window._sharedData');
    try {
      const data = JSON.parse(sharedDataMatch[1]);
      const user = data?.entry_data?.ProfilePage?.[0]?.graphql?.user;
      if (user) {
        console.log('Username:', user.username);
        console.log('Full name:', user.full_name);
        console.log('Bio:', user.biography);
        console.log('Followers:', user.edge_followed_by?.count);
        const posts = user.edge_owner_to_timeline_media?.edges ?? [];
        console.log('Posts in page:', posts.length);
        posts.slice(0, 5).forEach((p, i) => {
          const node = p.node;
          console.log(i+1 + '.', 'shortcode:', node.shortcode, '| caption:', node.edge_media_to_caption?.edges?.[0]?.node?.text?.slice(0, 60));
        });
      }
    } catch(e) {
      console.log('Parse error:', e.message);
    }
  } else {
    console.log('❌ No window._sharedData found');
  }

  // Look for __additionalDataLoaded or similar
  const additionalMatch = html.match(/window\.__additionalDataLoaded\s*\(/);
  console.log('window.__additionalDataLoaded:', !!additionalMatch);

  // Look for any JSON data with post info
  const postCodeMatches = [...html.matchAll(/"shortcode":"([A-Za-z0-9_-]{10,12})"/g)];
  const uniqueCodes = [...new Set(postCodeMatches.map(m => m[1]))];
  console.log('\nShortcodes found in HTML:', uniqueCodes.length);
  uniqueCodes.slice(0, 5).forEach((code, i) => {
    console.log(i+1 + '.', `https://www.instagram.com/p/${code}/`);
  });

  // Look for video/reel IDs
  const reelMatches = [...html.matchAll(/"pk":"(\d{15,20})"/g)];
  const uniqueReelIds = [...new Set(reelMatches.map(m => m[1]))];
  console.log('\nReel/post IDs found:', uniqueReelIds.length);

  // Check for any script with user data
  const bioMatch = html.match(/"biography":"([^"]+)"/);
  if (bioMatch) console.log('\nBio found:', bioMatch[1].slice(0, 100));
  
  const followerMatch = html.match(/"edge_followed_by":\{"count":(\d+)\}/);
  if (followerMatch) console.log('Followers found:', followerMatch[1]);

  // Check meta tags
  const metaDesc = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/);
  if (metaDesc) console.log('\nMeta description:', metaDesc[1].slice(0, 150));
  
  const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/);
  if (ogDesc) console.log('OG description:', ogDesc[1].slice(0, 150));

} catch(e) {
  console.log('Error:', e.message);
}

// Test 2: Try a specific Instagram reel/post URL
console.log('\n=== Test 2: Instagram Reel/Post Page ===');
// Try fetching a reel page directly
const REEL_URL = 'https://www.instagram.com/reel/test/'; // placeholder

// Test 3: Try Instagram's public API endpoints
console.log('\n=== Test 3: Instagram Public API Endpoints ===');

const apiEndpoints = [
  `https://www.instagram.com/api/v1/users/web_profile_info/?username=${HANDLE}`,
  `https://www.instagram.com/${HANDLE}/?__a=1&__d=dis`,
  `https://i.instagram.com/api/v1/users/lookup/?username=${HANDLE}`,
];

for (const endpoint of apiEndpoints) {
  try {
    const r = await fetch(endpoint, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
      }
    });
    const text = await r.text();
    console.log(`\n${endpoint.slice(0, 80)}`);
    console.log('Status:', r.status);
    if (r.status === 200) {
      console.log('Response (first 300):', text.slice(0, 300));
    } else {
      console.log('Response:', text.slice(0, 100));
    }
  } catch(e) {
    console.log('Error:', e.message);
  }
}

// Test 4: Check if the Manus Data API has any Instagram endpoints
console.log('\n=== Test 4: Manus Data API Instagram Endpoints ===');
const FORGE_URL = process.env.BUILT_IN_FORGE_API_URL || '';
const FORGE_KEY = process.env.BUILT_IN_FORGE_API_KEY || '';

async function callApi(endpoint, params = {}) {
  const baseUrl = FORGE_URL.endsWith('/') ? FORGE_URL : FORGE_URL + '/';
  const fullUrl = new URL('webdevtoken.v1.WebDevService/CallApi', baseUrl).toString();
  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'connect-protocol-version': '1',
      'Authorization': 'Bearer ' + FORGE_KEY
    },
    body: JSON.stringify({ apiId: endpoint, ...params })
  });
  const text = await res.text();
  const j = JSON.parse(text);
  return j?.jsonData ? JSON.parse(j.jsonData) : j;
}

const igEndpoints = [
  'Instagram/get_user_info',
  'Instagram/get_user_posts',
  'Instagram/user_info',
  'Instagram/profile',
  'Instagram/get_profile',
];

for (const ep of igEndpoints) {
  const r = await callApi(ep, { query: { username: HANDLE } });
  const hasError = r?.code === 'not_found' || r?.code === 'invalid_argument';
  console.log(ep + ':', hasError ? '❌ ' + r.code : '✅ ' + JSON.stringify(r).slice(0, 100));
}
