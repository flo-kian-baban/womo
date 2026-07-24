/**
 * Session 10 (Commit 2) — TikTok duration unit normalization.
 * video.duration arrives in SECONDS on the web item_list; it was consumed as
 * milliseconds and divided by 1000, zeroing every sub-1000s video.
 */
import { describe, it, expect } from "vitest";
import { tiktokDurationToMs } from "./webResearch";

describe("tiktokDurationToMs", () => {
  it("treats small values as SECONDS and converts to ms", () => {
    expect(tiktokDurationToMs(15)).toBe(15000);   // 15s clip → 15000ms (was 0 after /1000)
    expect(tiktokDurationToMs(45)).toBe(45000);
    expect(tiktokDurationToMs(600)).toBe(600000); // 10-min max
  });

  it("treats large values as already-milliseconds (robust to the other unit)", () => {
    expect(tiktokDurationToMs(30000)).toBe(30000); // 30s in ms → unchanged
    expect(tiktokDurationToMs(15000)).toBe(15000);
  });

  it("maps absent/zero/negative to 0", () => {
    expect(tiktokDurationToMs(0)).toBe(0);
    expect(tiktokDurationToMs(NaN)).toBe(0);
    expect(tiktokDurationToMs(-5)).toBe(0);
  });

  it("downstream round(ms/1000) now yields correct seconds", () => {
    // The pool/engagement code divides the normalized ms by 1000.
    expect(Math.round(tiktokDurationToMs(45) / 1000)).toBe(45);   // was 0 pre-fix
    expect(Math.round(tiktokDurationToMs(30000) / 1000)).toBe(30);
  });
});
