import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

export const trpc = createTRPCReact<AppRouter>();

/**
 * Server response types, INFERRED. Hand-redeclaring a router's output shape
 * client-side reliably drifts: the queue view's local `CampaignStatus` had
 * already lost `observationId`, so a field the server was sending could not be
 * read. Infer instead, and a server-side shape change becomes a type error
 * rather than a silently missing field.
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
