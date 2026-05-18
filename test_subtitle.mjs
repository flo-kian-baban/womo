const VIDEO_URL = 'https://www.tiktok.com/@kaylee.nhi/video/7639628413304589589';

// Try desktop Chrome UA
const res = await fetch(VIDEO_URL, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  }
});
const html = await res.text();
console.log('Status:', res.status, '| HTML length:', html.length);

// Find rehydration script
const rehydrationMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
if (rehydrationMatch) {
  try {
    const data = JSON.parse(rehydrationMatch[1]);
    const defaultScope = data?.['__DEFAULT_SCOPE__'] ?? {};
    console.log('Scope keys:', Object.keys(defaultScope));
    
    const videoDetail = defaultScope?.['webapp.video-detail'] ?? {};
    const itemInfo = videoDetail?.itemInfo?.itemStruct ?? {};
    console.log('desc:', itemInfo?.desc);
    console.log('video keys:', Object.keys(itemInfo?.video ?? {}));
    
    const subtitleInfos = itemInfo?.video?.subtitleInfos ?? [];
    console.log('Subtitle count:', subtitleInfos.length);
    
    if (subtitleInfos.length > 0) {
      for (const sub of subtitleInfos) {
        console.log('\nLanguage:', sub.LanguageCodeName, '| Format:', sub.Format);
        console.log('URL:', sub.Url?.slice(0, 120));
        
        // Try fetching the subtitle file
        try {
          const subRes = await fetch(sub.Url, {
            headers: {
              'Referer': 'https://www.tiktok.com/',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            }
          });
          console.log('Subtitle fetch status:', subRes.status);
          if (subRes.ok) {
            const txt = await subRes.text();
            console.log('\n=== TRANSCRIPT ===');
            console.log(txt.slice(0, 2000));
          }
        } catch(e) {
          console.log('Subtitle fetch error:', e.message);
        }
      }
    }
  } catch(e) {
    console.log('JSON parse error:', e.message);
  }
} else {
  console.log('No rehydration script found');
  // Check for subtitleInfos anywhere
  const hasSubtitle = html.includes('subtitleInfos');
  const hasDesc = html.includes('"desc"');
  console.log('Has subtitleInfos:', hasSubtitle);
  console.log('Has desc:', hasDesc);
  
  // Show first script tags
  const scriptIds = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]).slice(0, 10);
  console.log('IDs found:', scriptIds);
}
