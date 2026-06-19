/**
 * Instagram Type Definitions — Phase 2
 *
 * Shared types for the Instagram scraping layer.
 */

// ─── Profile Data ─────────────────────────────────────────────────────────────

export interface InstagramProfileData {
  username: string;
  full_name: string;
  biography: string;
  follower_count: number;
  following_count: number;
  media_count: number;
  category: string;
  external_url: string;
  is_business_account: boolean;
  is_verified: boolean;
  profile_pic_url?: string;
}

// ─── Post Data ────────────────────────────────────────────────────────────────

export interface InstagramPostData {
  id: string;
  shortcode: string;
  timestamp: number;
  caption: string;
  like_count: number;
  comment_count: number;
  view_count: number;
  media_type: "photo" | "video" | "reel" | "carousel";
  video_duration?: number;
  thumbnail_url?: string;
  video_url?: string;
}

// ─── Scraped Profile (combined result from any source) ────────────────────────

export interface InstagramScrapedProfile {
  profile: InstagramProfileData;
  posts: InstagramPostData[];
  source: string;
  confidence: "high" | "medium" | "low";
}

// ─── Empty Defaults ───────────────────────────────────────────────────────────

export function emptyProfile(): InstagramProfileData {
  return {
    username: "",
    full_name: "",
    biography: "",
    follower_count: 0,
    following_count: 0,
    media_count: 0,
    category: "",
    external_url: "",
    is_business_account: false,
    is_verified: false,
  };
}
