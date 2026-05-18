import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Building2, Loader2, Sparkles, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import BrandProfileCard from "@/components/BrandProfileCard";
import { Link } from "wouter";
import type { BrandProfile } from "../../../drizzle/schema";

const schema = z.object({
  brandNameOrUrl: z.string().min(1, "Enter a brand name or URL"),
});

type FormValues = z.infer<typeof schema>;

const ANALYSIS_STEPS = [
  "Researching brand's public presence and history...",
  "Analyzing visual identity and tone...",
  "Identifying Jungian archetype...",
  "Extracting emotional promise and audience tribe...",
  "Mapping cultural tension and symbolic position...",
  "Generating Barthes myth sentence...",
  "Classifying brand type for weight selection...",
  "Loading α/β/γ weight configuration...",
  "Assembling brand cultural profile...",
];

export default function AnalyzeBrand() {
  const [result, setResult] = useState<{ profile: BrandProfile } | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

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

  const onSubmit = (values: FormValues) => {
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
    </div>
  );
}
