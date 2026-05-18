import { Separator } from "@/components/ui/separator";
import { MapPin, Users, Heart, Play, TrendingUp, Video, Hash, Tag, Film, Mic } from "lucide-react";
import type { CreatorProfile } from "../../../drizzle/schema";
import TranscriptPanel from "./TranscriptPanel";
import FieldExplainer, { EXPLAINED_FIELD_KEYS } from "./FieldExplainer";

interface CreatorProfileCardProps {
  profile: CreatorProfile;
  compact?: boolean;
}

const FIELD_SECTIONS = [
  {
    title: "Field Note Two: Creator Snapshot",
    subtitle: "Jungian Archetype & Cultural Identity",
    fields: [
      { key: "archetype", label: "Archetype [Jung]", type: "badge" },
      { key: "recurringThemes", label: "Recurring Themes", type: "tags" },
      { key: "toneRegister", label: "Tone & Register", type: "text" },
      { key: "parasocialBondStrength", label: "Parasocial Bond Strength", type: "score-5" },
      { key: "audienceRelationshipType", label: "Audience Relationship Type", type: "badge" },
      { key: "barthesMyth", label: "Myth Question [Barthes]", type: "quote" },
      { key: "culturalCapital", label: "Cultural Capital [Bourdieu]", type: "badge" },
      { key: "goffmanStageConsistency", label: "Stage Test [Goffman]", type: "status" },
      { key: "driftSignal", label: "Drift Signal (6-Month)", type: "status" },
      { key: "stuartHallDecoding", label: "Decoding Audit [Stuart Hall]", type: "status" },
    ],
  },
  {
    title: "Field Note Three: Cultural Snapshot",
    subtitle: "Niche Positioning & Lifecycle Analysis",
    fields: [
      { key: "nicheTopicNode", label: "Topic Node", type: "text" },
      { key: "rogersAdopterStage", label: "Rogers Adopter Stage", type: "badge" },
      { key: "creatorNichePosition", label: "Creator's Niche Position", type: "status" },
      { key: "lifecyclePhase", label: "Lifecycle Phase [PAE]", type: "badge" },
      { key: "turnerLiminalPhase", label: "Liminal Phase Check [Turner]", type: "badge" },
      { key: "barthesNicheMeaning", label: "Meaning Check [Barthes]", type: "quote" },
    ],
  },
];

const BOOLEAN_FIELDS = [
  { key: "undergroundDensity", label: "Underground Density" },
  { key: "mainstreamBleed", label: "Mainstream Bleed" },
  { key: "remixRate", label: "Remix Rate" },
  { key: "brandSaturation", label: "Brand Saturation" },
];

function getStatusColor(key: string, value: string) {
  if (key === "goffmanStageConsistency") {
    if (value === "Consistent") return "text-green-400 bg-green-400/10 border-green-400/30";
    if (value === "Minor Gap") return "text-yellow-400 bg-yellow-400/10 border-yellow-400/30";
    return "text-red-400 bg-red-400/10 border-red-400/30";
  }
  if (key === "driftSignal") {
    if (value === "Zero Change") return "text-green-400 bg-green-400/10 border-green-400/30";
    if (value === "Minor Drift") return "text-yellow-400 bg-yellow-400/10 border-yellow-400/30";
    if (value === "Significant Drift") return "text-orange-400 bg-orange-400/10 border-orange-400/30";
    return "text-red-400 bg-red-400/10 border-red-400/30";
  }
  if (key === "stuartHallDecoding") {
    if (value === "Dominant") return "text-green-400 bg-green-400/10 border-green-400/30";
    if (value === "Negotiated") return "text-yellow-400 bg-yellow-400/10 border-yellow-400/30";
    return "text-red-400 bg-red-400/10 border-red-400/30";
  }
  if (key === "creatorNichePosition") {
    if (value === "Ahead") return "text-green-400 bg-green-400/10 border-green-400/30";
    if (value === "Consistent") return "text-blue-400 bg-blue-400/10 border-blue-400/30";
    return "text-red-400 bg-red-400/10 border-red-400/30";
  }
  return "text-primary bg-primary/10 border-primary/30";
}

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function FieldValue({ fieldKey, value, type }: { fieldKey: string; value: unknown; type: string }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/40 text-sm italic">—</span>;
  }

  if (type === "badge") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-primary/30 bg-primary/10 text-primary">
        {String(value)}
      </span>
    );
  }

  if (type === "tags") {
    const tags = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag: string, i: number) => (
          <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs border border-border bg-secondary text-muted-foreground">
            {tag}
          </span>
        ))}
      </div>
    );
  }

  if (type === "quote") {
    return (
      <blockquote className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground italic leading-relaxed">
        {String(value)}
      </blockquote>
    );
  }

  if (type === "score-5") {
    const score = Number(value);
    return (
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                i <= Math.round(score) ? "bg-primary" : "bg-border"
              }`}
            />
          ))}
        </div>
        <span className="text-sm text-muted-foreground">{score.toFixed(1)}/5</span>
      </div>
    );
  }

  if (type === "status") {
    const colorClass = getStatusColor(fieldKey, String(value));
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>
        {String(value)}
      </span>
    );
  }

  return <span className="text-sm text-foreground">{String(value)}</span>;
}

export default function CreatorProfileCard({ profile, compact = false }: CreatorProfileCardProps) {
  const themes = (profile.contentThemeLabels as string[] | null) ?? [];
  const hashtags = (profile.topHashtags as string[] | null) ?? [];
  const keywords = (profile.rawKeywords as string[] | null) ?? [];
  const videoTitles = (profile.recentVideoTitles as string[] | null) ?? [];

  const hasStats = (profile.followerCount ?? 0) > 0 || (profile.totalViews ?? 0) > 0 || (profile.videoCount ?? 0) > 0;
  const hasKeywordData = themes.length > 0 || hashtags.length > 0 || keywords.length > 0;
  const transcriptCount = profile.transcriptCount ?? 0;

  // Data confidence level based on transcripts + video titles
  const dataConfidence = transcriptCount >= 3 ? 'transcript' : videoTitles.length >= 10 ? 'high' : videoTitles.length >= 3 ? 'medium' : 'low';

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
          <span className="text-lg font-serif text-primary">
            {(profile.displayName ?? profile.handle)?.[0]?.toUpperCase() ?? "?"}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-lg text-foreground truncate">{profile.displayName ?? profile.handle}</h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-sm text-muted-foreground">@{profile.handle}</span>
            <span className="text-muted-foreground/30">·</span>
            <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-secondary text-muted-foreground">
              {profile.platform}
            </span>
            {profile.location && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="w-3 h-3" />
                  {profile.location}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Transcript Badge ─────────────────────────────────────────────── */}
      {transcriptCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
          <Mic className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          <span className="text-xs font-medium text-emerald-400">
            Analyzed from {transcriptCount} video transcript{transcriptCount !== 1 ? 's' : ''} — spoken content used as primary evidence
          </span>
        </div>
      )}
      {transcriptCount === 0 && videoTitles.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
          <Film className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
          <span className="text-xs font-medium text-yellow-400">
            No transcripts available — analysis based on {videoTitles.length} video titles and profile metadata
          </span>
        </div>
      )}

      {/* ── Stats Bar ───────────────────────────────────────────────────────── */}
      {hasStats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {(profile.followerCount ?? 0) > 0 && (
            <div className="p-3 rounded-lg bg-secondary/60 border border-border/50 text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                <Users className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wide font-medium">Followers</span>
              </div>
              <div className="text-base font-semibold text-foreground">{formatNum(profile.followerCount!)}</div>
            </div>
          )}
          {(profile.totalLikes ?? 0) > 0 && (
            <div className="p-3 rounded-lg bg-secondary/60 border border-border/50 text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                <Heart className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wide font-medium">Total Likes</span>
              </div>
              <div className="text-base font-semibold text-foreground">{formatNum(profile.totalLikes!)}</div>
            </div>
          )}
          {(profile.totalViews ?? 0) > 0 && (
            <div className="p-3 rounded-lg bg-secondary/60 border border-border/50 text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                <Play className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wide font-medium">Total Views</span>
              </div>
              <div className="text-base font-semibold text-foreground">{formatNum(profile.totalViews!)}</div>
            </div>
          )}
          {(profile.avgViews ?? 0) > 0 && (
            <div className="p-3 rounded-lg bg-secondary/60 border border-border/50 text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                <TrendingUp className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wide font-medium">Avg Views</span>
              </div>
              <div className="text-base font-semibold text-foreground">{formatNum(profile.avgViews!)}</div>
            </div>
          )}
          {(profile.videoCount ?? 0) > 0 && (
            <div className="p-3 rounded-lg bg-secondary/60 border border-border/50 text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                <Video className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wide font-medium">Videos</span>
              </div>
              <div className="text-base font-semibold text-foreground">{formatNum(profile.videoCount!)}</div>
            </div>
          )}
          {(profile.engagementRate ?? 0) > 0 && (
            <div className="p-3 rounded-lg bg-secondary/60 border border-border/50 text-center col-span-2 sm:col-span-1">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                <TrendingUp className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wide font-medium">Engagement</span>
              </div>
              <div className="text-base font-semibold text-foreground">{profile.engagementRate!.toFixed(1)}%</div>
            </div>
          )}
        </div>
      )}

      {/* ── Content Themes ──────────────────────────────────────────────────── */}
      {themes.length > 0 && (
        <div className="p-4 rounded-xl bg-muted/20 border border-border/50 space-y-3">
          <div className="flex items-center gap-2">
            <Tag className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              Content Themes
            </span>
            <span className="text-[10px] text-muted-foreground/50 ml-auto">AI-translated from actual content</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {themes.map((theme, i) => (
              <span
                key={i}
                className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border border-primary/40 bg-primary/10 text-primary"
              >
                {theme}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Hashtags & Keywords ─────────────────────────────────────────────── */}
      {hasKeywordData && !compact && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {hashtags.length > 0 && (
            <div className="p-4 rounded-xl bg-secondary/40 border border-border/50 space-y-2">
              <div className="flex items-center gap-2">
                <Hash className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
                  Top Hashtags
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {hashtags.slice(0, 15).map((tag, i) => (
                  <span key={i} className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded border border-border">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
          {keywords.length > 0 && (
            <div className="p-4 rounded-xl bg-secondary/40 border border-border/50 space-y-2">
              <div className="flex items-center gap-2">
                <Tag className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
                  Key Words
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {keywords.slice(0, 20).map((kw, i) => (
                  <span key={i} className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded border border-border">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Transcript Excerpts ─────────────────────────────────────────────── */}
      {!compact && profile.transcriptExcerpts && (
        <TranscriptPanel profile={profile} />
      )}

      {/* ── Recent Video Titles ─────────────────────────────────────────────── */}
      {videoTitles.length > 0 && !compact && (
        <div className="p-4 rounded-xl bg-secondary/40 border border-border/50 space-y-3">
          <div className="flex items-center gap-2">
            <Film className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              Sampled Content ({videoTitles.length} posts)
            </span>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {videoTitles.slice(0, 15).map((title, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="text-muted-foreground/40 flex-shrink-0 w-4 text-right">{i + 1}.</span>
                <span className="leading-relaxed">{title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── AI Summary ──────────────────────────────────────────────────────── */}
      {profile.aiSummary && (
        <div className="p-4 rounded-xl bg-muted/30 border border-border/50">
          <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-2">
            Cultural Analyst Summary
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed">{profile.aiSummary}</p>
        </div>
      )}

      {/* ── Field Notes ─────────────────────────────────────────────────────── */}
      {compact ? null : (
        <>
          {FIELD_SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="mb-4">
                <h4 className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground">{section.title}</h4>
                <p className="text-xs text-muted-foreground/60 mt-0.5">{section.subtitle}</p>
              </div>
              <div className="space-y-3">
                {section.fields.map((field) => {
                  const value = profile[field.key as keyof CreatorProfile];
                  const hasExplainer = EXPLAINED_FIELD_KEYS.has(field.key);
                  return (
                    <div key={field.key} className="py-2 border-b border-border/30 last:border-0">
                      <div className="grid grid-cols-[1fr_1.5fr] gap-4 items-start">
                        <span className="text-xs text-muted-foreground pt-0.5">{field.label}</span>
                        <FieldValue fieldKey={field.key} value={value} type={field.type} />
                      </div>
                      {hasExplainer && (
                        <div className="mt-1 pl-0">
                          <FieldExplainer fieldKey={field.key} value={value !== null && value !== undefined ? String(value) : null} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Boolean niche signals */}
              {section.title.includes("Three") && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {BOOLEAN_FIELDS.map((bf) => {
                    const val = profile[bf.key as keyof CreatorProfile] as boolean | null;
                    return (
                      <div key={bf.key} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${val ? "bg-green-400" : "bg-muted-foreground/30"}`} />
                        <span className="text-xs text-muted-foreground">{bf.label}</span>
                        <span className={`ml-auto text-xs font-medium ${val ? "text-green-400" : "text-muted-foreground/50"}`}>
                          {val ? "Yes" : "No"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
