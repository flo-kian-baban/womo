/**
 * SUBMIT AND WATCH. There is one way in — the queue.
 *
 * One handle is submitted at a time, but it goes through the SAME queue as
 * everything else — a single creator is a queue of one, which is the
 * architectural rule rather than a convenience. Nothing here blocks on a
 * result: submission returns a run id, and everything after that is the
 * ledger's account of what happened, polled.
 *
 * NOTHING ON THIS PAGE IS ESTIMATED. The progress animation that used to live
 * here advanced phase labels on a setInterval against hardcoded elapsed-time
 * marks — honest names, guessed positions, and it kept guessing while the run
 * did something else. Every mark now comes from `analysis_phase_state`. If a
 * value is not knowable, it says so rather than showing a plausible number.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Users, Loader2, Sparkles, AlertTriangle, ClipboardPaste } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { CampaignQueue, pollIntervalFor } from "@/components/CampaignQueue";
import { isBrandCampaign, type Campaign } from "@/lib/campaignState";
import { PlatformMark, SUPPORTED_PLATFORMS, type SupportedPlatform } from "@/components/PlatformMark";

/**
 * "@name", "name", or a pasted profile URL → "name".
 *
 * Platform-agnostic on purpose: it strips a leading @ and, for anything that
 * looks like a URL, takes the last path segment. It does NOT know platform
 * domains — the platform is chosen above the field, and encoding a domain list
 * here would be the hardcoding this session exists to remove.
 */
export function normalizeHandle(input: string): string {
  const s = input.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s) || s.includes("/")) {
    const last = s.split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? "";
    return last.replace(/^@/, "");
  }
  return s.replace(/^@/, "");
}

export default function AnalyzeCreator() {
  const [raw, setRaw] = useState("");
  const [platform, setPlatform] = useState<SupportedPlatform>("TikTok");
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const utils = trpc.useUtils();

  /**
   * The queue view. Polls the LEDGER, so there is no local progress state that
   * can drift from reality. `includeTerminal` is what makes completed and
   * failed campaigns visible at all — the in-flight query excludes both by
   * design, which meant the queue read as empty within seconds of finishing.
   */
  const queue = trpc.creator.queueStatus.useQuery(
    { includeTerminal: true, limit: 50 },
    {
      // Paced by whether anything is actually moving — see pollIntervalFor.
      refetchInterval: (q) => pollIntervalFor(q.state.data?.campaigns),
      refetchOnWindowFocus: true,
    },
  );

  const submit = trpc.creator.submit.useMutation({
    onSuccess: (data) => {
      setRaw("");
      setDuplicateWarning(null);
      toast.success(
        data.campaigns.length === 1
          ? `Queued @${data.campaigns[0].handle}`
          : `Queued ${data.campaigns.length} analyses`,
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

  /**
   * ONE handle at a time. The transport still takes an array — a single creator
   * is a queue of one, which is the architectural rule, not a UI compromise —
   * but the analyst submits one handle and sees it appear, rather than
   * assembling a batch and losing track of which of twenty failed.
   *
   * A pasted profile URL is reduced to its handle, so the common gesture
   * (copy the profile link, paste, Enter) just works.
   */
  const handle = normalizeHandle(raw);
  const canSubmit = handle.length > 0 && !submit.isPending;

  /** Paste without leaving the keyboard; clipboard access can legitimately be denied. */
  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) setRaw(text.trim());
      else toast.error("Clipboard is empty");
    } catch {
      toast.error("Clipboard access was blocked — paste with ⌘V instead");
    }
  };

  /**
   * CREATORS ONLY. This page used to list every campaign in the ledger,
   * brands included, because only the brand page filtered — so a brand run
   * appeared under "Analyze creators" with a storefront glyph beside it.
   */
  const campaigns: Campaign[] = (queue.data?.campaigns ?? []).filter(c => !isBrandCampaign(c));

  return (
    /*
      The page is wide because the QUEUE is: a dense row has to hold state,
      subject, six phase marks, capture health and timing side by side, and at
      twenty campaigns that has to be scannable without horizontal squeeze. The
      submit form stays narrow — it is one field and does not want the width.
    */
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-6">
      <div className="max-w-3xl">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] uppercase text-muted-foreground">
          <Users className="w-3.5 h-3.5" /> Analyze creators
        </div>
        <p className="text-sm text-muted-foreground/70 mt-2">
          Queue a creator and it runs in the background — you can close this page, and a
          restart resumes anything still in flight. Queue as many as you like, one at a time.
        </p>
      </div>

      <div className="fit-card rounded-xl p-5 space-y-4 max-w-3xl">
        <div className="space-y-2">
          <Label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            Platform
          </Label>
          <div className="flex gap-1.5">
            {SUPPORTED_PLATFORMS.map(p => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                  platform === p
                    ? "border-indigo-400/40 bg-indigo-400/10 text-foreground"
                    : "border-border text-muted-foreground/60 hover:text-foreground/80"
                }`}
              >
                <PlatformMark platform={p} className="w-3.5 h-3.5" muted={platform !== p} />
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            Handle
          </Label>
          <div className="flex gap-2">
            <Input
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onKeyDown={(e) => {
                // Enter submits — the whole form is one field, so a trip to the
                // button is pure friction.
                if (e.key === "Enter" && canSubmit) {
                  e.preventDefault();
                  submit.mutate({ handles: [handle], platform });
                }
              }}
              placeholder="@username"
              spellCheck={false}
              autoComplete="off"
              className="bg-secondary border-border placeholder:text-muted-foreground/40 font-mono text-sm"
            />
            <Button
              type="button"
              variant="outline"
              onClick={pasteFromClipboard}
              title="Paste from clipboard"
              className="flex-shrink-0 px-3"
            >
              <ClipboardPaste className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <Button
          onClick={() => submit.mutate({ handles: [handle], platform })}
          disabled={!canSubmit}
          className="w-full gold-gradient text-background font-semibold hover:opacity-90 transition-opacity"
        >
          {submit.isPending
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Queueing…</>
            : <><Sparkles className="w-4 h-4 mr-2" /> Queue analysis</>}
        </Button>
      </div>

      <CampaignQueue
        campaigns={campaigns}
        isLoading={queue.isLoading}
        emptyLabel="No creator analyses yet."
      />


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
              onClick={() => submit.mutate({ handles: [handle], platform, confirmDuplicate: true })}
            >
              Queue anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
