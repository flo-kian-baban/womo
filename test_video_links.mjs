const PROFILE_URL = 'https://www.tiktok.com/@kaylee.nhi';

console.log('Fetching profile page:', PROFILE_URL);

const res = await fetch(PROFILE_URL, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  }
});
const html = await res.text();
console.log('Status:', res.status, '| HTML length:', html.length);

// Method 1: Look for video links directly in the HTML
const videoLinkMatches = [...html.matchAll(/href="(https:\/\/www\.tiktok\.com\/@[^\/]+\/video\/\d+[^"]*)"/g)];
console.log('\nMethod 1 - Direct video href links found:', videoLinkMatches.length);
videoLinkMatches.slice(0, 10).forEach((m, i) => console.log(i+1 + '.', m[1]));

// Method 2: Extract video IDs from the rehydration JSON
const rehydrationMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
if (rehydrationMatch) {
  try {
    const data = JSON.parse(rehydrationMatch[1]);
    const defaultScope = data?.['__DEFAULT_SCOPE__'] ?? {};
    console.log('\nMethod 2 - Rehydration scope keys:', Object.keys(defaultScope));
    
    // Look for user detail / video list
    const userDetail = defaultScope?.['webapp.user-detail'] ?? {};
    console.log('User detail keys:', Object.keys(userDetail));
    
    // Check for video list in user detail
    const videoList = userDetail?.videoList ?? userDetail?.itemList ?? [];
    console.log('Videos in rehydration:', videoList.length);
    videoList.slice(0, 5).forEach((v, i) => {
      const id = v?.id ?? v?.video?.id;
      const desc = v?.desc;
      console.log(i+1 + '.', `https://www.tiktok.com/@kaylee.nhi/video/${id}`, '|', desc?.slice(0, 50));
    });
    
    // Also check for any itemList at top level
    const allKeys = JSON.stringify(defaultScope).match(/"itemList":\[/g);
    console.log('itemList occurrences in JSON:', allKeys?.length ?? 0);
    
  } catch(e) {
    console.log('JSON parse error:', e.message);
  }
}

// Method 3: Search for video IDs in the raw HTML
const videoIdMatches = [...html.matchAll(/\/video\/(\d{15,20})/g)];
const uniqueVideoIds = [...new Set(videoIdMatches.map(m => m[1]))];
console.log('\nMethod 3 - Video IDs found in HTML:', uniqueVideoIds.length);
uniqueVideoIds.slice(0, 15).forEach((id, i) => {
  console.log(i+1 + '.', `https://www.tiktok.com/@kaylee.nhi/video/${id}`);
});

// Method 4: Look for video data in any script tag
const scriptMatches = [...html.matchAll(/"id":"(\d{15,20})","desc":"([^"]{0,80})"/g)];
console.log('\nMethod 4 - Video id+desc pairs in HTML:', scriptMatches.length);
scriptMatches.slice(0, 10).forEach((m, i) => {
  console.log(i+1 + '.', `ID: ${m[1]} | desc: ${m[2]}`);
});
