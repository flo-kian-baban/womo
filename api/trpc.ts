import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parse as parseCookieHeader, serialize as serializeCookie } from "cookie";

/**
 * Lightweight Vercel API handler for auth routes only.
 * Does NOT import the full server/routers (which depends on Playwright).
 * Handles: auth.check, auth.login, auth.logout
 * All other tRPC routes return a "use local server" error.
 */

const PIN_CODE = process.env.PIN_CODE ?? "1234";
const COOKIE_NAME = "womo_pilot_auth";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

function getAuth(req: VercelRequest): boolean {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return false;
  const cookies = parseCookieHeader(cookieHeader);
  return cookies[COOKIE_NAME] === "authenticated";
}

function jsonResult(res: VercelResponse, data: unknown) {
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({ result: { data: { json: data } } });
}

function jsonError(res: VercelResponse, message: string, code = 500) {
  res.setHeader("Content-Type", "application/json");
  return res.status(code).json({
    error: {
      json: {
        message,
        code: -32603,
        data: { code: "INTERNAL_SERVER_ERROR", httpStatus: code },
      },
    },
  });
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Parse the tRPC procedure from the URL
  const url = req.url ?? "";
  const path = url.replace(/^\/api\/trpc\/?/, "").split("?")[0];

  // Handle batch requests (tRPC sends ?batch=1&input=...)
  const isBatch = url.includes("batch=1");

  // ─── GET: auth.check ─────────────────────────────────────────────────────
  if (req.method === "GET" && (path === "auth.check" || (isBatch && url.includes("auth.check")))) {
    const authenticated = getAuth(req);
    const result = { result: { data: { json: { authenticated } } } };

    if (isBatch) {
      return res.status(200).json([result]);
    }
    return res.status(200).json(result);
  }

  // ─── POST: auth.login ────────────────────────────────────────────────────
  if (req.method === "POST" && (path === "auth.login" || (isBatch && url.includes("auth.login")))) {
    try {
      // tRPC sends: { "0": { "json": { "pin": "1234" } } } for batch
      // or { "json": { "pin": "1234" } } for single
      const body = req.body;
      const input = isBatch ? body?.["0"]?.json : body?.json;
      const pin = input?.pin;

      if (!pin || pin !== PIN_CODE) {
        const errorResult = { result: { data: { json: { success: false, error: "Invalid PIN" } } } };
        if (isBatch) return res.status(200).json([errorResult]);
        return res.status(200).json(errorResult);
      }

      // Set auth cookie
      res.setHeader(
        "Set-Cookie",
        serializeCookie(COOKIE_NAME, "authenticated", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: COOKIE_MAX_AGE,
          path: "/",
        })
      );

      const successResult = { result: { data: { json: { success: true } } } };
      if (isBatch) return res.status(200).json([successResult]);
      return res.status(200).json(successResult);
    } catch {
      return jsonError(res, "Invalid request");
    }
  }

  // ─── POST: auth.logout ───────────────────────────────────────────────────
  if (req.method === "POST" && (path === "auth.logout" || (isBatch && url.includes("auth.logout")))) {
    res.setHeader(
      "Set-Cookie",
      serializeCookie(COOKIE_NAME, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 0,
        path: "/",
      })
    );

    const result = { result: { data: { json: { success: true } } } };
    if (isBatch) return res.status(200).json([result]);
    return res.status(200).json(result);
  }

  // ─── All other routes: not available on Vercel ───────────────────────────
  return jsonError(
    res,
    "This API route is only available on the local development server.",
    501
  );
}
