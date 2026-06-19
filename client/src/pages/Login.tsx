import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Zap, Lock, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function Login() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [, setLocation] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        // Optimistically update the auth cache so AuthGate sees authenticated=true immediately
        utils.auth.check.setData(undefined, { authenticated: true });
        setLocation("/");
      } else {
        setError(data.error ?? "Invalid PIN");
        setPin("");
        inputRef.current?.focus();
      }
    },
    onError: (err) => {
      setError(err.message);
      setPin("");
      inputRef.current?.focus();
    },
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (!pin.trim()) return;
    setError("");
    loginMutation.mutate({ pin });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 4);
    setPin(value);
    setError("");

    // Auto-submit when 4 digits entered
    if (value.length === 4) {
      setError("");
      loginMutation.mutate({ pin: value });
    }
  };

  const isLoading = loginMutation.isPending;

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        background: "radial-gradient(ellipse at 50% 0%, #111827 0%, #030712 60%)",
      }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
            style={{
              background: "linear-gradient(135deg, #6366F1 0%, #38BDF8 100%)",
              boxShadow: "0 8px 32px rgba(99, 102, 241, 0.3), 0 4px 16px rgba(56, 189, 248, 0.2)",
            }}
          >
            <Zap className="w-7 h-7 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-2xl font-black tracking-tight gold-text">Connex</h1>
          <p className="text-[11px] font-bold tracking-[0.2em] uppercase mt-1.5 text-[#4b5563]">
            F.I.T. Engine
          </p>
        </div>

        {/* PIN Card */}
        <div
          className="rounded-2xl p-8"
          style={{
            background: "rgba(15, 23, 42, 0.6)",
            border: "1px solid rgba(30, 41, 59, 0.7)",
            backdropFilter: "blur(24px)",
          }}
        >
          <div className="flex items-center gap-2.5 mb-6">
            <Lock className="w-4 h-4 text-[#6b7280]" />
            <span className="text-sm font-semibold text-[#9ca3af]">
              Enter access PIN
            </span>
          </div>

          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder="• • • •"
            autoComplete="off"
            className="w-full text-center text-3xl font-mono tracking-[0.5em] py-4 px-4 rounded-xl bg-[#0a0e1a] border border-[#1e293b] text-white placeholder-[#374151] focus:outline-none focus:border-[#6366F1] focus:ring-1 focus:ring-[#6366F1]/30 transition-all disabled:opacity-50"
          />

          {/* Error */}
          {error && (
            <p className="mt-4 text-sm text-red-400 text-center font-medium animate-in fade-in slide-in-from-top-1 duration-200">
              {error}
            </p>
          )}

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={isLoading || pin.length === 0}
            className="w-full mt-6 py-3.5 rounded-xl text-sm font-bold text-white transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: pin.length > 0 && !isLoading
                ? "linear-gradient(135deg, #6366F1 0%, #38BDF8 100%)"
                : "rgba(30, 41, 59, 0.5)",
              boxShadow: pin.length > 0 && !isLoading
                ? "0 4px 14px rgba(99, 102, 241, 0.25), 0 2px 8px rgba(56, 189, 248, 0.15)"
                : "none",
            }}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying…
              </span>
            ) : (
              "Enter"
            )}
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-[#374151] mt-6">
          Internal pilot access only
        </p>
      </div>
    </div>
  );
}
