import { Link } from "wouter";
import { Users, Building2, BarChart3, BookOpen, ArrowRight, Zap, Activity, TrendingUp } from "lucide-react";
import { trpc } from "@/lib/trpc";

const FEATURE_CARDS = [
  {
    href: "/analyze/influencer",
    icon: Users,
    label: "Analyze Creator",
    description: "Extract a complete cultural profile from any TikTok or YouTube handle using AI and the F.I.T. framework.",
    color: "#6366F1",
    delay: "animate-stagger-1",
  },
  {
    href: "/analyze/brand",
    icon: Building2,
    label: "Analyze Brand",
    description: "Research any brand or business to extract its archetype, symbolic position, and audience tribe.",
    color: "#10b981",
    delay: "animate-stagger-2",
  },
  {
    href: "/fit-score",
    icon: BarChart3,
    label: "Cultural Match Score",
    description: "Calculate the Alignment, Pulse, and Stability scores for any creator-brand pair with full radar warnings.",
    color: "#38BDF8",
    delay: "animate-stagger-3",
  },
  {
    href: "/library",
    icon: BookOpen,
    label: "Profile Library",
    description: "Browse, search, and manage all saved creator profiles, brand profiles, and match records.",
    color: "#a78bfa",
    delay: "animate-stagger-4",
  },
];

const FRAMEWORK_PILLARS = [
  { label: "Alignment (α)", desc: "Archetype compatibility, myth alignment, and audience tribe overlap", icon: Activity },
  { label: "Pulse (β)", desc: "Rogers adoption curve positioning and liminal phase adjustment", icon: TrendingUp },
  { label: "Stability (γ)", desc: "Goffman stage consistency and 6-month identity drift signal", icon: Zap },
];

export default function Home() {
  const { data: creators } = trpc.creator.list.useQuery({ search: undefined });
  const { data: brands } = trpc.brand.list.useQuery({ search: undefined });
  const { data: matches } = trpc.fit.list.useQuery();

  return (
    <div className="min-h-full px-6 py-8 lg:px-10 lg:py-10">
      {/* ─── Hero ──────────────────────────────────────────────────────────── */}
      <div className="mb-12 animate-fade-in-up">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/20 bg-primary/[0.06] mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-[#38BDF8] animate-pulse" />
          <span className="text-[11px] font-bold text-primary tracking-[0.2em] uppercase">Cultural Intelligence Platform</span>
        </div>
        <h1 className="text-4xl lg:text-5xl font-black mb-4 leading-tight tracking-tight">
          The Cultural Match Score<br />
          <span className="gold-text">Engine</span>
        </h1>
        <p className="text-muted-foreground text-lg max-w-xl leading-relaxed">
          AI-powered cultural alignment scoring for influencer-brand partnerships.
          Grounded in Jungian archetypes, Bourdieusian symbolic capital, and Stuart Hall decoding theory.
        </p>
      </div>

      {/* ─── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4 mb-10 animate-fade-in-up animate-stagger-1">
        {[
          { label: "Creators", value: creators?.length ?? 0, href: "/library" },
          { label: "Brands", value: brands?.length ?? 0, href: "/library" },
          { label: "Cultural Match Score Reports", value: matches?.length ?? 0, href: "/library" },
        ].map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <div className="fit-card rounded-2xl p-4 cursor-pointer transition-all duration-300 group">
              <div className="text-2xl font-black gold-text mb-1">{stat.value}</div>
              <div className="text-xs text-muted-foreground font-medium">{stat.label}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* ─── Feature Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
        {FEATURE_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.href} href={card.href}>
              <div
                className={`fit-card rounded-2xl p-6 cursor-pointer transition-all duration-300 group animate-fade-in-up ${card.delay}`}
              >
                <div className="flex items-start gap-4">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-110"
                    style={{ background: `${card.color}18`, border: `1px solid ${card.color}35` }}
                  >
                    <Icon className="w-5 h-5" style={{ color: card.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-bold text-foreground">{card.label}</h3>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all duration-300" />
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{card.description}</p>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* ─── Framework Pillars ─────────────────────────────────────────────── */}
      <div className="animate-fade-in-up animate-stagger-5">
        <h2 className="text-[10px] font-black tracking-[0.2em] uppercase text-muted-foreground mb-4">
          Scoring Framework
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {FRAMEWORK_PILLARS.map((pillar, i) => {
            const Icon = pillar.icon;
            const colors = [
              "#6366F1",
              "#10b981",
              "#38BDF8",
            ];
            return (
              <div
                key={pillar.label}
                className="fit-card rounded-2xl p-5"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="w-4 h-4" style={{ color: colors[i] }} />
                  <span className="font-bold text-sm">{pillar.label}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{pillar.desc}</p>
              </div>
            );
          })}
        </div>

        {/* Theory credits */}
        <div className="mt-6 p-4 rounded-2xl border border-border/50 bg-muted/30">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span><strong className="text-foreground/60 font-bold">Archetypes:</strong> Carl Jung</span>
            <span><strong className="text-foreground/60 font-bold">Symbolic Capital:</strong> Pierre Bourdieu</span>
            <span><strong className="text-foreground/60 font-bold">Myth Analysis:</strong> Roland Barthes</span>
            <span><strong className="text-foreground/60 font-bold">Stage Theory:</strong> Erving Goffman</span>
            <span><strong className="text-foreground/60 font-bold">Decoding:</strong> Stuart Hall</span>
            <span><strong className="text-foreground/60 font-bold">Adoption Curve:</strong> Everett Rogers</span>
            <span><strong className="text-foreground/60 font-bold">Liminality:</strong> Victor Turner</span>
          </div>
        </div>
      </div>
    </div>
  );
}
