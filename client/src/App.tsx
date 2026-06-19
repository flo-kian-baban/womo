import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import ConnexLayout from "./components/ConnexLayout";
import Home from "./pages/Home";
import AnalyzeCreator from "./pages/AnalyzeCreator";
import AnalyzeBrand from "./pages/AnalyzeBrand";
import CAIScore from "./pages/CAIScore";
import Library from "./pages/Library";
import CreatorDetail from "./pages/CreatorDetail";
import BrandDetail from "./pages/BrandDetail";
import MatchReport from "./pages/MatchReport";
import Login from "./pages/Login";
import { useAuth } from "./_core/hooks/useAuth";

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center animate-pulse"
            style={{ background: "linear-gradient(135deg, #6366F1 0%, #38BDF8 100%)" }}
          />
          <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route>
        <AuthGate>
          <ConnexLayout>
            <Switch>
              <Route path="/" component={Home} />
              <Route path="/analyze/creator" component={AnalyzeCreator} />
              <Route path="/analyze/brand" component={AnalyzeBrand} />
              <Route path="/fit-score" component={CAIScore} />
              <Route path="/report/:id" component={MatchReport} />
              <Route path="/library" component={Library} />
              <Route path="/creator/:id" component={CreatorDetail} />
              <Route path="/brand/:id" component={BrandDetail} />
              <Route path="/404" component={NotFound} />
              <Route component={NotFound} />
            </Switch>
          </ConnexLayout>
        </AuthGate>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster
            theme="dark"
            toastOptions={{
              style: {
                background: "#0d1117",
                border: "1px solid #1e293b",
                color: "#f3f4f6",
                borderRadius: "1rem",
              },
            }}
          />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
