/**
 * Explore YouTube Data API depth for channel stats and video data
 */
const FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY;

async function callDataApi(apiId, options = {}) {
  const baseUrl = FORGE_API_URL.endsWith('/') ? FORGE_API_URL : FORGE_API_URL + '/';
  const fullUrl = new URL('webdevtoken.v1.WebDevService/CallApi', baseUrl).toString();
  const response = await fetch(fullUrl, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'connect-protocol-version': '1', authorization: 'Bearer ' + FORGE_API_KEY },
    body: JSON.stringify({ apiId, query: options.query }),
  });
  const payload = await response.json().catch(() => ({}));
  if (payload?.jsonData) { try { return JSON.parse(payload.jsonData); } catch { return payload.jsonData; } }
  return payload;
}

// Test with a well-known creator: MrBeast
const handle = 'MrBeast';

console.log('=== YouTube channel search ===');
const ch = await callDataApi('Youtube/search', { query: { q: handle, type: 'channel', hl: 'en', gl: 'US' } });
const channel = ch?.contents?.[0]?.channel;
if (channel) {
  console.log('Title:', channel.title);
  console.log('Subscribers:', channel.subscriberCountText);
  console.log('Video count:', channel.videoCountText);
  console.log('Description:', channel.descriptionSnippet);
  console.log('Channel ID:', channel.channelId);
  console.log('Canonical URL:', channel.canonicalBaseUrl);
}

// Try to get channel details
if (channel?.channelId) {
  console.log('\n=== Youtube/get_channel_details ===');
  try {
    const details = await callDataApi('Youtube/get_channel_details', { query: { channelId: channel.channelId } });
    console.log(JSON.stringify(details, null, 2).slice(0, 1500));
  } catch(e) { console.error('channel_details failed:', e.message); }

  console.log('\n=== Youtube/get_channel_videos ===');
  try {
    const videos = await callDataApi('Youtube/get_channel_videos', { query: { channelId: channel.channelId, hl: 'en', gl: 'US' } });
    console.log(JSON.stringify(videos, null, 2).slice(0, 1500));
  } catch(e) { console.error('channel_videos failed:', e.message); }
}

// Try video search with stats
console.log('\n=== Youtube/search with stats ===');
const vids = await callDataApi('Youtube/search', { query: { q: handle, hl: 'en', gl: 'US' } });
const firstVideo = vids?.contents?.[0]?.video;
if (firstVideo) {
  console.log('Video keys:', Object.keys(firstVideo));
  console.log('Sample video:', JSON.stringify(firstVideo, null, 2).slice(0, 800));
}
