import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
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

function Router() {
  return (
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
                background: "oklch(0.14 0.010 260)",
                border: "1px solid oklch(0.22 0.010 260)",
                color: "oklch(0.93 0.012 60)",
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
