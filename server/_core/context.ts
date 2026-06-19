import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";

const PILOT_COOKIE_NAME = "womo_pilot_auth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  /** True when the pilot PIN cookie is present and valid */
  authenticated: boolean;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const cookieHeader = opts.req.headers.cookie;
  let authenticated = false;

  if (cookieHeader) {
    const cookies = parseCookieHeader(cookieHeader);
    authenticated = cookies[PILOT_COOKIE_NAME] === "authenticated";
  }

  return {
    req: opts.req,
    res: opts.res,
    authenticated,
  };
}
