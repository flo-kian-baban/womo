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
import { Building2, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { ApiStatusPanel } from "@/components/ApiStatusPanel";
import { CampaignQueue, pollIntervalFor } from "@/components/CampaignQueue";
import { isBrandCampaign, type Campaign } from "@/lib/campaignState";

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
    {
      // Paced by whether anything is actually moving — see pollIntervalFor.
      refetchInterval: (q) => pollIntervalFor(q.state.data?.campaigns),
      refetchOnWindowFocus: true,
    },
  );

  const submit = trpc.brand.submit.useMutation({
    onSuccess: (data) => {
      reset();
      toast.success(`Queued ${data.campaigns[0]?.handle ?? "brand"}`);
      void utils.creator.queueStatus.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  /** Brand campaigns are the ones this page submitted; creators have their own. */
  const campaigns: Campaign[] = (queue.data?.campaigns ?? []).filter(isBrandCampaign);

  return (
    /* Form and queue share one width — see AnalyzeCreator. */
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-6">
      <div className="max-w-3xl">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] uppercase text-muted-foreground">
          <Building2 className="w-3.5 h-3.5" /> Analyze brands
        </div>
        <p className="text-sm text-muted-foreground/70 mt-2">
          Queue a brand and it runs in the background — you can close this page, and a
          restart resumes anything still in flight. Committed profiles land in the
          Profile Library; what stays here is live work and anything needing your attention.
        </p>
      </div>

      <form
        onSubmit={handleSubmit(values => submit.mutate(values))}
        className="data-card rounded-xl p-5 space-y-4"
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
          className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-semibold transition-colors"
        >
          {submit.isPending
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Queueing…</>
            : <><Sparkles className="w-4 h-4 mr-2" /> Queue analysis</>}
        </Button>
      </form>

      <CampaignQueue
        campaigns={campaigns}
        isLoading={queue.isLoading}
        emptyLabel="No brand analyses yet."
      />


      <ApiStatusPanel />
    </div>
  );
}
