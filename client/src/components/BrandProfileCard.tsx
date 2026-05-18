import type { BrandProfile } from "../../../drizzle/schema";

interface BrandProfileCardProps {
  profile: BrandProfile;
  compact?: boolean;
}

const BRAND_FIELDS = [
  { key: "archetype", label: "Archetype [Jung]", type: "badge" },
  { key: "emotionalPromise", label: "Emotional Promise", type: "quote" },
  { key: "visualLanguage", label: "Visual Language", type: "tags" },
  { key: "audienceTribe", label: "Audience Tribe", type: "text" },
  { key: "culturalTension", label: "Cultural Tension", type: "quote" },
  { key: "barthesMyth", label: "Myth Question [Barthes]", type: "quote" },
];

const WEIGHT_FIELDS = [
  { key: "brandType", label: "Brand Type", type: "text" },
  { key: "campaignType", label: "Campaign Type", type: "badge" },
  { key: "weightAlpha", label: "α — Alignment Weight", type: "weight" },
  { key: "weightBeta", label: "β — Pulse Weight", type: "weight" },
  { key: "weightGamma", label: "γ — Stability Weight", type: "weight" },
  { key: "weightPriority", label: "Weight Priority", type: "text" },
];

function FieldValue({ value, type }: { value: unknown; type: string }) {
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

  if (type === "weight") {
    const w = Number(value);
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden max-w-24">
          <div
            className="h-full rounded-full gold-gradient"
            style={{ width: `${w * 100}%` }}
          />
        </div>
        <span className="text-sm font-mono text-primary">{w.toFixed(1)}</span>
      </div>
    );
  }

  return <span className="text-sm text-foreground">{String(value)}</span>;
}

export default function BrandProfileCard({ profile, compact = false }: BrandProfileCardProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-green-400/10 border border-green-400/20 flex items-center justify-center flex-shrink-0">
          <span className="text-lg font-serif text-green-400">
            {profile.brandName?.[0]?.toUpperCase() ?? "?"}
          </span>
        </div>
        <div>
          <h3 className="font-semibold text-lg text-foreground">{profile.brandName}</h3>
          <div className="flex items-center gap-2 mt-1">
            {profile.category && (
              <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-secondary text-muted-foreground">
                {profile.category}
              </span>
            )}
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
          {/* Field Note One: Brand Snapshot */}
          <div>
            <div className="mb-4">
              <h4 className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground">
                Field Note One: Brand Snapshot
              </h4>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Symbolic Position & Cultural Identity</p>
            </div>
            <div className="space-y-3">
              {BRAND_FIELDS.map((field) => {
                const value = profile[field.key as keyof BrandProfile];
                return (
                  <div key={field.key} className="grid grid-cols-[1fr_1.5fr] gap-4 items-start py-2 border-b border-border/30 last:border-0">
                    <span className="text-xs text-muted-foreground pt-0.5">{field.label}</span>
                    <FieldValue value={value} type={field.type} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Weight Configuration */}
          <div>
            <div className="mb-4">
              <h4 className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground">
                Weight Configuration
              </h4>
              <p className="text-xs text-muted-foreground/60 mt-0.5">α/β/γ Weights from Brand Type Table</p>
            </div>
            <div className="space-y-3">
              {WEIGHT_FIELDS.map((field) => {
                const value = profile[field.key as keyof BrandProfile];
                return (
                  <div key={field.key} className="grid grid-cols-[1fr_1.5fr] gap-4 items-start py-2 border-b border-border/30 last:border-0">
                    <span className="text-xs text-muted-foreground pt-0.5">{field.label}</span>
                    <FieldValue value={value} type={field.type} />
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
