import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

export const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

// Internal local-only app: the PIN gate is gone. protectedProcedure is kept as
// an alias for one commit (Phase A neutralization) so the 25 call sites don't
// churn; Phase B renames them to publicProcedure and deletes this.
export const protectedProcedure = t.procedure;
