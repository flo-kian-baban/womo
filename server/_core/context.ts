import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";
import { createHmac } from "crypto";
import { ENV } from "./env";

const PILOT_COOKIE_NAME = "womo_pilot_auth";

/**
 * Returns the expected HMAC-SHA256 cookie value for the current JWT_SECRET.
 * This value is set at login and must match on every authenticated request.
 * An attacker who doesn't know JWT_SECRET cannot compute this value.
 */
function expectedCookieValue(): string {
  return createHmac("sha256", ENV.cookieSecret)
    .update("womo_pilot_auth")
    .digest("hex");
}

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  /** True when the pilot PIN cookie is present and cryptographically valid */
  authenticated: boolean;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const cookieHeader = opts.req.headers.cookie;
  let authenticated = false;

  if (cookieHeader) {
    const cookies = parseCookieHeader(cookieHeader);
    const cookieValue = cookies[PILOT_COOKIE_NAME];
    // Compare against the HMAC-signed expected value.
    // A plain "authenticated" string (or any other forged value) will not match.
    if (cookieValue && ENV.cookieSecret) {
      authenticated = cookieValue === expectedCookieValue();
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    authenticated,
  };
}
