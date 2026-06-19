import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function (_req: VercelRequest, res: VercelResponse) {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
}
