const FORGE_URL = process.env.BUILT_IN_FORGE_API_URL || '';
const FORGE_KEY = process.env.BUILT_IN_FORGE_API_KEY || '';
const HANDLE = 'kaylee.nhi';

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

// Step 1: Search for videos by handle - get video IDs
console.log('=== Step 1: Get video IDs from TikTok search ===');
const searchResult = await callApi('TikTok/search_tiktok_video_general', {
  query: { keyword: HANDLE, count: '20' }
});

const allItems = searchResult?.item_list ?? [];
console.log('Total search results:', allItems.length);

// Filter to only this creator's videos
const normalizedHandle = HANDLE.toLowerCase().replace(/[._-]/g, '');
const myVideos = allItems.filter(item => {
  const uid = (item.author?.uniqueId ?? '').toLowerCase().replace(/[._-]/g, '');
  return uid === normalizedHandle;
});

console.log('Confirmed as @' + HANDLE + ':', myVideos.length);

// Extract video IDs and build full URLs
const videoLinks = myVideos.map(item => {
  const id = item.id ?? item.video?.id;
  return {
    url: `https://www.tiktok.com/@${HANDLE}/video/${id}`,
    id,
    desc: item.desc || '[no caption]',
    views: item.stats?.playCount ?? 0,
    likes: item.stats?.diggCount ?? 0,
  };
});

console.log('\nVideo links found:');
videoLinks.forEach((v, i) => {
  console.log(i+1 + '.', v.url);
  console.log('   desc:', v.desc.slice(0, 70));
  console.log('   views:', v.views?.toLocaleString(), '| likes:', v.likes?.toLocaleString());
});

// Step 2: For each video, fetch the transcript
console.log('\n=== Step 2: Fetch transcripts for each video ===');

async function getTranscript(videoUrl) {
  try {
    const res = await fetch(videoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    const html = await res.text();
    
    const rehydrationMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (!rehydrationMatch) return null;
    
    const data = JSON.parse(rehydrationMatch[1]);
    const itemInfo = data?.['__DEFAULT_SCOPE__']?.['webapp.video-detail']?.itemInfo?.itemStruct ?? {};
    const subtitleInfos = itemInfo?.video?.subtitleInfos ?? [];
    
    if (subtitleInfos.length === 0) return null;
    
    // Get English subtitle
    const engSub = subtitleInfos.find(s => s.LanguageCodeName?.startsWith('eng')) ?? subtitleInfos[0];
    const subRes = await fetch(engSub.Url, {
      headers: { 'Referer': 'https://www.tiktok.com/', 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!subRes.ok) return null;
    const vtt = await subRes.text();
    
    // Parse WEBVTT to plain text
    const lines = vtt.split('\n')
      .filter(line => line.trim() && !line.startsWith('WEBVTT') && !line.match(/^\d{2}:\d{2}/) && !line.match(/-->/))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    return lines;
  } catch(e) {
    return null;
  }
}

// Fetch transcripts for all found videos
const transcripts = [];
for (const video of videoLinks) {
  process.stdout.write(`Fetching transcript for video ${video.id}... `);
  const transcript = await getTranscript(video.url);
  if (transcript) {
    console.log('✅ Got', transcript.split(' ').length, 'words');
    transcripts.push({ url: video.url, desc: video.desc, transcript });
  } else {
    console.log('❌ No transcript');
  }
}

console.log('\n=== RESULTS ===');
console.log(`Got transcripts for ${transcripts.length} / ${videoLinks.length} videos`);
transcripts.forEach((t, i) => {
  console.log(`\n--- Video ${i+1} ---`);
  console.log('URL:', t.url);
  console.log('Caption:', t.desc.slice(0, 60));
  console.log('Transcript:', t.transcript.slice(0, 200));
});
