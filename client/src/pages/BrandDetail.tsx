import { useState } from "react";
import { useParams } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import BrandProfileCard from "@/components/BrandProfileCard";
import { Button } from "@/components/ui/button";

export default function BrandDetail() {
  const { id } = useParams<{ id: string }>();
  const brandId = parseInt(id ?? "0", 10);
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

      {data && (
        <BrandProfileCard profile={data} onReanalyze={handleReanalyze} isReanalyzing={isReanalyzing} />
      )}
    </div>
  );
}
