/**
 * Session 10 (Commit 1) — shared author guard for creator video pools.
 * Locks the FAIL-CLOSED contract: a video whose author cannot be verified as
 * the target creator is rejected.
 */
import { describe, it, expect } from "vitest";
import { isAuthorMatch, normalizeCreatorHandle } from "@shared/authorMatch";

describe("author guard (isAuthorMatch)", () => {
  it("accepts the creator's own videos", () => {
    expect(isAuthorMatch("kaylee.nhi", "kaylee.nhi")).toBe(true);
  });

  it("accepts handle variants (dots/underscores/hyphens/@/case stripped)", () => {
    expect(isAuthorMatch("kaylee.nhi", "kayleenhi")).toBe(true);      // dots
    expect(isAuthorMatch("malik.the.prince19", "maliktheprince19")).toBe(true);
    expect(isAuthorMatch("@Alk_Vlogs", "alkvlogs")).toBe(true);       // @, underscore, case
    expect(isAuthorMatch("Kaylee.NHI", "kaylee.nhi")).toBe(true);
  });

  it("REJECTS a different creator (the contamination case)", () => {
    // The 95.3M-view "#hooverdam" video (juarezaale) must NOT enter kaylee's pool.
    expect(isAuthorMatch("kaylee.nhi", "juarezaale")).toBe(false);
    expect(isAuthorMatch("anatolypranks91", "juarezaale")).toBe(false);
  });

  it("FAILS CLOSED on a missing/empty author (the old fail-open)", () => {
    // The old guard accepted these via normalizedHandle.includes("") === true.
    expect(isAuthorMatch("kaylee.nhi", "")).toBe(false);
    expect(isAuthorMatch("kaylee.nhi", null)).toBe(false);
    expect(isAuthorMatch("kaylee.nhi", undefined)).toBe(false);
    expect(isAuthorMatch("kaylee.nhi", "   ")).toBe(false);
  });

  it("does NOT accept loose substring matches (the old .includes bug)", () => {
    // "al" is a substring of "alkvlogs" but is a different creator.
    expect(isAuthorMatch("alkvlogs", "al")).toBe(false);
    expect(isAuthorMatch("kaylee.nhi", "kaylee.nhi.official")).toBe(false);
    expect(isAuthorMatch("kay", "kaylee.nhi")).toBe(false);
  });

  it("rejects when the target handle itself is empty", () => {
    expect(isAuthorMatch("", "kaylee.nhi")).toBe(false);
    expect(isAuthorMatch(null, "kaylee.nhi")).toBe(false);
  });

  it("normalizeCreatorHandle strips @, punctuation, whitespace, and lowercases", () => {
    expect(normalizeCreatorHandle("@Kaylee.NHI ")).toBe("kayleenhi");
    expect(normalizeCreatorHandle("malik_the-prince")).toBe("maliktheprince");
    expect(normalizeCreatorHandle(null)).toBe("");
  });
});
