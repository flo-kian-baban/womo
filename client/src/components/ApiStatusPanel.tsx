import { trpc } from "@/lib/trpc";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type StatusLevel = "ok" | "limited" | "down";

const STATUS_CONFIG: Record<StatusLevel, { icon: typeof CheckCircle2; color: string; bg: string; label: string }> = {
  ok:      { icon: CheckCircle2,   color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Online" },
  limited: { icon: AlertTriangle,  color: "text-amber-400",   bg: "bg-amber-500/10",   label: "Limited" },
  down:    { icon: XCircle,        color: "text-red-400",     bg: "bg-red-500/10",     label: "Offline" },
};

export function ApiStatusPanel() {
  const { data, isLoading, refetch, isFetching } = trpc.system.apiStatus.useQuery(undefined, {
    staleTime: 60_000,        // cache for 1 minute
    refetchOnWindowFocus: false,
  });

  const overallColor =
    !data ? "text-muted-foreground" :
    data.overall === "ok" ? "text-emerald-400" :
    data.overall === "degraded" ? "text-red-400" :
    "text-amber-400";

  const overallLabel =
    !data ? "Checking..." :
    data.overall === "ok" ? "All sources online" :
    data.overall === "degraded" ? "Some sources offline" :
    "Limited availability";

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 p-3 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <Wifi className={cn("w-3.5 h-3.5", overallColor)} />
          <span className="text-xs font-medium text-muted-foreground">Research Sources</span>
          <span className={cn("text-xs font-medium", overallColor)}>{overallLabel}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => refetch()}
          disabled={isFetching}
          title="Refresh status"
        >
          <RefreshCw className={cn("w-3 h-3", isFetching && "animate-spin")} />
        </Button>
      </div>

      {/* Source rows */}
      {isLoading ? (
        <div className="flex gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-7 flex-1 rounded bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : data ? (
        <div className="flex gap-2">
          {data.sources.map((source) => {
            const cfg = STATUS_CONFIG[source.status as StatusLevel] ?? STATUS_CONFIG.limited;
            const Icon = cfg.icon;
            return (
              <div
                key={source.name}
                className={cn(
                  "flex-1 flex items-center gap-1.5 rounded px-2 py-1.5 text-xs",
                  cfg.bg
                )}
                title={source.message}
              >
                <Icon className={cn("w-3 h-3 shrink-0", cfg.color)} />
                <div className="min-w-0">
                  <div className={cn("font-medium leading-none truncate", cfg.color)}>
                    {source.name === "YouTube Data API" ? "YouTube" : source.name}
                  </div>
                  <div className="text-muted-foreground leading-none mt-0.5 truncate text-[10px]">
                    {source.status === "down" && source.message.includes("quota")
                      ? "Quota reset ~midnight PT"
                      : cfg.label}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Unable to check status.</p>
      )}

      {/* Degraded notice */}
      {data?.overall === "degraded" && (
        <p className="mt-2 text-[11px] text-muted-foreground leading-snug">
          Offline sources will be skipped. Brand analysis will still run using available data — results may be less detailed.
        </p>
      )}
    </div>
  );
}
