import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

/**
 * Builds a minimal tRPC context matching the CURRENT context shape
 * ({ req, res, authenticated }). `auth.logout` is a public procedure, so the
 * `authenticated` value is irrelevant to its behavior — we only need `res` to
 * capture the clearCookie call.
 */
function createContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];

  const ctx: TrpcContext = {
    authenticated: true,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  it("clears the pilot session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    // Asserts the REAL current behavior of the logout handler.
    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    // Live cookie is the pilot PIN cookie, not the legacy manus session cookie.
    expect(clearedCookies[0]?.name).toBe("womo_pilot_auth");
    // Options the handler actually passes (must match clearCookie in routers.ts).
    expect(clearedCookies[0]?.options).toMatchObject({
      path: "/",
      sameSite: "none",
      secure: true,
    });
  });
});
