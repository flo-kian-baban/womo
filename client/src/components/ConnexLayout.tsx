import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Zap, Users, Building2, BarChart3, BookOpen, ChevronRight,
  Menu, X, Sparkles, LogOut
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/_core/hooks/useAuth";

const NAV_ITEMS = [
  {
    label: "Dashboard",
    href: "/",
    icon: Sparkles,
  },
  {
    label: "Analyze Creator",
    href: "/analyze/creator",
    icon: Users,
  },
  {
    label: "Analyze Brand",
    href: "/analyze/brand",
    icon: Building2,
  },
  {
    label: "Cultural Match Score",
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
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { logout } = useAuth();

  return (
    <div className="min-h-screen bg-background flex">
      {/* ─── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 flex flex-col transition-transform duration-300 ease-out",
          "bg-[#0a0e1a] border-r border-[#1a1f35]",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-6 border-b border-[#1a1f35]">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #6366F1 0%, #38BDF8 100%)" }}
          >
            <Zap className="w-4.5 h-4.5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-lg font-black tracking-tight leading-none gold-text">Connex</div>
            <div className="text-[10px] font-bold tracking-[0.15em] uppercase mt-1 text-[#4b5563]">
              F.I.T. Engine
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
          <div className="px-3 py-2 mb-2">
            <span className="text-[10px] font-black tracking-[0.2em] uppercase text-[#4b5563]">
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
                    "flex items-center gap-3 px-4 py-3 rounded-2xl cursor-pointer transition-all duration-300",
                    "text-sm font-semibold group",
                    isActive
                      ? "text-white"
                      : "text-[#6b7280] hover:text-[#d1d5db] hover:bg-[#111827]"
                  )}
                  style={isActive ? {
                    background: "linear-gradient(135deg, #6366F1 0%, #38BDF8 100%)",
                    boxShadow: "0 4px 14px rgba(99, 102, 241, 0.25), 0 2px 8px rgba(56, 189, 248, 0.15)",
                  } : undefined}
                  onClick={() => setMobileOpen(false)}
                >
                  <Icon
                    className={cn(
                      "w-[1.375rem] h-[1.375rem] flex-shrink-0 transition-colors",
                      isActive ? "text-white" : "text-[#6b7280] group-hover:text-[#d1d5db]"
                    )}
                  />
                  <span className="flex-1">{item.label}</span>
                  {isActive && (
                    <ChevronRight className="w-3.5 h-3.5 text-white/60" />
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#1a1f35]">
          <button
            onClick={async () => {
              await logout();
              setLocation("/login");
            }}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-[#6b7280] hover:text-red-400 hover:bg-red-400/5 transition-all duration-200 text-sm font-medium"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign out</span>
          </button>
          <div className="text-[10px] text-[#4b5563] leading-relaxed mt-3">
            <div className="font-black text-[#6b7280] mb-1 tracking-wide uppercase">Connex F.I.T. Engine v2.0</div>
            Powered by Jungian Archetypes,<br />
            Bourdieusian Symbolic Capital &<br />
            Stuart Hall Decoding Theory
          </div>
        </div>
      </aside>

      {/* ─── Mobile overlay ───────────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ─── Main content ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:pl-72">
        {/* Mobile header */}
        <header
          className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-[#1a1f35] sticky top-0 z-30"
          style={{
            background: "rgba(3, 7, 18, 0.85)",
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
          }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #6366F1 0%, #38BDF8 100%)" }}
            >
              <Zap className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-base font-black gold-text">Connex</span>
          </div>
          <button
            className="p-2 rounded-xl hover:bg-[#111827] transition-colors text-[#6b7280] hover:text-white"
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
