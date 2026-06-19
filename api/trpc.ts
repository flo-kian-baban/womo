import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../../server/routers";
import { createContext } from "../../server/_core/context";
import "dotenv/config";

// Wrap the tRPC Express adapter for Vercel serverless
const handler = createExpressMiddleware({
  router: appRouter,
  createContext,
});

export default function (req: VercelRequest, res: VercelResponse) {
  // Strip the /api/trpc prefix so tRPC sees the procedure path
  req.url = req.url?.replace(/^\/api\/trpc\/?/, "/") ?? req.url;

  return handler(req as any, res as any);
}
