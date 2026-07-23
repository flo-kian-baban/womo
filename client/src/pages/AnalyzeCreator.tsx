import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Users, Loader2, Sparkles, CheckCircle2, ArrowRight, AlertTriangle, Clock, Clock3 } from "lucide-react";
import { ReviewGatePanel, ReviewStatusBadge } from "@/components/ReviewGate";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import CreatorProfileCard from "@/components/CreatorProfileCard";
import { Link } from "wouter";


const schema = z.object({
  handleOrUrl: z.string().min(1, "Enter a handle or URL"),
  platform: z.enum(["TikTok", "Instagram"]),
});

type FormValues = z.infer<typeof schema>;

// ─── Platform Icons (inline SVG) ──────────────────────────────────────────────

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.98a8.18 8.18 0 0 0 3.76.92V6.69" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  );
}

/** Detect platform from URL/handle input */
function detectPlatform(input: string): "TikTok" | "Instagram" | null {
  const lower = input.toLowerCase().trim();
  if (lower.includes("tiktok.com")) return "TikTok";
  if (lower.includes("instagram.com")) return "Instagram";
  return null;
}

const ANALYSIS_STEPS = [
  "Fetching 6 most recent videos for baseline analysis...",
  "Sampling 3 mid-period videos (~9 months ago)...",
  "Retrieving 3 anchor posts (~18 months ago) for longitudinal baseline...",
  "Transcribing spoken content across 12-video sample...",
  "Identifying recurring themes and tone register...",
  "Applying Jungian archetype classification...",
  "Evaluating Goffman stage consistency across time periods...",
  "Assessing Stuart Hall decoding patterns...",
  "Mapping Rogers adoption curve position...",
  "Detecting Turner liminal phase signals...",
  "Calculating cultural velocity (Focusing vs. Drifting)...",
  "Generating Barthes myth sentence...",
  "Assembling deep cultural alignment profile...",
];

type PreflightExisting = {
  subjectId: string;
  handle: string | null;
  displayName: string | null;
  lastAnalyzedAt: string | Date | null;
  reviewStatus: string | null;
  pendingObservation: { id: string; observedAt: string | Date } | null;
};

export default function AnalyzeCreator() {
  const [result, setResult] = useState<{ profile: Record<string, any> & { id: string }; pipelineMetrics?: any } | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [duplicateWarning, setDuplicateWarning] = useState<{ existing: PreflightExisting; values: FormValues } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const utils = trpc.useUtils();

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { platform: "TikTok" },
  });

  const platform = watch("platform");
  const handleOrUrl = watch("handleOrUrl");

  // Auto-detect platform from URL as user types
  useEffect(() => {
    if (!handleOrUrl) return;
    const detected = detectPlatform(handleOrUrl);
    if (detected && detected !== platform) {
      setValue("platform", detected);
    }
  }, [handleOrUrl, platform, setValue]);

  // Clear interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const analyzeMutation = trpc.creator.analyze.useMutation({
    onSuccess: (data) => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // Persistence outcome is reported explicitly by the API — never show
      // plain success (or silently show nothing) when the save failed.
      if (data.persistence.saved === "none") {
        toast.error(`Analysis completed but could NOT be saved: ${data.persistence.error ?? "database error"}`);
        return;
      }
      if (data.profile) {
        setResult({ profile: data.profile, pipelineMetrics: data.pipelineMetrics });
        if (data.persistence.saved === "partial") {
          toast.warning(`Profile saved with incomplete data — failed: ${data.persistence.failedComponents.join(", ")}`);
        } else {
          toast.success("Cultural profile extracted successfully");
        }
      }
    },
    onError: () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // Error is shown inline — no toast needed
    },
  });

  const startAnalysis = (values: FormValues, confirmDuplicate = false) => {
    setResult(null);
    setStepIndex(0);
    // Clear any previous interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    // Cycle through steps for UX
    intervalRef.current = setInterval(() => {
      setStepIndex((prev) => {
        if (prev >= ANALYSIS_STEPS.length - 1) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return prev;
        }
        return prev + 1;
      });
    }, 1800);
    analyzeMutation.mutate({ ...values, confirmDuplicate });
  };

  // Duplicate pre-flight (Session 7): check for an existing subject BEFORE any
  // scraping starts; a match requires explicit confirmation to proceed.
  const onSubmit = async (values: FormValues) => {
    setDuplicateWarning(null);
    try {
      const pre = await utils.creator.preflight.fetch({
        handleOrUrl: values.handleOrUrl,
        platform: values.platform,
      });
      if (pre.existing) {
        setDuplicateWarning({ existing: pre.existing, values });
        return;
      }
    } catch {
      // Pre-flight unavailable — the server-side gate on analyze still holds;
      // proceed and let it reject if a duplicate exists.
    }
    startAnalysis(values);
  };

  return (
    <div className="min-h-full px-6 py-8 lg:px-10 lg:py-10">
      {/* Duplicate pre-flight confirmation (Session 7) — blocks BEFORE scraping */}
      <AlertDialog open={!!duplicateWarning} onOpenChange={(open) => { if (!open) setDuplicateWarning(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This creator already has a profile</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-medium text-foreground">
                    {duplicateWarning?.existing.displayName ?? duplicateWarning?.existing.handle ?? "Existing profile"}
                  </span>
                  {duplicateWarning?.existing.handle && (
                    <span className="text-muted-foreground"> · @{duplicateWarning.existing.handle}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-muted-foreground">
                    Last analyzed: {duplicateWarning?.existing.lastAnalyzedAt
                      ? new Date(duplicateWarning.existing.lastAnalyzedAt).toLocaleDateString()
                      : "unknown"}
                  </span>
                  <ReviewStatusBadge status={duplicateWarning?.existing.reviewStatus} />
                  {duplicateWarning?.existing.reviewStatus === "accepted" && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded border border-green-400/40 bg-green-400/10 text-green-400 text-[10px] font-semibold uppercase tracking-wider">Accepted</span>
                  )}
                </div>
                {duplicateWarning?.existing.pendingObservation && (
                  <div className="text-amber-300 text-xs">
                    A pending analysis run from {new Date(duplicateWarning.existing.pendingObservation.observedAt).toLocaleDateString()} is already awaiting review.
                  </div>
                )}
                <div className="text-muted-foreground">
                  Running a new analysis creates a new pending run for this same profile — it does not create a duplicate.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDuplicateWarning(null)}>Cancel</AlertDialogCancel>
            {duplicateWarning && (
              <Link href={`/creator/${duplicateWarning.existing.subjectId}`}>
                <Button variant="outline">Open existing profile</Button>
              </Link>
            )}
            <AlertDialogAction
              onClick={() => {
                if (duplicateWarning) {
                  const { values } = duplicateWarning;
                  setDuplicateWarning(null);
                  startAnalysis(values, true);
                }
              }}
            >
              Re-analyze anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Header */}
      <div className="mb-8 animate-fade-in-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-400/10 border border-blue-400/20 flex items-center justify-center">
            <Users className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-serif">Analyze Creator</h1>
            <p className="text-sm text-muted-foreground">Extract a complete F.I.T. cultural profile</p>
          </div>
        </div>
        <p className="text-muted-foreground text-sm max-w-xl leading-relaxed">
          Enter a TikTok or Instagram handle and our AI will research the creator's real public content — including
          video titles, hashtags, stats, and bio — to extract their Jungian archetype, Barthes myth, Goffman stage
          consistency, Stuart Hall decoding classification, and full niche positioning.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-8">
        {/* ─── Input Form ──────────────────────────────────────────────────── */}
        <div>
          <form onSubmit={handleSubmit(onSubmit)} className="fit-card rounded-xl p-6 space-y-5">
            <div className="space-y-2">
              <Label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                Platform
              </Label>
              <Select
                value={platform}
                onValueChange={(v) => setValue("platform", v as FormValues["platform"])}
              >
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      {platform === "TikTok" ? (
                        <TikTokIcon className="w-4 h-4" />
                      ) : (
                        <InstagramIcon className="w-4 h-4" />
                      )}
                      {platform}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TikTok">
                    <span className="flex items-center gap-2">
                      <TikTokIcon className="w-4 h-4" />
                      TikTok
                    </span>
                  </SelectItem>
                  <SelectItem value="Instagram">
                    <span className="flex items-center gap-2">
                      <InstagramIcon className="w-4 h-4" />
                      Instagram
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                Handle or Profile URL
              </Label>
              <Input
                {...register("handleOrUrl")}
                placeholder={
                  platform === "TikTok" ? "@username or tiktok.com/@username" :
                  "@username or instagram.com/username"
                }
                className="bg-secondary border-border placeholder:text-muted-foreground/40"
              />
              {errors.handleOrUrl && (
                <p className="text-xs text-destructive">{errors.handleOrUrl.message}</p>
              )}
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
                  Extract Cultural Profile
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
                  Analyzing 12-video longitudinal sample and brand semantic core. Processing time: ~45–60s.
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

          {/* Inline error card */}
          {analyzeMutation.isError && !analyzeMutation.isPending && (() => {
            const msg = analyzeMutation.error?.message ?? "";
            const isRateLimit = msg.toLowerCase().includes("rate-limited") || msg.toLowerCase().includes("usage exhausted") || msg.toLowerCase().includes("too many requests");
            return (
              <div className={`mt-4 rounded-xl p-5 border animate-fade-in-up ${
                isRateLimit
                  ? "bg-amber-500/10 border-amber-500/30"
                  : "bg-destructive/10 border-destructive/30"
              }`}>
                <div className="flex items-start gap-3">
                  {isRateLimit
                    ? <Clock className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    : <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />}
                  <div>
                    <p className={`text-sm font-semibold mb-1 ${
                      isRateLimit ? "text-amber-400" : "text-destructive"
                    }`}>
                      {isRateLimit ? "API Rate Limit — Please Retry" : "Analysis Failed"}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {isRateLimit
                        ? "The data API is temporarily rate-limited from recent activity. Wait 1–2 minutes, then click \"Extract Cultural Profile\" again."
                        : msg}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Quick action after result */}
          {result && (
            <div className="mt-4 fit-card rounded-xl p-5 animate-fade-in-up">
              <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-3">
                Next Step
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Profile saved to library. Ready to run a Cultural Match Score?
              </p>
              <Link href="/fit-score">
                <Button size="sm" variant="outline" className="w-full border-primary/30 text-primary hover:bg-primary/10">
                  Run Cultural Match Score <ArrowRight className="w-3 h-3 ml-2" />
                </Button>
              </Link>
            </div>
          )}
        </div>

        {/* ─── Result ──────────────────────────────────────────────────────── */}
        <div>
          {result ? (
            <div className="space-y-4 animate-fade-in-up">
              <div className="fit-card rounded-xl p-6">
                <div className="flex items-center gap-2 mb-6 pb-4 border-b border-border">
                  {result.profile.reviewStatus === "pending" ? (
                    <>
                      <Clock3 className="w-4 h-4 text-amber-300" />
                      <span className="text-sm font-semibold text-amber-300">Profile Extracted — Awaiting Analyst Review</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                      <span className="text-sm font-semibold text-green-400">Profile Extracted & Saved</span>
                    </>
                  )}
                </div>
                <CreatorProfileCard profile={result.profile} pipelineMetrics={result.pipelineMetrics} />
              </div>
              {/* Review gate: diagnostics + accept/decline for the fresh run */}
              {result.profile.observationId && (
                <ReviewGatePanel
                  observationId={result.profile.observationId}
                  reviewStatus={result.profile.reviewStatus}
                />
              )}
            </div>
          ) : !analyzeMutation.isPending ? (
            <div className="fit-card rounded-xl p-10 flex flex-col items-center justify-center text-center h-full min-h-64">
              <Users className="w-10 h-10 text-muted-foreground/20 mb-4" />
              <p className="text-muted-foreground text-sm">
                Enter a handle to extract a cultural profile
              </p>
              <p className="text-xs text-muted-foreground/50 mt-2 max-w-xs">
                The AI will analyze the creator's content, audience, and cultural positioning using the F.I.T. framework
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
