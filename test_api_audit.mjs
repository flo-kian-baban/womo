/**
 * Comprehensive API audit — what data can we actually access?
 * Tests TikTok and Instagram endpoints systematically.
 */

const FORGE_URL = process.env.BUILT_IN_FORGE_API_URL || '';
const FORGE_KEY = process.env.BUILT_IN_FORGE_API_KEY || '';

async function call(endpoint, params = {}) {
  const baseUrl = FORGE_URL.endsWith('/') ? FORGE_URL : FORGE_URL + '/';
  const fullUrl = new URL('webdevtoken.v1.WebDevService/CallApi', baseUrl).toString();
  try {
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
  } catch (e) {
    return { error: e.message };
  }
}

// Test creator: @alkhussein (food creator, mid-size, known to work)
const TIKTOK_HANDLE = 'alkhussein';
const TIKTOK_HANDLE2 = 'kaylee.nhi';
const TIKTOK_HANDLE3 = 'camfant';

console.log('='.repeat(60));
console.log('TIKTOK API AUDIT');
console.log('='.repeat(60));

// 1. User Info
console.log('\n--- 1. TikTok/get_user_info ---');
const userInfo = await call('TikTok/get_user_info', { query: { uniqueId: TIKTOK_HANDLE } });
const user = userInfo?.userInfo?.user ?? {};
const stats = userInfo?.userInfo?.stats ?? {};
console.log('✅ Fields available:');
console.log('  uniqueId:', user.uniqueId);
console.log('  nickname:', user.nickname);
console.log('  signature (bio):', user.signature?.slice(0, 80));
console.log('  verified:', user.verified);
console.log('  privateAccount:', user.privateAccount);
console.log('  secUid:', user.secUid?.slice(0, 30));
console.log('  avatarThumb:', user.avatarThumb ? '✅ URL available' : '❌');
console.log('  bioLink:', user.bioLink?.link ?? 'none');
console.log('  Stats — followers:', stats.followerCount);
console.log('  Stats — following:', stats.followingCount);
console.log('  Stats — hearts/likes:', stats.heartCount);
console.log('  Stats — videoCount:', stats.videoCount);
console.log('  Stats — diggCount:', stats.diggCount);
const secUid = user.secUid;

// 2. Popular Posts
console.log('\n--- 2. TikTok/get_user_popular_posts ---');
const popular = await call('TikTok/get_user_popular_posts', { query: { secUid, count: 5 } });
const popItems = popular?.itemList ?? [];
console.log('Items returned:', popItems.length);
if (popItems.length > 0) {
  const item = popItems[0];
  console.log('✅ Fields per video:');
  console.log('  id:', item.id);
  console.log('  desc (caption):', item.desc?.slice(0, 80) || '[empty]');
  console.log('  createTime:', item.createTime ? new Date(item.createTime * 1000).toDateString() : 'n/a');
  console.log('  stats.playCount:', item.stats?.playCount);
  console.log('  stats.diggCount (likes):', item.stats?.diggCount);
  console.log('  stats.commentCount:', item.stats?.commentCount);
  console.log('  stats.shareCount:', item.stats?.shareCount);
  console.log('  music.title:', item.music?.title);
  console.log('  music.authorName:', item.music?.authorName);
  console.log('  challenges (hashtags):', item.challenges?.map(c => '#' + c.title).join(', ') || 'none');
  console.log('  textExtra:', item.textExtra?.map(t => t.hashtagName).filter(Boolean).join(', ') || 'none');
  console.log('  video.cover (thumbnail):', item.video?.cover ? '✅ URL' : '❌');
  console.log('  video.duration:', item.video?.duration);
  console.log('  author.uniqueId:', item.author?.uniqueId);
} else {
  console.log('❌ No items returned (common for mid-size creators)');
}

// 3. Video Search
console.log('\n--- 3. TikTok/search_tiktok_video_general ---');
const search = await call('TikTok/search_tiktok_video_general', { query: { keyword: TIKTOK_HANDLE, count: 5 } });
const searchItems = search?.item_list ?? search?.itemList ?? [];
console.log('Items returned:', searchItems.length);
if (searchItems.length > 0) {
  const item = searchItems[0];
  console.log('✅ Fields per search result:');
  console.log('  desc:', item.desc?.slice(0, 80) || '[empty]');
  console.log('  author.uniqueId:', item.author?.uniqueId || '[empty — known issue]');
  console.log('  stats.playCount:', item.stats?.playCount);
  console.log('  stats.diggCount:', item.stats?.diggCount);
  console.log('  stats.commentCount:', item.stats?.commentCount);
  console.log('  music.title:', item.music?.title);
  console.log('  challenges:', item.challenges?.map(c => '#' + c.title).join(', ') || 'none');
  console.log('  createTime:', item.createTime ? new Date(item.createTime * 1000).toDateString() : 'n/a');
  console.log('  ⚠️  author.uniqueId empty?', !item.author?.uniqueId);
}

// 4. Video Comments
console.log('\n--- 4. TikTok/get_video_comments (need video ID) ---');
if (popItems.length > 0) {
  const videoId = popItems[0].id;
  const comments = await call('TikTok/get_video_comments', { query: { video_id: videoId, count: 5 } });
  const commentItems = comments?.comments ?? comments?.data?.comments ?? [];
  console.log('Video ID tested:', videoId);
  console.log('Comments returned:', commentItems.length);
  if (commentItems.length > 0) {
    console.log('✅ Comment fields:');
    const c = commentItems[0];
    console.log('  text:', c.text?.slice(0, 80));
    console.log('  diggCount (likes):', c.diggCount);
    console.log('  user.uniqueId:', c.user?.uniqueId);
  }
} else {
  // Try with a known video ID from search
  if (searchItems.length > 0) {
    const videoId = searchItems[0].id;
    const comments = await call('TikTok/get_video_comments', { query: { video_id: videoId, count: 5 } });
    const commentItems = comments?.comments ?? comments?.data?.comments ?? [];
    console.log('Video ID tested (from search):', videoId);
    console.log('Comments returned:', commentItems.length);
    if (commentItems.length > 0) {
      const c = commentItems[0];
      console.log('✅ Comment text:', c.text?.slice(0, 80));
    } else {
      console.log('Keys returned:', Object.keys(comments ?? {}));
    }
  }
}

// 5. Hashtag search
console.log('\n--- 5. TikTok/search_tiktok_video_general (hashtag search) ---');
const hashSearch = await call('TikTok/search_tiktok_video_general', { query: { keyword: '#food toronto', count: 3 } });
const hashItems = hashSearch?.item_list ?? hashSearch?.itemList ?? [];
console.log('Hashtag search items:', hashItems.length);
if (hashItems.length > 0) {
  console.log('  author.uniqueId:', hashItems[0].author?.uniqueId || '[empty]');
  console.log('  desc:', hashItems[0].desc?.slice(0, 60));
}

// 6. Try get_user_info for a private/small account
console.log('\n--- 6. User info for @malik.the.prince19 (small creator) ---');
const malikInfo = await call('TikTok/get_user_info', { query: { uniqueId: 'malik.the.prince19' } });
const malikUser = malikInfo?.userInfo?.user ?? {};
const malikStats = malikInfo?.userInfo?.stats ?? {};
console.log('  nickname:', malikUser.nickname);
console.log('  bio:', malikUser.signature?.slice(0, 80));
console.log('  followers:', malikStats.followerCount);
console.log('  hearts:', malikStats.heartCount);
console.log('  videoCount:', malikStats.videoCount);
console.log('  privateAccount:', malikUser.privateAccount);

// 7. Try popular posts for malik
const malikSecUid = malikUser.secUid;
const malikPop = await call('TikTok/get_user_popular_posts', { query: { secUid: malikSecUid, count: 5 } });
const malikItems = malikPop?.itemList ?? [];
console.log('  popular_posts items:', malikItems.length);
if (malikItems.length > 0) {
  console.log('  ✅ First video desc:', malikItems[0].desc?.slice(0, 80));
}

console.log('\n' + '='.repeat(60));
console.log('INSTAGRAM API AUDIT');
console.log('='.repeat(60));

// Instagram endpoints
const IG_HANDLE = 'mrdavehill';

console.log('\n--- 1. Instagram/get_user_info ---');
const igInfo = await call('Instagram/get_user_info', { query: { username: IG_HANDLE } });
console.log('Keys:', Object.keys(igInfo ?? {}));
if (igInfo?.error) console.log('Error:', igInfo.error);
else {
  const igUser = igInfo?.user ?? igInfo?.data ?? igInfo;
  console.log('  username:', igUser?.username);
  console.log('  full_name:', igUser?.full_name);
  console.log('  biography:', igUser?.biography?.slice(0, 80));
  console.log('  followers:', igUser?.edge_followed_by?.count ?? igUser?.follower_count);
  console.log('  media_count:', igUser?.media_count);
  console.log('  is_private:', igUser?.is_private);
}

console.log('\n--- 2. Instagram/get_user_posts ---');
const igPosts = await call('Instagram/get_user_posts', { query: { username: IG_HANDLE, count: 5 } });
console.log('Keys:', Object.keys(igPosts ?? {}));
if (igPosts?.error) console.log('Error:', igPosts.error);
else {
  const items = igPosts?.items ?? igPosts?.data ?? [];
  console.log('Posts returned:', Array.isArray(items) ? items.length : 'not array');
  if (Array.isArray(items) && items.length > 0) {
    const p = items[0];
    console.log('  caption:', p?.caption?.text?.slice(0, 80) ?? p?.caption?.slice(0, 80));
    console.log('  like_count:', p?.like_count);
    console.log('  comment_count:', p?.comment_count);
  }
}

console.log('\n--- 3. Instagram/search_user ---');
const igSearch = await call('Instagram/search_user', { query: { q: IG_HANDLE } });
console.log('Keys:', Object.keys(igSearch ?? {}));
if (igSearch?.error) console.log('Error:', igSearch.error);
else {
  const users = igSearch?.users ?? igSearch?.data ?? [];
  console.log('Users returned:', Array.isArray(users) ? users.length : JSON.stringify(igSearch)?.slice(0, 100));
}

console.log('\n--- 4. Instagram/get_user_reels ---');
const igReels = await call('Instagram/get_user_reels', { query: { username: IG_HANDLE, count: 5 } });
console.log('Keys:', Object.keys(igReels ?? {}));
if (igReels?.error) console.log('Error:', igReels.error);

console.log('\n--- 5. Instagram/get_hashtag_posts ---');
const igHash = await call('Instagram/get_hashtag_posts', { query: { hashtag: 'comedy', count: 3 } });
console.log('Keys:', Object.keys(igHash ?? {}));
if (igHash?.error) console.log('Error:', igHash.error);
else {
  const items = igHash?.items ?? igHash?.data ?? [];
  console.log('Posts returned:', Array.isArray(items) ? items.length : 'not array');
}

console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));
