import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function BulkAnalyzeCreators() {
  const [, navigate] = useLocation();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <Card className="p-8 max-w-md w-full space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
          <span className="text-2xl">👥</span>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Bulk Creator Analysis</h2>
          <p className="text-sm text-muted-foreground">
            Analyze multiple creators at once by pasting a list of TikTok handles.
            This feature is coming soon.
          </p>
        </div>
        <Button variant="outline" className="w-full" onClick={() => navigate("/analyze")}>
          Analyze a Single Creator Instead
        </Button>
      </Card>
    </div>
  );
}
