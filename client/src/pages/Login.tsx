import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { ShieldCheck, KeyRound, Eye, EyeOff, Loader2, ArrowRight, AlertCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export default function Login() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [, setLocation] = useLocation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const utils = trpc.useUtils();

  const failFeedback = (message: string) => {
    setError(message);
    setPin("");
    setShake(true);
    // Return focus so the operator can immediately retry.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        // Preserve the existing auth flow exactly: prime the cached session
        // and redirect home. AuthGate reads auth.check from this cache.
        utils.auth.check.setData(undefined, { authenticated: true });
        setLocation("/");
      } else {
        failFeedback(data.error ?? "Invalid access code");
      }
    },
    onError: (err) => {
      // The login procedure is rate-limited (5 attempts / 15 min per IP).
      if (err.data?.code === "TOO_MANY_REQUESTS") {
        failFeedback("Too many attempts — wait 15 minutes.");
      } else {
        failFeedback("Unable to connect. Try again.");
      }
    },
  });

  const isLoading = loginMutation.isPending;
  const canSubmit = !isLoading && pin.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    loginMutation.mutate({ pin });
  };

  return (
    // NOTE: index.css sets a global `.flex { min-height: 0 }` (unlayered CSS that
    // overrides the `min-h-[100dvh]` utility), so the full viewport height is
    // applied inline to keep the card vertically centered.
    <div
      className="flex items-center justify-center px-4 relative overflow-hidden"
      style={{ minHeight: "100dvh" }}
    >
      {/* Scoped animations — entrance + error shake, both gated behind
          prefers-reduced-motion so reduced-motion users get a static, legible UI. */}
      <style>{`
        .womo-card { opacity: 1; }
        @media (prefers-reduced-motion: no-preference) {
          @keyframes womo-rise {
            from { opacity: 0; transform: translateY(16px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes womo-shake {
            10%, 90% { transform: translateX(-1px); }
            20%, 80% { transform: translateX(2px); }
            30%, 50%, 70% { transform: translateX(-5px); }
            40%, 60% { transform: translateX(5px); }
          }
          .womo-card  { animation: womo-rise 0.5s cubic-bezier(0.23, 1, 0.32, 1) both; }
          .womo-shake { animation: womo-shake 0.42s cubic-bezier(0.36, 0.07, 0.19, 0.97) both; }
        }
      `}</style>

      {/* Background — brand radial wash on near-black (static). */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(99,102,241,0.14) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 100%, rgba(56,189,248,0.07) 0%, transparent 50%), #030712",
        }}
      />
      {/* Subtle static grid. */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      <div className="womo-card w-full max-w-[380px] relative z-10">
        {/* Brand */}
        <div className="flex flex-col items-center mb-10">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 connex-glow"
            style={{ background: "linear-gradient(135deg, #6366F1 0%, #818cf8 50%, #38BDF8 100%)" }}
          >
            <ShieldCheck className="w-8 h-8 text-white" strokeWidth={2} />
          </div>
          <h1 className="text-3xl font-black tracking-tight gold-text">WOMO</h1>
          <p className="text-[11px] font-semibold tracking-[0.25em] uppercase mt-2 text-[#475569]">
            Cultural Intelligence
          </p>
        </div>

        {/* Access card */}
        <div
          className="rounded-3xl p-8 relative"
          style={{
            background: "linear-gradient(145deg, rgba(15,23,42,0.8) 0%, rgba(10,15,30,0.9) 100%)",
            border: "1px solid rgba(99, 102, 241, 0.12)",
            backdropFilter: "blur(40px)",
            WebkitBackdropFilter: "blur(40px)",
            boxShadow: "0 24px 80px rgba(0,0,0,0.4), 0 0 1px rgba(99,102,241,0.2) inset",
          }}
        >
          <div className="text-center mb-7">
            <h2 className="text-lg font-bold text-white mb-1">Welcome back</h2>
            <p className="text-sm text-[#64748b]">Enter your access code to continue</p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label
              htmlFor="access-code"
              className="block text-[11px] font-bold tracking-[0.18em] uppercase text-[#64748b] mb-2.5"
            >
              Access code
            </label>

            {/* Length-agnostic, alphanumeric password field. No per-digit boxes,
                no maxLength, no numeric filter. */}
            <div
              onAnimationEnd={() => setShake(false)}
              className={cn(
                "relative flex items-center rounded-xl bg-[#0a0e1a] transition-all duration-200 border",
                error ? "border-destructive/50" : "border-[#1e293b]",
                "focus-within:border-primary/70 focus-within:shadow-[0_0_0_4px_rgba(99,102,241,0.10),0_0_28px_rgba(99,102,241,0.14)]",
                shake && "womo-shake",
              )}
            >
              <KeyRound className="ml-4 w-[18px] h-[18px] text-[#475569] flex-shrink-0" strokeWidth={2} />
              <input
                ref={inputRef}
                id="access-code"
                name="pin"
                type={reveal ? "text" : "password"}
                autoComplete="current-password"
                autoFocus
                spellCheck={false}
                aria-invalid={!!error}
                aria-describedby={error ? "access-error" : undefined}
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  if (error) setError("");
                }}
                placeholder="Enter access code"
                disabled={isLoading}
                className="flex-1 min-w-0 bg-transparent px-3 py-4 text-base text-white tracking-wide placeholder:text-[#475569] focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? "Hide access code" : "Show access code"}
                aria-pressed={reveal}
                className="mr-2.5 p-1.5 rounded-lg text-[#475569] hover:text-[#94a3b8] transition-colors focus:outline-none focus-visible:text-[#94a3b8]"
              >
                {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Error */}
            {error && (
              <div
                id="access-error"
                role="alert"
                className="mt-4 flex items-center gap-2 py-2.5 px-3.5 rounded-xl bg-destructive/[0.08] border border-destructive/20"
              >
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" strokeWidth={2} />
                <p className="text-sm text-red-400 font-medium">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-5 w-full flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-bold text-white transition-all duration-200 active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100"
              style={{
                background: canSubmit
                  ? "linear-gradient(135deg, #6366F1 0%, #4F46E5 50%, #38BDF8 100%)"
                  : "rgba(30,41,59,0.4)",
                boxShadow: canSubmit
                  ? "0 8px 32px rgba(99,102,241,0.3), 0 2px 8px rgba(56,189,248,0.15)"
                  : "none",
              }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying…
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-[#334155] mt-8 font-medium tracking-wide">
          Internal pilot access only · WOMO v1.0
        </p>
      </div>
    </div>
  );
}
