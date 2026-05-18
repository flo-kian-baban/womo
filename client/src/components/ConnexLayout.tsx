import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Zap, Users, Building2, BarChart3, BookOpen, ChevronRight,
  Menu, X, Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    label: "Dashboard",
    href: "/",
    icon: Sparkles,
  },
  {
    label: "Analyze Influencer",
    href: "/analyze/influencer",
    icon: Users,
  },
  {
    label: "Analyze Brand",
    href: "/analyze/brand",
    icon: Building2,
  },
  {
    label: "F.I.T. Score",
    href: "/fit-score",
    icon: BarChart3,
  },
  {
    label: "Profile Library",
    href: "/library",
    icon: BookOpen,
  },
];

interface ConnexLayoutProps {
  children: React.ReactNode;
}

export default function ConnexLayout({ children }: ConnexLayoutProps) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background flex">
      {/* ─── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 flex flex-col transition-transform duration-300 ease-out",
          "bg-card border-r border-border",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-6 border-b border-border">
          <div className="w-8 h-8 rounded-lg gold-gradient flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-background" strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-serif text-lg leading-none gold-text">Connex</div>
            <div className="text-[10px] text-muted-foreground tracking-[0.15em] uppercase mt-0.5">
              F.I.T. Engine
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <div className="px-3 py-2 mb-2">
            <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              Analysis
            </span>
          </div>
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150",
                    "text-sm font-medium group",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}
                  onClick={() => setMobileOpen(false)}
                >
                  <Icon
                    className={cn(
                      "w-4 h-4 flex-shrink-0 transition-colors",
                      isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                    )}
                  />
                  <span className="flex-1">{item.label}</span>
                  {isActive && (
                    <ChevronRight className="w-3 h-3 text-primary/60" />
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border">
          <div className="text-[10px] text-muted-foreground/60 leading-relaxed">
            <div className="font-semibold text-muted-foreground/80 mb-1">Connex F.I.T. Engine v2.0</div>
            Powered by Jungian Archetypes,<br />
            Bourdieusian Symbolic Capital &<br />
            Stuart Hall Decoding Theory
          </div>
        </div>
      </aside>

      {/* ─── Mobile overlay ───────────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ─── Main content ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:pl-64">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md gold-gradient flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-background" strokeWidth={2.5} />
            </div>
            <span className="font-serif text-base gold-text">Connex F.I.T.</span>
          </div>
          <button
            className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
