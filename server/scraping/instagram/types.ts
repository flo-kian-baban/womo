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
  /**
   * Set when base fields came from the RENDERED PAGE rather than a structured
   * payload. Instagram displays "268M" for 268,937,250, so these values carry
   * the page's display precision (~+/-0.5%), not the account's exact figures.
   * The raw strings are kept beside them because the string is the evidence:
   * a number can be re-derived from "268M", but "268M" cannot be recovered
   * from 268000000.
   */
  baseFieldRead?: RenderedBaseFields;
}

/** What a rendered-page read produced, string and parse side by side. */
export interface RenderedBaseFields {
  strategy: string;
  precision: "display";
  followersRaw: string | null;
  followingRaw: string | null;
  postsRaw: string | null;
  followers: number | null;
  following: number | null;
  posts: number | null;
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
