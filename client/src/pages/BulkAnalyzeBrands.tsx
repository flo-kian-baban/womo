import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function BulkAnalyzeBrands() {
  const [, navigate] = useLocation();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <Card className="p-8 max-w-md w-full space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-green-400/10 border border-green-400/20 flex items-center justify-center mx-auto">
          <span className="text-2xl">🏢</span>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Bulk Brand Analysis</h2>
          <p className="text-sm text-muted-foreground">
            Analyze multiple brands at once by providing a list of names, URLs, and optional TikTok handles.
            This feature is coming soon.
          </p>
        </div>
        <Button variant="outline" className="w-full" onClick={() => navigate("/analyze-brand")}>
          Analyze a Single Brand Instead
        </Button>
      </Card>
    </div>
  );
}
