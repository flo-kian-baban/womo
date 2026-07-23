/**
 * Auth hardening regression tests (Session 1) — no DB.
 *
 * Locks in the PIN → HMAC-cookie auth so it can't silently regress to the old
 * forgeable literal-"authenticated" scheme:
 *   - createContext validates the HMAC-signed `womo_pilot_auth` cookie
 *   - protectedProcedure rejects unauthenticated callers
 *   - login sets the cookie with hardened flags; logout clears it; check reflects state
 *
 * JWT_SECRET / PIN_CODE come from vitest.config.ts test.env.
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { createContext } from "./_core/context";
import type { TrpcContext } from "./_core/context";
import { protectedProcedure, router } from "./_core/trpc";
import { appRouter } from "./routers";

const SECRET = process.env.JWT_SECRET!;
const PIN = process.env.PIN_CODE!;
// The one valid cookie value the server will accept for this JWT_SECRET.
const validCookie = createHmac("sha256", SECRET).update("womo_pilot_auth").digest("hex");

function mockReq(cookie?: string): TrpcContext["req"] {
  return {
    headers: cookie ? { cookie } : {},
    ip: "10.0.0.1",
    socket: { remoteAddress: "10.0.0.1" },
    protocol: "https",
  } as unknown as TrpcContext["req"];
}
const noRes = {} as TrpcContext["res"];

// ─── createContext: HMAC cookie validation ────────────────────────────────────
describe("createContext HMAC cookie validation", () => {
  it("authenticated=true for a valid HMAC cookie", async () => {
    const ctx = await createContext({ req: mockReq(`womo_pilot_auth=${validCookie}`), res: noRes } as never);
    expect(ctx.authenticated).toBe(true);
  });
  it("false when no cookie is present", async () => {
    const ctx = await createContext({ req: mockReq(), res: noRes } as never);
    expect(ctx.authenticated).toBe(false);
  });
  it("false for the OLD forgeable literal value 'authenticated'", async () => {
    const ctx = await createContext({ req: mockReq("womo_pilot_auth=authenticated"), res: noRes } as never);
    expect(ctx.authenticated).toBe(false);
  });
  it("false for a tampered cookie (one hex char flipped)", async () => {
    const last = validCookie.slice(-1);
    const tampered = validCookie.slice(0, -1) + (last === "a" ? "b" : "a");
    const ctx = await createContext({ req: mockReq(`womo_pilot_auth=${tampered}`), res: noRes } as never);
    expect(ctx.authenticated).toBe(false);
  });
});

// ─── protectedProcedure gate ─────────────────────────────────────────────────
describe("protectedProcedure gate", () => {
  const testRouter = router({ ping: protectedProcedure.query(() => "pong") });
  it("rejects with UNAUTHORIZED when ctx.authenticated is false", async () => {
    const caller = testRouter.createCaller({ req: mockReq(), res: noRes, authenticated: false });
    await expect(caller.ping()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("allows the call when ctx.authenticated is true", async () => {
    const caller = testRouter.createCaller({ req: mockReq(), res: noRes, authenticated: true });
    await expect(caller.ping()).resolves.toBe("pong");
  });
});

// ─── login / logout / check ──────────────────────────────────────────────────
describe("auth.login / auth.logout / auth.check", () => {
  function ctxWithSpies(authenticated = false) {
    const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
    const cleared: Array<{ name: string; options: Record<string, unknown> }> = [];
    const res = {
      cookie: (name: string, value: string, options: Record<string, unknown>) => cookies.push({ name, value, options }),
      clearCookie: (name: string, options: Record<string, unknown>) => cleared.push({ name, options }),
    } as unknown as TrpcContext["res"];
    const ctx: TrpcContext = { req: mockReq(), res, authenticated };
    return { ctx, cookies, cleared };
  }

  it("login with the correct PIN sets the HMAC cookie with hardened flags", async () => {
    const { ctx, cookies } = ctxWithSpies();
    const r = await appRouter.createCaller(ctx).auth.login({ pin: PIN });
    expect(r).toEqual({ success: true });
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe("womo_pilot_auth");
    expect(cookies[0].value).toBe(validCookie); // HMAC-signed, never the literal "authenticated"
    expect(cookies[0].value).not.toBe("authenticated");
    expect(cookies[0].options).toMatchObject({ httpOnly: true, path: "/", sameSite: "none", secure: true });
    expect(cookies[0].options.maxAge as number).toBeGreaterThan(0);
  });

  it("login with a wrong PIN fails and sets no cookie", async () => {
    const { ctx, cookies } = ctxWithSpies();
    const r = await appRouter.createCaller(ctx).auth.login({ pin: "definitely-wrong" });
    expect(r).toMatchObject({ success: false });
    expect(cookies).toHaveLength(0);
  });

  it("logout clears the pilot cookie with matching flags", async () => {
    const { ctx, cleared } = ctxWithSpies(true);
    const r = await appRouter.createCaller(ctx).auth.logout();
    expect(r).toEqual({ success: true });
    expect(cleared).toHaveLength(1);
    expect(cleared[0].name).toBe("womo_pilot_auth");
    expect(cleared[0].options).toMatchObject({ path: "/", sameSite: "none", secure: true });
  });

  it("check reflects ctx.authenticated", async () => {
    const authed = await appRouter.createCaller({ req: mockReq(), res: noRes, authenticated: true }).auth.check();
    const anon = await appRouter.createCaller({ req: mockReq(), res: noRes, authenticated: false }).auth.check();
    expect(authed).toEqual({ authenticated: true });
    expect(anon).toEqual({ authenticated: false });
  });
});
