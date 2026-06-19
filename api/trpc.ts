import "dotenv/config";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { appRouter } from "../server/routers";
import { createContext } from "../server/_core/context";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

const trpcHandler = createExpressMiddleware({
  router: appRouter,
  createContext,
});

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Strip /api/trpc prefix so tRPC sees the procedure path
  req.url = req.url?.replace(/^\/api\/trpc\/?/, "/") ?? req.url;
  return trpcHandler(req as any, res as any);
}
