/**
 * SUBMIT AND WATCH. There is one way in — the queue.
 *
 * One handle or twenty is the same call and the same code path — a single
 * creator is a queue of one, which is the architectural rule rather than a
 * convenience. Nothing here blocks on a result: submission returns run ids, and
 * everything after that is the ledger's account of what happened, polled.
 *
 * The entry list groups by platform before submitting, because `creator.submit`
 * takes many handles but ONE platform. A mixed list is therefore at most two
 * calls, and rows are removed as their group succeeds — so a batch stopped
 * halfway by the duplicate gate cannot re-enqueue the half that already went.
 *
 * NOTHING ON THIS PAGE IS ESTIMATED. The progress animation that used to live
 * here advanced phase labels on a setInterval against hardcoded elapsed-time
 * marks — honest names, guessed positions, and it kept guessing while the run
 * did something else. Every mark now comes from `analysis_phase_state`. If a
 * value is not knowable, it says so rather than showing a plausible number.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Users, Loader2, Sparkles, AlertTriangle, ClipboardPaste, X } from "lucide-react";
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
import {
  PlatformMark, SUPPORTED_PLATFORMS, detectPlatform, type SupportedPlatform,
} from "@/components/PlatformMark";

/**
 * "@name", "name", or a pasted profile URL → "name".
 *
 * STILL platform-agnostic, and deliberately so even though the field now detects
 * a platform from a pasted link. This reduces any URL to its last path segment
 * for every platform alike; the domain list that answers "which platform?" lives
 * in PlatformMark, beside the glyph and the label, so adding a platform stays
 * one entry in one file. Teaching this function about domains would put the same
 * knowledge in two places and let them drift.
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

/**
 * One line of the entry list. `id` is stable so React never reorders inputs.
 *
 * There is no "was this detected?" flag. The selected glyph already shows which
 * platform a row will run on, whether the link chose it or the analyst did, and
 * a sentence repeating that under every row would be twenty lines of narration
 * in a list built for twenty entries. The glyph is the statement.
 */
interface EntryRow {
  id: number;
  raw: string;
  platform: SupportedPlatform;
}

let nextRowId = 1;
const emptyRow = (platform: SupportedPlatform = "TikTok"): EntryRow =>
  ({ id: nextRowId++, raw: "", platform });

/**
 * Split a pasted blob into separate entries.
 *
 * An analyst assembling twenty creators has them in a column somewhere — a
 * spreadsheet, a brief, a chat message — and pastes the lot. Splitting on
 * newlines, commas and whitespace turns one paste into twenty rows instead of
 * one unusable row. A single handle contains none of these, so a normal paste
 * is unaffected.
 */
function splitEntries(text: string): string[] {
  return text.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
}

export default function AnalyzeCreator() {
  const [rows, setRows] = useState<EntryRow[]>(() => [emptyRow()]);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const inputs = useRef(new Map<number, HTMLInputElement | null>());

  /**
   * Keep exactly one trailing empty row.
   *
   * This is what makes the list grow as you fill it: the moment the last row
   * holds something, the next one is already there to type into. Trailing, not
   * "one per keystroke" — a list that sprouts a row per character would be
   * unusable.
   */
  const withTrailingBlank = (list: EntryRow[]): EntryRow[] => {
    const last = list[list.length - 1];
    if (!last || normalizeHandle(last.raw).length > 0) {
      return [...list, emptyRow(last?.platform ?? "TikTok")];
    }
    return list;
  };

  /**
   * One way in for every row, whether typed, pasted with ⌘V, or pasted with the
   * button — so detection cannot work on one path and not another.
   */
  const setRowInput = (id: number, value: string) => {
    const parts = splitEntries(value);
    setRows(prev => {
      const at = prev.findIndex(r => r.id === id);
      if (at === -1) return prev;

      // A multi-entry paste becomes multiple rows, starting at this one.
      const made: EntryRow[] = (parts.length > 1 ? parts : [value]).map((part, i) => {
        const found = detectPlatform(part);
        const base = i === 0 ? prev[at]! : emptyRow(prev[at]!.platform);
        return {
          ...base,
          id: i === 0 ? prev[at]!.id : base.id,
          raw: part,
          // A link we recognise selects its platform. Anything else — a bare
          // handle, a half-typed URL, a platform we do not support — leaves the
          // analyst's choice as it was. Never guess from a bare handle: @nasa
          // exists on both platforms.
          platform: found ?? base.platform,
        };
      });

      return withTrailingBlank([...prev.slice(0, at), ...made, ...prev.slice(at + 1)]);
    });
  };

  const chooseRowPlatform = (id: number, p: SupportedPlatform) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, platform: p } : r));

  const removeRow = (id: number) =>
    setRows(prev => withTrailingBlank(prev.filter(r => r.id !== id)));

  /** Enter commits the row and moves on, the gesture bulk entry is built on. */
  const focusRowAfter = (id: number) => {
    setTimeout(() => {
      setRows(prev => {
        const at = prev.findIndex(r => r.id === id);
        const next = at >= 0 ? prev[at + 1] : undefined;
        if (next) inputs.current.get(next.id)?.focus();
        return prev;
      });
    }, 0);
  };

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

  const submit = trpc.creator.submit.useMutation();

  /**
   * The rows that actually name a subject. A blank row is scaffolding, not an
   * entry, so it is never submitted and never counted.
   */
  const entries = rows
    .map(r => ({ id: r.id, handle: normalizeHandle(r.raw), platform: r.platform }))
    .filter(e => e.handle.length > 0);
  const canSubmit = entries.length > 0 && !submit.isPending;

  /**
   * GROUPED BY PLATFORM, because `creator.submit` takes many handles but ONE
   * platform. A mixed list is therefore at most two calls, not one — and not
   * one call per handle, which would defeat the point of a batch endpoint.
   *
   * This is a client-side accommodation of the endpoint's shape, not a
   * workaround for a defect: a batch and its platform are a single decision on
   * the server, and splitting the batch here keeps that true.
   */
  const groupByPlatform = (list: typeof entries) => {
    const groups = new Map<SupportedPlatform, { ids: number[]; handles: string[] }>();
    for (const e of list) {
      const g = groups.get(e.platform) ?? { ids: [], handles: [] };
      g.ids.push(e.id);
      g.handles.push(e.handle);
      groups.set(e.platform, g);
    }
    return groups;
  };

  /**
   * Queue every filled row.
   *
   * ROWS ARE REMOVED AS THEIR GROUP SUCCEEDS, which is what makes a partial
   * outcome safe. If the TikTok group queues and the Instagram group stops at
   * the duplicate gate, the queued rows are gone and only the ones still
   * awaiting a decision remain — so cancelling and pressing the button again
   * cannot enqueue the first group twice.
   */
  const queueAll = async (confirmDuplicate: boolean) => {
    const groups = groupByPlatform(entries);
    let queued = 0;
    const duplicateMessages: string[] = [];

    for (const [platform, { ids, handles }] of Array.from(groups.entries())) {
      try {
        const res = await submit.mutateAsync({ handles, platform, confirmDuplicate });
        queued += res.campaigns.length;
        setRows(prev => withTrailingBlank(prev.filter(r => !ids.includes(r.id))));
      } catch (err) {
        const e = err as { data?: { code?: string }; message?: string };
        // The duplicate gate runs BEFORE anything is enqueued, so this is a
        // question, not a failure — and the rows stay put for the answer.
        if (e.data?.code === "PRECONDITION_FAILED" && e.message?.includes("already exists")) {
          duplicateMessages.push(e.message);
        } else {
          toast.error(e.message ?? "Submission failed");
        }
      }
    }

    if (queued > 0) {
      toast.success(queued === 1 ? "Queued 1 analysis" : `Queued ${queued} analyses`);
      void utils.creator.queueStatus.invalidate();
    }
    setDuplicateWarning(duplicateMessages.length > 0 ? duplicateMessages.join("\n\n") : null);
  };

  /** Paste without leaving the keyboard; clipboard access can legitimately be denied. */
  const pasteIntoRow = async (id: number) => {
    try {
      const text = await navigator.clipboard.readText();
      // Through setRowInput, so a pasted link detects its platform — and a
      // pasted column becomes many rows — exactly as a typed one does.
      if (text.trim()) setRowInput(id, text.trim());
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
      twenty campaigns that has to be scannable without horizontal squeeze.

      The form matches that width rather than sitting narrower inside it. A card
      at two thirds of the list's width reads as a misalignment, not as a
      deliberate measure — the two are stacked in one column and the eye lines
      their left and right edges up whether or not the layout meant it to. Only
      the intro prose stays narrow, where a short measure genuinely helps.
    */
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-6">
      <div className="max-w-3xl">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] uppercase text-muted-foreground">
          <Users className="w-3.5 h-3.5" /> Analyze creators
        </div>
        <p className="text-sm text-muted-foreground/70 mt-2">
          Queue creators and they run in the background — you can close this page, and a
          restart resumes anything still in flight. Committed profiles land in the
          Profile Library; what stays here is live work and anything needing your attention.
        </p>
      </div>

      <div className="data-card rounded-xl p-5 space-y-4">
        {/*
          ONE ROW: platform, field, paste. The platform picker used to be a
          separate labelled block above the field, which read as two decisions
          when it is one — you are naming a creator, and the platform is part of
          naming them. The glyphs carry the platform without the words: they are
          the same marks the queue rows use, so the vocabulary is already learned
          by the time anyone reads this form.
        */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
              Handles or profile links
            </Label>
            <span className="text-[11px] text-muted-foreground/45">
              Enter for the next line · paste a column to fill many at once
            </span>
          </div>

          <div className="space-y-1.5">
            {rows.map((row, i) => {
              const filled = normalizeHandle(row.raw).length > 0;
              return (
                <div key={row.id} className="space-y-1">
                  <div className="flex gap-2 items-center">
                    {/* No visible names, so the accessible name carries them. */}
                    <div className="flex gap-1 flex-shrink-0" role="group" aria-label={`Platform for entry ${i + 1}`}>
                      {SUPPORTED_PLATFORMS.map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => chooseRowPlatform(row.id, p)}
                          aria-pressed={row.platform === p}
                          aria-label={p}
                          title={p}
                          className={`flex items-center justify-center h-9 w-9 rounded-lg border transition-colors ${
                            row.platform === p
                              ? "border-indigo-400/40 bg-indigo-400/10"
                              : "border-border hover:border-border/80 hover:bg-secondary/60"
                          }`}
                        >
                          <PlatformMark platform={p} className="w-4 h-4" muted={row.platform !== p} />
                        </button>
                      ))}
                    </div>
                    <Input
                      ref={(el) => { inputs.current.set(row.id, el); }}
                      value={row.raw}
                      onChange={(e) => setRowInput(row.id, e.target.value)}
                      onPaste={(e) => {
                        /**
                         * Read the clipboard HERE, before the browser touches it.
                         * A single-line <input> strips the newlines out of pasted
                         * text on its way to onChange, so a pasted column arrives
                         * as one run-together string and `splitEntries` has
                         * nothing left to split on. `clipboardData` still has the
                         * original, so a column becomes rows — which is the whole
                         * reason bulk entry is usable.
                         */
                        const text = e.clipboardData.getData("text");
                        if (splitEntries(text).length > 1) {
                          e.preventDefault();
                          setRowInput(row.id, text);
                        }
                      }}
                      onKeyDown={(e) => {
                        // Enter commits this line and moves to the next, which is
                        // the gesture bulk entry is built on: paste, Enter, paste,
                        // Enter. The button is what submits — with twenty rows on
                        // screen, Enter firing the whole batch from inside one of
                        // them would be a trapdoor.
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (filled) focusRowAfter(row.id);
                        }
                      }}
                      placeholder={i === 0 ? "@username or a profile link" : "another handle or link"}
                      spellCheck={false}
                      autoComplete="off"
                      aria-label={`Handle or profile link, entry ${i + 1}`}
                      className="flex-1 min-w-0 bg-secondary border-border placeholder:text-muted-foreground/40 font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void pasteIntoRow(row.id)}
                      title="Paste from clipboard"
                      className="flex-shrink-0 px-3"
                    >
                      <ClipboardPaste className="w-4 h-4" />
                    </Button>
                    {/* Removable only when it holds something — the trailing
                        blank is scaffolding and has nothing to remove. */}
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => removeRow(row.id)}
                      title="Remove this entry"
                      aria-label={`Remove entry ${i + 1}`}
                      disabled={!filled}
                      className={`flex-shrink-0 px-2 text-muted-foreground/50 hover:text-destructive ${
                        filled ? "" : "invisible"
                      }`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Button
          onClick={() => void queueAll(false)}
          disabled={!canSubmit}
          className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-semibold transition-colors"
        >
          {submit.isPending
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Queueing…</>
            : <>
                <Sparkles className="w-4 h-4 mr-2" />
                {/* The count is the confirmation that the list is what you think
                    it is — at twenty rows, "Queue analysis" tells you nothing. */}
                {entries.length > 1 ? `Queue ${entries.length} analyses` : "Queue analysis"}
              </>}
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
            {/* whitespace-pre-line: with two platform groups this carries two
                gate messages, and they must not run together as one paragraph. */}
            <AlertDialogDescription className="whitespace-pre-line">
              {duplicateWarning}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/*
              Re-queues only what is LEFT. Any group that already succeeded had
              its rows removed, so `entries` now holds exactly the entries the
              gate stopped — confirming cannot re-enqueue what already went.
            */}
            <AlertDialogAction onClick={() => void queueAll(true)}>
              Queue anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
