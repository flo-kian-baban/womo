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

// In production (Vercel), set VITE_API_URL to the Railway backend URL,
// e.g. https://your-backend.up.railway.app
// In development, requests go to the same origin (localhost).
const apiBase = import.meta.env.VITE_API_URL || window.location.origin;
const trpcUrl = `${apiBase}/api/trpc`;

// Warn in production if VITE_API_URL is not set.
// Without it, all tRPC calls target the Vercel origin which has no /api/trpc
// route — every API call will fail silently with a 404.
if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
  console.warn(
    "[trpc] VITE_API_URL is not set in production. " +
    "All API calls will go to the Vercel origin and fail. " +
    "Set VITE_API_URL to your Railway backend URL in Vercel project settings " +
    "(e.g. https://your-app.up.railway.app)."
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
