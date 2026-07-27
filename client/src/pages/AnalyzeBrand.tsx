/**
 * SUBMIT AND WATCH. There is one way in — the queue.
 *
 * The brand twin of AnalyzeCreator, and deliberately the same page: a brand is a
 * different KIND of subject, but it runs on the same ledger, so it is watched
 * the same way. Nothing here blocks on a result — submission returns a run id
 * and everything after is the ledger's account of what happened, polled.
 *
 * ─── What was removed, and why it had to be ─────────────────────────────────
 * This page used to run `brand.analyze`, which did the entire orchestration
 * inside one HTTP request, and it filled the wait with an eighteen-step
 * animation on a `setInterval` — "Targeting 2,000+ words of semantic content…",
 * "Generating Barthes myth sentence…" — advancing on a timer with no connection
 * to what the server was doing. It narrated a crawl that had already failed and
 * announced Instagram analysis for brands with no Instagram handle. Honest
 * names, invented positions.
 *
 * Every mark on this page now comes from `analysis_phase_state`. A brand run
 * that parks says parked; one that fails says which phase. If a value is not
 * knowable it is not shown.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Building2, Loader2, Sparkles, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { ApiStatusPanel } from "@/components/ApiStatusPanel";
import { CampaignCard, type Campaign } from "@/components/CampaignCard";

/** In flight = the queue still owes you something. */
const ACTIVE_STATES = new Set(["queued", "running", "parked"]);

/** Brand campaigns are the ones this page submitted; creators have their own. */
const isBrand = (c: Campaign) => c.platform.trim().toLowerCase() === "brand";

const validateTikTokHandle = (value: string | undefined): true | string => {
  if (!value || value.trim() === "") return true; // Optional field

  const trimmed = value.trim();

  // Check for hashtag
  if (trimmed.startsWith("#")) {
    return "TikTok handle cannot start with #. Enter just the username (e.g., 'nike' not '#nike')";
  }

  // Check for discover/tag URLs
  if (trimmed.includes("discover/") || trimmed.includes("/tag/")) {
    return "This is a hashtag/discover page, not a brand channel. Enter the brand's TikTok handle instead (e.g., '@nike' or 'nike')";
  }

  // Check for full TikTok URLs
  if (trimmed.includes("tiktok.com")) {
    const match = trimmed.match(/@([a-zA-Z0-9._-]+)/);
    if (match) {
      return `Enter just the handle '@${match[1]}' instead of the full URL`;
    }
    return "Enter just the TikTok handle (e.g., '@nike'), not the full URL";
  }

  return true;
};

const validateInstagramHandle = (value: string | undefined): true | string => {
  if (!value || value.trim() === "") return true; // Optional field

  const trimmed = value.trim();

  if (trimmed.startsWith("#")) {
    return "Instagram handle cannot start with #. Enter just the username (e.g., 'glossier' not '#glossier')";
  }

  // Check for full Instagram URLs — nudge to enter handle only
  if (trimmed.includes("instagram.com")) {
    const match = trimmed.match(/instagram\.com\/([a-zA-Z0-9._]+)/);
    if (match) {
      return `Enter just the handle '@${match[1]}' instead of the full URL`;
    }
    return "Enter just the Instagram handle (e.g., '@glossier'), not the full URL";
  }

  // Strip @ for validation only
  const bare = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;

  // Instagram handles: 1-30 chars, alphanumeric + dots + underscores
  if (bare.length > 30) {
    return "Instagram handle must be 30 characters or fewer";
  }
  if (!/^[a-zA-Z0-9._]+$/.test(bare)) {
    return "Instagram handle can only contain letters, numbers, periods, and underscores";
  }

  return true;
};

const schema = z.object({
  brandNameOrUrl: z.string().min(1, "Enter a brand name or URL"),
  googleMapsUrl: z.string().optional().or(z.literal("")),
  tiktokChannelUrl: z.string().optional().or(z.literal("")).superRefine((val, ctx) => {
    const result = validateTikTokHandle(val);
    if (result !== true) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result });
    }
  }),
  instagramHandle: z.string().optional().or(z.literal("")).superRefine((val, ctx) => {
    const result = validateInstagramHandle(val);
    if (result !== true) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result });
    }
  }),
});

type FormValues = z.infer<typeof schema>;

export default function AnalyzeBrand() {
  const utils = trpc.useUtils();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { brandNameOrUrl: "", googleMapsUrl: "", tiktokChannelUrl: "", instagramHandle: "" },
  });

  /**
   * The queue view. Polls the LEDGER, so there is no local progress state that
   * can drift from reality. `includeTerminal` is what makes completed and
   * failed campaigns visible at all — the in-flight query excludes both.
   */
  const queue = trpc.creator.queueStatus.useQuery(
    { includeTerminal: true, limit: 50 },
    { refetchInterval: 3000, refetchOnWindowFocus: true },
  );

  const submit = trpc.brand.submit.useMutation({
    onSuccess: (data) => {
      reset();
      toast.success(`Queued ${data.campaigns[0]?.handle ?? "brand"}`);
      void utils.creator.queueStatus.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const campaigns: Campaign[] = (queue.data?.campaigns ?? []).filter(isBrand);
  const active = campaigns.filter(c => ACTIVE_STATES.has(c.state));
  const settled = campaigns.filter(c => !ACTIVE_STATES.has(c.state));
  const failed = settled.filter(c => c.state === "failed");

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] uppercase text-muted-foreground">
          <Building2 className="w-3.5 h-3.5" /> Analyze brands
        </div>
        <p className="text-sm text-muted-foreground/70 mt-2">
          Queue a brand and it runs in the background — you can close this page, and a
          restart resumes anything still in flight.
        </p>
      </div>

      <form
        onSubmit={handleSubmit(values => submit.mutate(values))}
        className="fit-card rounded-xl p-5 space-y-4"
      >
        <div className="space-y-2">
          <Label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            Brand name or URL
          </Label>
          <Input
            {...register("brandNameOrUrl")}
            placeholder="e.g. Glossier, Lululemon, or https://brand.com"
            spellCheck={false}
            autoComplete="off"
            className="bg-secondary border-border placeholder:text-muted-foreground/40"
          />
          {/*
            A URL is not cosmetic: capture crawls one and cannot crawl a bare
            name, so the fallbacks carry the whole analysis instead.
          */}
          <p className="text-xs text-muted-foreground/50">
            A URL is crawled directly. A name falls back to search, which yields thinner evidence.
          </p>
          {errors.brandNameOrUrl && (
            <p className="text-xs text-destructive">{errors.brandNameOrUrl.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            Google Maps URL <span className="text-muted-foreground/40 normal-case">— optional</span>
          </Label>
          <Input
            {...register("googleMapsUrl")}
            placeholder="https://maps.google.com/maps/place/..."
            spellCheck={false}
            autoComplete="off"
            className="bg-secondary border-border placeholder:text-muted-foreground/40"
          />
          {errors.googleMapsUrl && (
            <p className="text-xs text-destructive">{errors.googleMapsUrl.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            TikTok handle <span className="text-muted-foreground/40 normal-case">— optional</span>
          </Label>
          <Input
            {...register("tiktokChannelUrl")}
            placeholder="e.g. @nike or nike"
            spellCheck={false}
            autoComplete="off"
            className="bg-secondary border-border placeholder:text-muted-foreground/40"
          />
          {errors.tiktokChannelUrl && (
            <p className="text-xs text-destructive">{errors.tiktokChannelUrl.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            Instagram handle <span className="text-muted-foreground/40 normal-case">— optional</span>
          </Label>
          <Input
            {...register("instagramHandle")}
            placeholder="e.g. @glossier or glossier"
            spellCheck={false}
            autoComplete="off"
            className="bg-secondary border-border placeholder:text-muted-foreground/40"
          />
          {errors.instagramHandle && (
            <p className="text-xs text-destructive">{errors.instagramHandle.message}</p>
          )}
        </div>

        <Button
          type="submit"
          disabled={submit.isPending}
          className="w-full gold-gradient text-background font-semibold hover:opacity-90 transition-opacity"
        >
          {submit.isPending
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Queueing…</>
            : <><Sparkles className="w-4 h-4 mr-2" /> Queue analysis</>}
        </Button>
      </form>

      {/* ─── In flight ─────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold tracking-[0.12em] uppercase text-muted-foreground">
            In flight
          </div>
          <div className="text-xs text-muted-foreground/60">
            {queue.isLoading
              ? "loading…"
              : active.length > 0
                ? `${active.length} running or queued`
                : "nothing running"}
          </div>
        </div>

        {active.length > 0
          ? active.map(c => <CampaignCard key={c.runId} campaign={c} />)
          : (
            <div className="fit-card rounded-xl p-8 text-center">
              <Inbox className="w-5 h-5 mx-auto text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground/60 mt-2">
                {queue.isLoading ? "Loading the queue…" : "No brand analyses in flight."}
              </p>
              {!queue.isLoading && settled.length > 0 && (
                <p className="text-xs text-muted-foreground/40 mt-1">
                  {settled.length} finished {settled.length === 1 ? "campaign" : "campaigns"} below.
                </p>
              )}
            </div>
          )}
      </section>

      {/* ─── Finished ──────────────────────────────────────────────────────── */}
      {settled.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              Finished
            </div>
            <div className="text-xs text-muted-foreground/60">
              {settled.length - failed.length} complete
              {failed.length > 0 && <span className="text-destructive/80"> · {failed.length} failed</span>}
            </div>
          </div>
          {settled.map(c => <CampaignCard key={c.runId} campaign={c} />)}
        </section>
      )}

      <ApiStatusPanel />
    </div>
  );
}
