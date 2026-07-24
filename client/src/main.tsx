import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  // Don't redirect if already on login page
  if (window.location.pathname === "/login") return;

  window.location.href = "/login";
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

// A split deployment (frontend on Vercel/Netlify, backend on Railway) needs
// VITE_API_URL pointing at the backend. A same-origin deployment (Railway
// serving both) needs nothing — the window.location.origin fallback is correct.
const apiBase = import.meta.env.VITE_API_URL || window.location.origin;
const trpcUrl = `${apiBase}/api/trpc`;

// Session 10 (3c): warn only on a REAL misconfiguration. The old check fired
// whenever VITE_API_URL was unset in production — including on the Railway
// same-origin deployment where the fallback is correct (a false alarm). Warn
// only when the app is served from a frontend-only host that has no backend at
// its own origin.
const FRONTEND_ONLY_HOST = /(?:^|\.)(?:vercel\.app|netlify\.app|pages\.dev|github\.io)$/i;
if (
  import.meta.env.PROD &&
  !import.meta.env.VITE_API_URL &&
  typeof window !== "undefined" &&
  FRONTEND_ONLY_HOST.test(window.location.hostname)
) {
  console.warn(
    "[trpc] VITE_API_URL is not set but the app is served from a frontend-only host — " +
    "API calls will hit this origin, which has no /api/trpc route. " +
    "Set VITE_API_URL to your backend URL."
  );
}

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: trpcUrl,
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
