import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Building2, Loader2, Sparkles, CheckCircle2, ArrowRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import BrandProfileCard from "@/components/BrandProfileCard";
import { ApiStatusPanel } from "@/components/ApiStatusPanel";
import { Link } from "wouter";
import type { BrandProfile } from "../../../drizzle/schema";

const schema = z.object({
  brandNameOrUrl: z.string().min(1, "Enter a brand name or URL"),
  tiktokChannelUrl: z.string().optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

const ANALYSIS_STEPS = [
  "Initiating recursive semantic crawl of brand website...",
  "Following internal links: About, Story, Mission, Values pages...",
  "Targeting 2,000+ words of semantic content...",
  "Ingesting top 50 Google Maps reviews for perceived identity...",
  "Analyzing visual identity and tone...",
  "Identifying Jungian archetype...",
  "Extracting emotional promise and audience tribe...",
  "Mapping cultural tension and symbolic position...",
  "Generating Barthes myth sentence...",
  "Classifying brand type for weight selection...",
  "Loading α/β/γ weight configuration...",
  "Assembling brand semantic core...",
  "Fetching TikTok channel data (if provided)...",
  "Analyzing TikTok content and engagement patterns...",
  "Extracting brand voice and social themes...",
  "Integrating social signals into cultural profile...",
];

export default function AnalyzeBrand() {
  const [result, setResult] = useState<{ profile: BrandProfile } | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);

  const { data: apiStatus } = trpc.system.apiStatus.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const analyzeMutation = trpc.brand.analyze.useMutation({
    onSuccess: (data) => {
      if (data.profile) {
        setResult({ profile: data.profile });
        toast.success("Brand profile extracted successfully");
      }
    },
    onError: (err) => {
      toast.error(`Analysis failed: ${err.message}`);
    },
  });

  const runAnalysis = (values: FormValues) => {
    setResult(null);
    setStepIndex(0);
    const interval = setInterval(() => {
      setStepIndex((prev) => {
        if (prev >= ANALYSIS_STEPS.length - 1) { clearInterval(interval); return prev; }
        return prev + 1;
      });
    }, 1800);
    analyzeMutation.mutate(values);
  };

  const onSubmit = (values: FormValues) => {
    // If any research source is down, show a confirmation warning first
    const downSources = apiStatus?.sources.filter(s => s.status === "down") ?? [];
    if (downSources.length > 0) {
      setPendingValues(values);
      return;
    }
    runAnalysis(values);
  };

  return (
    <div className="min-h-full px-6 py-8 lg:px-10 lg:py-10">
      {/* Header */}
      <div className="mb-8 animate-fade-in-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-green-400/10 border border-green-400/20 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <h1 className="text-2xl font-serif">Analyze Brand</h1>
            <p className="text-sm text-muted-foreground">Extract a complete F.I.T. brand profile</p>
          </div>
        </div>
        <p className="text-muted-foreground text-sm max-w-xl leading-relaxed">
          Enter a brand name or website URL and our AI will research its public presence to extract
          its archetype, emotional promise, audience tribe, cultural tension, Barthes myth, and
          automatically load the correct α/β/γ weight configuration from the brand type table.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-8">
        {/* ─── Input Form ──────────────────────────────────────────────────── */}
        <div>
          <ApiStatusPanel />
          <form onSubmit={handleSubmit(onSubmit)} className="fit-card rounded-xl p-6 space-y-5">
            <div className="space-y-2">
              <Label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                Brand Name or Website URL
              </Label>
              <Input
                {...register("brandNameOrUrl")}
                placeholder="e.g. Glossier, Lululemon, or https://brand.com"
                className="bg-secondary border-border placeholder:text-muted-foreground/40"
              />
              {errors.brandNameOrUrl && (
                <p className="text-xs text-destructive">{errors.brandNameOrUrl.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                TikTok Handle (Optional)
              </Label>
              <Input
                {...register("tiktokChannelUrl")}
                placeholder="e.g. @nike or nike"
                className="bg-secondary border-border placeholder:text-muted-foreground/40"
              />
              <p className="text-xs text-muted-foreground/70">
                Leave blank if the brand does not have a TikTok presence
              </p>
            </div>

            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <strong className="text-primary/80">Note:</strong> The AI will automatically classify the brand type
                and load the correct scoring weights (α/β/γ) from the 45+ category weight table.
              </p>
            </div>

            <Button
              type="submit"
              disabled={analyzeMutation.isPending}
              className="w-full gold-gradient text-background font-semibold hover:opacity-90 transition-opacity"
            >
              {analyzeMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Extract Brand Profile
                </>
              )}
            </Button>
          </form>

          {/* Analysis progress */}
          {analyzeMutation.isPending && (
            <div className="mt-4 fit-card rounded-xl p-5 animate-fade-in-up">
              <div className="mb-3">
                <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
                  Deep Anthropological Analysis in Progress
                </div>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Analyzing brand semantic core across website and reviews. Processing time: ~45–60s.
                </p>
              </div>
              <div className="space-y-2">
                {ANALYSIS_STEPS.map((step, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 text-xs transition-all duration-300 ${
                      i < stepIndex
                        ? "text-green-400"
                        : i === stepIndex
                        ? "text-foreground"
                        : "text-muted-foreground/30"
                    }`}
                  >
                    {i < stepIndex ? (
                      <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                    ) : i === stepIndex ? (
                      <Loader2 className="w-3 h-3 flex-shrink-0 animate-spin" />
                    ) : (
                      <div className="w-3 h-3 rounded-full border border-current flex-shrink-0 opacity-30" />
                    )}
                    {step}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result && (
            <div className="mt-4 fit-card rounded-xl p-5 animate-fade-in-up">
              <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-3">
                Next Step
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Profile saved to library. Ready to run a Cultural Alignment Index (CAI)?
              </p>
              <Link href="/fit-score">
                <Button size="sm" variant="outline" className="w-full border-primary/30 text-primary hover:bg-primary/10">
                  Run Cultural Alignment Index (CAI) <ArrowRight className="w-3 h-3 ml-2" />
                </Button>
              </Link>
            </div>
          )}
        </div>

        {/* ─── Result ──────────────────────────────────────────────────────── */}
        <div>
          {result ? (
            <div className="fit-card rounded-xl p-6 animate-fade-in-up">
              <div className="flex items-center gap-2 mb-6 pb-4 border-b border-border">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                <span className="text-sm font-semibold text-green-400">Profile Extracted & Saved</span>
              </div>
              <BrandProfileCard profile={result.profile} />
            </div>
          ) : !analyzeMutation.isPending ? (
            <div className="fit-card rounded-xl p-10 flex flex-col items-center justify-center text-center h-full min-h-64">
              <Building2 className="w-10 h-10 text-muted-foreground/20 mb-4" />
              <p className="text-muted-foreground text-sm">
                Enter a brand name to extract a cultural profile
              </p>
              <p className="text-xs text-muted-foreground/50 mt-2 max-w-xs">
                The AI will research the brand's symbolic position, audience tribe, and automatically
                configure the correct scoring weights
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* ─── Partial-Run Warning Dialog ────────────────────────────────────── */}
      <AlertDialog open={!!pendingValues} onOpenChange={(open) => { if (!open) setPendingValues(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              Some research sources are offline
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  The following sources are currently unavailable and will be skipped during this analysis:
                </p>
                <ul className="space-y-1">
                  {(apiStatus?.sources ?? []).filter(s => s.status === "down").map(s => (
                    <li key={s.name} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 w-2 h-2 rounded-full bg-red-400 shrink-0" />
                      <span>
                        <strong>{s.name}</strong> — {s.message}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground text-sm">
                  The analysis will still run using available sources, but the brand profile may be less detailed — particularly the Audience Perception and Brand Symbol Decoder sections.
                </p>
                <p className="text-muted-foreground text-sm">
                  You can wait until the sources recover and try again, or proceed now with a partial run.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingValues(null)}>
              Wait — try later
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingValues) runAnalysis(pendingValues);
                setPendingValues(null);
              }}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              Proceed with partial run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
