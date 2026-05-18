import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Users, Loader2, Sparkles, CheckCircle2, ArrowRight, AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import CreatorProfileCard from "@/components/CreatorProfileCard";
import { Link } from "wouter";
import type { CreatorProfile } from "../../../drizzle/schema";

const schema = z.object({
  handleOrUrl: z.string().min(1, "Enter a handle or URL"),
  platform: z.enum(["TikTok", "YouTube", "Multi"]),
});

type FormValues = z.infer<typeof schema>;

const ANALYSIS_STEPS = [
  "Scanning public profile and content history...",
  "Identifying recurring themes and tone register...",
  "Applying Jungian archetype classification...",
  "Evaluating Goffman stage consistency...",
  "Assessing Stuart Hall decoding patterns...",
  "Mapping Rogers adoption curve position...",
  "Detecting Turner liminal phase signals...",
  "Generating Barthes myth sentence...",
  "Assembling cultural alignment profile...",
];

export default function AnalyzeInfluencer() {
  const [result, setResult] = useState<{ profile: CreatorProfile } | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { platform: "TikTok" },
  });

  const platform = watch("platform");

  const analyzeMutation = trpc.creator.analyze.useMutation({
    onSuccess: (data) => {
      if (data.profile) {
        setResult({ profile: data.profile });
        toast.success("Cultural profile extracted successfully");
      }
    },
    onError: () => {
      // Error is shown inline — no toast needed
    },
  });

  const onSubmit = (values: FormValues) => {
    setResult(null);
    setStepIndex(0);
    // Cycle through steps for UX
    const interval = setInterval(() => {
      setStepIndex((prev) => {
        if (prev >= ANALYSIS_STEPS.length - 1) { clearInterval(interval); return prev; }
        return prev + 1;
      });
    }, 1800);
    analyzeMutation.mutate(values);
  };

  return (
    <div className="min-h-full px-6 py-8 lg:px-10 lg:py-10">
      {/* Header */}
      <div className="mb-8 animate-fade-in-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-400/10 border border-blue-400/20 flex items-center justify-center">
            <Users className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-serif">Analyze Influencer</h1>
            <p className="text-sm text-muted-foreground">Extract a complete F.I.T. cultural profile</p>
          </div>
        </div>
        <p className="text-muted-foreground text-sm max-w-xl leading-relaxed">
          Enter a TikTok or YouTube handle and our AI will research the creator's real public content — including
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
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TikTok">TikTok</SelectItem>
                  <SelectItem value="YouTube">YouTube</SelectItem>
                  <SelectItem value="Multi">Multi-Platform (TikTok + YouTube)</SelectItem>
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
                  platform === "YouTube" ? "@username or youtube.com/@username" :
                  "@username (will search TikTok + YouTube)"
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
              <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-3">
                AI Analysis in Progress
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
                Profile saved to library. Ready to run a F.I.T. Score?
              </p>
              <Link href="/fit-score">
                <Button size="sm" variant="outline" className="w-full border-primary/30 text-primary hover:bg-primary/10">
                  Run F.I.T. Score <ArrowRight className="w-3 h-3 ml-2" />
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
              <CreatorProfileCard profile={result.profile} />
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
