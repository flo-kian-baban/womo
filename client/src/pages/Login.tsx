import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Shield, Loader2, ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function Login() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [, setLocation] = useLocation();
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const utils = trpc.useUtils();

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        utils.auth.check.setData(undefined, { authenticated: true });
        setLocation("/");
      } else {
        setError(data.error ?? "Invalid PIN");
        setPin("");
        inputRefs.current[0]?.focus();
      }
    },
    onError: () => {
      setError("Unable to connect. Try again.");
      setPin("");
      inputRefs.current[0]?.focus();
    },
  });

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleDigitChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;

    const newPin = pin.split("");
    newPin[index] = value;
    const joined = newPin.join("").slice(0, 4);
    setPin(joined);
    setError("");

    // Move to next input
    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit on 4th digit
    if (joined.length === 4 && index === 3) {
      loginMutation.mutate({ pin: joined });
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      const newPin = pin.split("");
      newPin[index - 1] = "";
      setPin(newPin.join(""));
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === "Enter" && pin.length === 4) {
      loginMutation.mutate({ pin });
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (pasted.length > 0) {
      setPin(pasted);
      const lastIndex = Math.min(pasted.length - 1, 3);
      inputRefs.current[lastIndex]?.focus();
      if (pasted.length === 4) {
        loginMutation.mutate({ pin: pasted });
      }
    }
  };

  const isLoading = loginMutation.isPending;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(99,102,241,0.12) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 100%, rgba(56,189,248,0.06) 0%, transparent 50%), #030712",
        }}
      />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      <div className="w-full max-w-[360px] relative z-10">
        {/* Logo + Branding */}
        <div className="flex flex-col items-center mb-12">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 relative"
            style={{
              background: "linear-gradient(135deg, #6366F1 0%, #818cf8 50%, #38BDF8 100%)",
              boxShadow: "0 12px 40px rgba(99, 102, 241, 0.35), 0 4px 16px rgba(56, 189, 248, 0.2)",
            }}
          >
            <Shield className="w-8 h-8 text-white" strokeWidth={2} />
            {/* Pulse ring */}
            <div
              className="absolute inset-0 rounded-2xl animate-ping"
              style={{
                background: "linear-gradient(135deg, #6366F1, #38BDF8)",
                opacity: 0.15,
                animationDuration: "3s",
              }}
            />
          </div>
          <h1 className="text-3xl font-black tracking-tight gold-text">Womo</h1>
          <p className="text-xs font-semibold tracking-[0.25em] uppercase mt-2 text-[#475569]">
            Cultural Intelligence
          </p>
        </div>

        {/* PIN Card */}
        <div
          className="rounded-3xl p-8 relative"
          style={{
            background: "linear-gradient(145deg, rgba(15,23,42,0.8) 0%, rgba(10,15,30,0.9) 100%)",
            border: "1px solid rgba(99, 102, 241, 0.12)",
            backdropFilter: "blur(40px)",
            boxShadow: "0 24px 80px rgba(0,0,0,0.4), 0 0 1px rgba(99,102,241,0.2) inset",
          }}
        >
          {/* Header */}
          <div className="text-center mb-8">
            <h2 className="text-lg font-bold text-white mb-1">Welcome back</h2>
            <p className="text-sm text-[#64748b]">Enter your 4-digit access code</p>
          </div>

          {/* PIN Input Boxes */}
          <div className="flex justify-center gap-3 mb-6" onPaste={handlePaste}>
            {[0, 1, 2, 3].map((i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="password"
                inputMode="numeric"
                maxLength={1}
                value={pin[i] ?? ""}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                disabled={isLoading}
                autoComplete="off"
                className="w-14 h-16 text-center text-2xl font-bold rounded-xl
                  bg-[#0a0e1a] border-2 text-white
                  focus:outline-none transition-all duration-200
                  disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  borderColor: pin[i]
                    ? "rgba(99, 102, 241, 0.6)"
                    : error
                      ? "rgba(239, 68, 68, 0.4)"
                      : "rgba(30, 41, 59, 0.8)",
                  boxShadow: pin[i]
                    ? "0 0 20px rgba(99, 102, 241, 0.15), 0 0 4px rgba(99, 102, 241, 0.1) inset"
                    : "none",
                }}
              />
            ))}
          </div>

          {/* Error */}
          {error && (
            <div
              className="mb-5 py-2.5 px-4 rounded-xl text-center"
              style={{
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.15)",
              }}
            >
              <p className="text-sm text-red-400 font-medium">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={() => pin.length === 4 && loginMutation.mutate({ pin })}
            disabled={isLoading || pin.length < 4}
            className="w-full py-4 rounded-xl text-sm font-bold text-white
              transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed
              active:scale-[0.98] cursor-pointer group"
            style={{
              background: pin.length === 4 && !isLoading
                ? "linear-gradient(135deg, #6366F1 0%, #4F46E5 50%, #6366F1 100%)"
                : "rgba(30, 41, 59, 0.4)",
              boxShadow: pin.length === 4 && !isLoading
                ? "0 8px 32px rgba(99, 102, 241, 0.3), 0 2px 8px rgba(99, 102, 241, 0.2)"
                : "none",
              backgroundSize: "200% 100%",
            }}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2.5">
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying…
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                Continue
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            )}
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-[#334155] mt-8 font-medium tracking-wide">
          Internal pilot access only · Womo v1.0
        </p>
      </div>
    </div>
  );
}
