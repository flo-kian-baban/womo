import { useState } from "react";
import { useParams } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import BrandReport from "@/components/BrandReport";
import { Button } from "@/components/ui/button";

export default function BrandDetail() {
  const { id } = useParams<{ id: string }>();
  const brandId = id ?? "";
  const [isReanalyzing, setIsReanalyzing] = useState(false);

  const { data, isLoading, error, refetch } = trpc.brand.get.useQuery(
    { id: brandId },
    { enabled: !!brandId }
  );

  const reanalyzeMutation = trpc.brand.reanalyze.useMutation({
    onSuccess: (result) => {
      setIsReanalyzing(false);
      toast.success("Brand re-analyzed successfully");
      refetch();
    },
    onError: (err) => {
      setIsReanalyzing(false);
      toast.error(`Re-analysis failed: ${err.message}`);
    },
  });

  const handleReanalyze = async () => {
    setIsReanalyzing(true);
    reanalyzeMutation.mutate({ id: brandId });
  };

  return (
    <div className="min-h-full px-6 py-8 lg:px-10 lg:py-10">
      {/* Back nav */}
      <div className="mb-6">
        <Link href="/library">
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground -ml-2">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Library
          </Button>
        </Link>
      </div>

      {isLoading && (
        <div className="text-center py-20 text-muted-foreground text-sm animate-pulse">
          Loading brand profile…
        </div>
      )}

      {error && (
        <div className="text-center py-20 text-destructive text-sm">
          Failed to load brand profile.
        </div>
      )}

      {/*
        NO ReviewGatePanel HERE, deliberately. The creator page mounts it for
        accept/decline, but it embeds RunDiagnosticsView, whose field-presence
        and provenance blocks are resolved from `creator_observations` — empty
        for a brand, so it would report Patagonia's archetype, myth and summary
        as MISSING while all three are populated. A brand's review status and
        the subject-agnostic half of its diagnostics are in §3 of the report;
        an accept/decline control for brands is logged as a gap rather than
        shipped on top of a creator-shaped reader.
      */}
      {data && (
        <BrandReport profile={data} onReanalyze={handleReanalyze} isReanalyzing={isReanalyzing} />
      )}
    </div>
  );
}
