import { useState } from "react";
import { toast } from "sonner";
import {
  Users, Loader2, Sparkles, CheckCircle2, ArrowRight, AlertTriangle, Clock, PauseCircle, XCircle,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";

// ─── Platform icon ────────────────────────────────────────────────────────────

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.98a8.18 8.18 0 0 0 3.76.92V6.69" />
    </svg>
  );
}

/**
 * THE PHASES, AS THEY ACTUALLY ARE. Five, in pipeline order, matching the
 * ledger exactly — because that is where the status comes from.
 *
 * What used to be here was a list of phase labels advanced by a setInterval
 * against hardcoded elapsed-time marks. The names were honest; the POSITION was
 * a guess, and it kept guessing while the run did something else entirely. It
 * replaced an even worse indicator that listed 13 fabricated "LLM steps" for
 * what is a single extraction call. There is no estimator here now: every
 * highlight below is a row in analysis_phase_state.
 */
const PHASE_LABELS: Record<string, string> = {
  capture: "Capture — profile and recent videos",
  augment: "Augment — widening the sample by search",
  transcribe: "Transcribe — spoken content across the sample",
  derive: "Derive — themes and symbols",
  extract_commit: "Extract & commit — cultural profile, saved",
};
const PHASE_ORDER = ["capture", "augment", "transcribe", "derive", "extract_commit"];

type CampaignStatus = {
  runId: string;
  handle: string;
  platform: string;
  state: "queued" | "running" | "parked" | "complete" | "failed";
  currentPhase: string | null;
  phases: Array<{
    phase: string; status: string; attemptCount: number;
    failureClass: string | null; nextEarliestAt: Date | string | null;
  }>;
  subjectId: string | null;
  message: string | null;
};

/** "in 4m 20s" — a park has a real time, so show it. */
function untilLabel(at: Date | string | null): string | null {
  if (!at) return null;
  const ms = new Date(at).getTime() - Date.now();
  if (ms <= 0) return "now";
  const s = Math.round(ms / 1000);
  return s < 60 ? `in ${s}s` : `in ${Math.floor(s / 60)}m ${s % 60}s`;
}

const STATE_STYLE: Record<CampaignStatus["state"], { icon: typeof Clock; cls: string; label: string }> = {
  queued:   { icon: Clock,        cls: "text-muted-foreground", label: "Queued" },
  running:  { icon: Loader2,      cls: "text-foreground",       label: "Running" },
  parked:   { icon: PauseCircle,  cls: "text-amber-400",        label: "Parked" },
  complete: { icon: CheckCircle2, cls: "text-green-400",        label: "Complete" },
  failed:   { icon: XCircle,      cls: "text-destructive",      label: "Failed" },
};

function CampaignRow({ c }: { c: CampaignStatus }) {
  const style = STATE_STYLE[c.state];
  const Icon = style.icon;
  const byPhase = new Map(c.phases.map(p => [p.phase, p]));
  const parked = c.phases.find(p => p.nextEarliestAt && new Date(p.nextEarliestAt).getTime() > Date.now());

  return (
    <div className="fit-card rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <TikTokIcon className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
            <span className="font-medium truncate">@{c.handle}</span>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground/50 mt-0.5">{c.runId.slice(0, 8)}</div>
        </div>
        <div className={`flex items-center gap-1.5 text-xs whitespace-nowrap ${style.cls}`}>
          <Icon className={`w-3.5 h-3.5 ${c.state === "running" ? "animate-spin" : ""}`} />
          {style.label}
          {parked && <span className="text-muted-foreground/70">{untilLabel(parked.nextEarliestAt)}</span>}
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {PHASE_ORDER.map(name => {
          const p = byPhase.get(name);
          const done = p && (p.status === "complete" || p.status === "partial");
          const running = p?.status === "running";
          const bad = p && (p.status === "failed" || p.status === "blocked");
          return (
            <div key={name} className={`flex items-center gap-2 text-xs ${
              done ? "text-green-400" : running ? "text-foreground"
                : bad ? "text-destructive" : "text-muted-foreground/30"
            }`}>
              {done ? <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                : running ? <Loader2 className="w-3 h-3 flex-shrink-0 animate-spin" />
                : bad ? <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                : <div className="w-3 h-3 rounded-full border border-current flex-shrink-0 opacity-30" />}
              <span className="truncate">{PHASE_LABELS[name]}</span>
              {p && p.attemptCount > 1 && (
                <span className="text-[10px] text-amber-400/80 whitespace-nowrap">attempt {p.attemptCount}</span>
              )}
              {p?.status === "partial" && (
                <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">partial</span>
              )}
            </div>
          );
        })}
      </div>

      {c.message && (
        <p className="mt-3 text-xs text-destructive/90 border-t border-border/50 pt-2">{c.message}</p>
      )}
      {c.state === "complete" && c.subjectId && (
        <Link href={`/creator/${c.subjectId}`}>
          <Button variant="ghost" size="sm" className="mt-3 h-7 text-xs px-2">
            Open profile <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
        </Link>
      )}
    </div>
  );
}

export default function AnalyzeCreator() {
  const [raw, setRaw] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const utils = trpc.useUtils();

  /** One per line or comma — a single creator is just a list of one. */
  const handles = raw.split(/[\n,]/).map(h => h.trim()).filter(Boolean);

  // The queue view. Polls the LEDGER; there is no local progress state to drift.
  const queue = trpc.creator.queueStatus.useQuery(
    {},
    { refetchInterval: 3000, refetchOnWindowFocus: true },
  );

  const submit = trpc.creator.submit.useMutation({
    onSuccess: (data) => {
      setRaw("");
      setDuplicateWarning(null);
      toast.success(
        data.campaigns.length === 1
          ? `Queued @${data.campaigns[0].handle}`
          : `Queued ${data.campaigns.length} creators`,
      );
      void utils.creator.queueStatus.invalidate();
    },
    onError: (error) => {
      // The duplicate gate runs BEFORE anything is enqueued, so this is a
      // question, not a failure.
      if (error.data?.code === "PRECONDITION_FAILED" && error.message.includes("already exists")) {
        setDuplicateWarning(error.message);
        return;
      }
      toast.error(error.message);
    },
  });

  const campaigns = (queue.data?.campaigns ?? []) as unknown as CampaignStatus[];
  const active = campaigns.filter(c => c.state !== "complete" && c.state !== "failed");

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] uppercase text-muted-foreground">
          <Users className="w-3.5 h-3.5" /> Analyze creators
        </div>
        <p className="text-sm text-muted-foreground/70 mt-2">
          Queue one creator or twenty. Analyses run in the background — you can close this page,
          and a restart resumes anything still in flight.
        </p>
      </div>

      <div className="fit-card rounded-xl p-5 space-y-4">
        <div className="space-y-2">
          <Label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            TikTok handles — one per line
          </Label>
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={4}
            placeholder={"@username\ntiktok.com/@another"}
            className="bg-secondary border-border placeholder:text-muted-foreground/40 font-mono text-sm"
          />
          {handles.length > 1 && (
            <p className="text-xs text-muted-foreground/60">{handles.length} handles</p>
          )}
        </div>

        <Button
          onClick={() => submit.mutate({ handles, platform: "TikTok" })}
          disabled={handles.length === 0 || submit.isPending}
          className="w-full gold-gradient text-background font-semibold hover:opacity-90 transition-opacity"
        >
          {submit.isPending
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Queueing…</>
            : <><Sparkles className="w-4 h-4 mr-2" /> Queue {handles.length > 1 ? `${handles.length} analyses` : "analysis"}</>}
        </Button>
      </div>

      {campaigns.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              Queue
            </div>
            <div className="text-xs text-muted-foreground/60">
              {active.length > 0 ? `${active.length} in flight` : "idle"}
            </div>
          </div>
          {campaigns.map(c => <CampaignRow key={c.runId} c={c} />)}
        </div>
      )}

      <AlertDialog open={duplicateWarning !== null} onOpenChange={(o) => !o && setDuplicateWarning(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" /> Already analyzed
            </AlertDialogTitle>
            <AlertDialogDescription>{duplicateWarning}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => submit.mutate({ handles, platform: "TikTok", confirmDuplicate: true })}
            >
              Queue anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
