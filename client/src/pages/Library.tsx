import { useState } from "react";
import { Link } from "wouter";
import { BookOpen, Users, Building2, BarChart3, Search, Trash2, ExternalLink, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

function FITStatusDot({ status }: { status: string | null }) {
  if (status === "Green Light") return <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />;
  if (status === "Proceed with Caution") return <div className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />;
  return <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />;
}

export default function Library() {
  const [creatorSearch, setCreatorSearch] = useState("");
  const [brandSearch, setBrandSearch] = useState("");

  const utils = trpc.useUtils();

  const { data: creators, isLoading: loadingCreators } = trpc.creator.list.useQuery({ search: creatorSearch || undefined });
  const { data: brands, isLoading: loadingBrands } = trpc.brand.list.useQuery({ search: brandSearch || undefined });
  const { data: matches, isLoading: loadingMatches } = trpc.fit.list.useQuery();

  const deleteCreator = trpc.creator.delete.useMutation({
    onSuccess: () => { utils.creator.list.invalidate(); toast.success("Creator profile deleted"); },
    onError: () => toast.error("Failed to delete"),
  });
  const deleteBrand = trpc.brand.delete.useMutation({
    onSuccess: () => { utils.brand.list.invalidate(); toast.success("Brand profile deleted"); },
    onError: () => toast.error("Failed to delete"),
  });
  const deleteMatch = trpc.fit.delete.useMutation({
    onSuccess: () => { utils.fit.list.invalidate(); toast.success("Match record deleted"); },
    onError: () => toast.error("Failed to delete"),
  });

  const handleExportCreator = (creator: NonNullable<typeof creators>[0]) => {
    const blob = new Blob([JSON.stringify(creator, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `connex-creator-${creator.handle}-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Creator profile exported");
  };

  const handleExportBrand = (brand: NonNullable<typeof brands>[0]) => {
    const blob = new Blob([JSON.stringify(brand, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `connex-brand-${brand.brandName}-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Brand profile exported");
  };

  return (
    <div className="min-h-full px-6 py-8 lg:px-10 lg:py-10">
      {/* Header */}
      <div className="mb-8 animate-fade-in-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-purple-400/10 border border-purple-400/20 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-2xl font-serif">Profile Library</h1>
            <p className="text-sm text-muted-foreground">Browse and manage all saved profiles and match records</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="creators" className="animate-fade-in-up animate-stagger-1">
        <TabsList className="bg-secondary border border-border mb-6">
          <TabsTrigger value="creators" className="gap-2">
            <Users className="w-3.5 h-3.5" />
            Influencers
            {creators && <span className="ml-1 text-xs text-muted-foreground">({creators.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="brands" className="gap-2">
            <Building2 className="w-3.5 h-3.5" />
            Brands
            {brands && <span className="ml-1 text-xs text-muted-foreground">({brands.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="matches" className="gap-2">
            <BarChart3 className="w-3.5 h-3.5" />
            F.I.T. Reports
            {matches && <span className="ml-1 text-xs text-muted-foreground">({matches.length})</span>}
          </TabsTrigger>
        </TabsList>

        {/* ─── Creators Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="creators">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={creatorSearch}
                onChange={(e) => setCreatorSearch(e.target.value)}
                placeholder="Search by handle..."
                className="pl-9 bg-secondary border-border text-sm"
              />
            </div>
            <Link href="/analyze/influencer">
              <Button size="sm" className="gold-gradient text-background font-semibold">
                + Analyze New
              </Button>
            </Link>
          </div>

          {loadingCreators ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Loading...</div>
          ) : !creators?.length ? (
            <div className="fit-card rounded-xl p-12 flex flex-col items-center justify-center text-center">
              <Users className="w-10 h-10 text-muted-foreground/20 mb-4" />
              <p className="text-muted-foreground">No influencer profiles yet</p>
              <Link href="/analyze/influencer">
                <Button size="sm" variant="outline" className="mt-4 border-primary/30 text-primary">
                  Analyze your first influencer
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {creators.map((creator) => (
                <div key={creator.id} className="fit-card rounded-xl p-5 hover:border-primary/30 transition-all duration-200 group">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-blue-400/10 border border-blue-400/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-serif text-blue-400">
                          {(creator.displayName ?? creator.handle)?.[0]?.toUpperCase() ?? "?"}
                        </span>
                      </div>
                      <div>
                        <div className="font-medium text-sm">{creator.displayName ?? creator.handle}</div>
                        <div className="text-xs text-muted-foreground">@{creator.handle} · {creator.platform}</div>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => handleExportCreator(creator)}
                        title="Export JSON"
                      >
                        <FileJson className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        onClick={() => deleteCreator.mutate({ id: creator.id })}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {creator.archetype && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-16">Archetype</span>
                        <span className="text-xs px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">
                          {creator.archetype}
                        </span>
                      </div>
                    )}
                    {creator.nicheTopicNode && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-16">Niche</span>
                        <span className="text-xs text-foreground/70">{creator.nicheTopicNode}</span>
                      </div>
                    )}
                    {creator.goffmanStageConsistency && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-16">Goffman</span>
                        <span className={`text-xs ${
                          creator.goffmanStageConsistency === "Consistent" ? "text-green-400" :
                          creator.goffmanStageConsistency === "Minor Gap" ? "text-yellow-400" : "text-red-400"
                        }`}>{creator.goffmanStageConsistency}</span>
                      </div>
                    )}
                  </div>

                  {creator.aiSummary && (
                    <p className="text-xs text-muted-foreground/60 mt-3 line-clamp-2 leading-relaxed">
                      {creator.aiSummary}
                    </p>
                  )}

                  <div className="mt-3 pt-3 border-t border-border/30 text-[10px] text-muted-foreground/40">
                    {new Date(creator.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ─── Brands Tab ───────────────────────────────────────────────────── */}
        <TabsContent value="brands">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={brandSearch}
                onChange={(e) => setBrandSearch(e.target.value)}
                placeholder="Search by brand name..."
                className="pl-9 bg-secondary border-border text-sm"
              />
            </div>
            <Link href="/analyze/brand">
              <Button size="sm" className="gold-gradient text-background font-semibold">
                + Analyze New
              </Button>
            </Link>
          </div>

          {loadingBrands ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Loading...</div>
          ) : !brands?.length ? (
            <div className="fit-card rounded-xl p-12 flex flex-col items-center justify-center text-center">
              <Building2 className="w-10 h-10 text-muted-foreground/20 mb-4" />
              <p className="text-muted-foreground">No brand profiles yet</p>
              <Link href="/analyze/brand">
                <Button size="sm" variant="outline" className="mt-4 border-primary/30 text-primary">
                  Analyze your first brand
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {brands.map((brand) => (
                <div key={brand.id} className="fit-card rounded-xl p-5 hover:border-primary/30 transition-all duration-200 group">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-green-400/10 border border-green-400/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-serif text-green-400">
                          {brand.brandName?.[0]?.toUpperCase() ?? "?"}
                        </span>
                      </div>
                      <div>
                        <div className="font-medium text-sm">{brand.brandName}</div>
                        <div className="text-xs text-muted-foreground">{brand.category}</div>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => handleExportBrand(brand)}
                        title="Export JSON"
                      >
                        <FileJson className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        onClick={() => deleteBrand.mutate({ id: brand.id })}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {brand.archetype && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-20">Archetype</span>
                        <span className="text-xs px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">
                          {brand.archetype}
                        </span>
                      </div>
                    )}
                    {brand.brandType && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-20">Brand Type</span>
                        <span className="text-xs text-foreground/70 truncate">{brand.brandType}</span>
                      </div>
                    )}
                    {brand.weightPriority && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-20">Priority</span>
                        <span className="text-xs text-primary/80">{brand.weightPriority}</span>
                      </div>
                    )}
                  </div>

                  {brand.aiSummary && (
                    <p className="text-xs text-muted-foreground/60 mt-3 line-clamp-2 leading-relaxed">
                      {brand.aiSummary}
                    </p>
                  )}

                  <div className="mt-3 pt-3 border-t border-border/30 text-[10px] text-muted-foreground/40">
                    {new Date(brand.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ─── Matches Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="matches">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">All calculated F.I.T. Score reports</p>
            <Link href="/fit-score">
              <Button size="sm" className="gold-gradient text-background font-semibold">
                + New F.I.T. Score
              </Button>
            </Link>
          </div>

          {loadingMatches ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Loading...</div>
          ) : !matches?.length ? (
            <div className="fit-card rounded-xl p-12 flex flex-col items-center justify-center text-center">
              <BarChart3 className="w-10 h-10 text-muted-foreground/20 mb-4" />
              <p className="text-muted-foreground">No F.I.T. reports yet</p>
              <Link href="/fit-score">
                <Button size="sm" variant="outline" className="mt-4 border-primary/30 text-primary">
                  Calculate your first F.I.T. Score
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {matches.map((match) => (
                <div key={match.id} className="fit-card rounded-xl p-5 hover:border-primary/30 transition-all duration-200 group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <FITStatusDot status={match.fitStatus} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">
                          Creator #{match.creatorProfileId} × Brand #{match.brandProfileId}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {new Date(match.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                          {" · "}
                          {match.fitStatus}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-xl font-serif gold-text">{Number(match.fitScore).toFixed(1)}</div>
                        <div className="text-[10px] text-muted-foreground">F.I.T.</div>
                      </div>

                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link href={`/report/${match.id}`}>
                          <button className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors" title="View Report">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </Link>
                        <button
                          className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          onClick={() => deleteMatch.mutate({ id: match.id })}
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Sub-score mini bars */}
                  <div className="flex gap-3 mt-3 pt-3 border-t border-border/30">
                    {[
                      { label: "α", value: Number(match.alignmentScoreRaw), color: "oklch(0.65 0.15 240)" },
                      { label: "β", value: Number(match.pulseScoreRaw), color: "oklch(0.65 0.15 145)" },
                      { label: "γ", value: Number(match.stabilityScoreRaw), color: "oklch(0.78 0.12 75)" },
                    ].map((s) => (
                      <div key={s.label} className="flex items-center gap-1.5 flex-1">
                        <span className="text-[10px] text-muted-foreground font-mono">{s.label}</span>
                        <div className="flex-1 h-1 rounded-full bg-border overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(s.value / 10) * 100}%`, background: s.color }} />
                        </div>
                        <span className="text-[10px] font-mono" style={{ color: s.color }}>{s.value.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>

                  {/* Radar warnings */}
                  {(match.radarWarnings as string[])?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {(match.radarWarnings as string[]).map((w) => (
                        <span key={w} className="text-[10px] px-2 py-0.5 rounded-full border border-red-400/30 bg-red-400/10 text-red-400">
                          {w}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
