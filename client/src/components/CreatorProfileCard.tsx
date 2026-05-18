import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { CreatorProfile } from "../../../drizzle/schema";

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
                i <= Math.round(score)
                  ? "bg-primary"
                  : "bg-border"
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
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
          <span className="text-lg font-serif text-primary">
            {(profile.displayName ?? profile.handle)?.[0]?.toUpperCase() ?? "?"}
          </span>
        </div>
        <div>
          <h3 className="font-semibold text-lg text-foreground">{profile.displayName ?? profile.handle}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-muted-foreground">@{profile.handle}</span>
            <span className="text-muted-foreground/30">·</span>
            <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-secondary text-muted-foreground">
              {profile.platform}
            </span>
          </div>
        </div>
      </div>

      {/* AI Summary */}
      {profile.aiSummary && (
        <div className="p-4 rounded-xl bg-muted/30 border border-border/50">
          <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-2">
            Cultural Analyst Summary
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed">{profile.aiSummary}</p>
        </div>
      )}

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
                  return (
                    <div key={field.key} className="grid grid-cols-[1fr_1.5fr] gap-4 items-start py-2 border-b border-border/30 last:border-0">
                      <span className="text-xs text-muted-foreground pt-0.5">{field.label}</span>
                      <FieldValue fieldKey={field.key} value={value} type={field.type} />
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
