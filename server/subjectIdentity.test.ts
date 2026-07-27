/**
 * SUBJECT IDENTITY MUST NOT SHIFT FOR EXISTING CAMPAIGNS.
 *
 * ─── The regression class ───────────────────────────────────────────────────
 * The evidence harnesses cannot catch this one, because subject identity is not
 * evidence. If `subject_hint` encoded even one byte differently for a
 * single-handle campaign, every row already in the ledger would still parse but
 * every NEW row would key differently — in-flight campaigns would fail to
 * resume, `findIncompleteCampaigns` would group wrongly, and nothing in the
 * pipeline would notice because the analysis itself would still be correct.
 *
 * So the invariant is asserted against literal strings, not against a
 * round-trip: a round-trip through a broken encoder is still self-consistent.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { encodeSubject, decodeSubject } from "./_core/subjectIdentity";

describe("BYTE-IDENTICAL for every subject that has no extras", () => {
  it("TikTok keys exactly as it does today", () => {
    // The literal string the ledger has always held. Not a round-trip.
    expect(encodeSubject({ handle: "misterclimber", platform: "TikTok" }))
      .toBe("misterclimber@TikTok");
  });

  it("Instagram keys exactly as it does today", () => {
    expect(encodeSubject({ handle: "vnillalondon", platform: "Instagram" }))
      .toBe("vnillalondon@Instagram");
  });

  it("an EMPTY extras object is still no extras — a caller passing {} changes nothing", () => {
    // The likeliest accidental regression: a call site that always supplies an
    // extras object would otherwise re-encode every campaign in the system.
    expect(encodeSubject({ handle: "creator", platform: "TikTok", extras: {} }))
      .toBe("creator@TikTok");
  });

  it("extras whose values are all empty are also no extras", () => {
    expect(encodeSubject({
      handle: "creator", platform: "TikTok",
      extras: { googleMapsUrl: "", tiktokChannelUrl: "" },
    })).toBe("creator@TikTok");
  });

  it("every hint already in the ledger still parses to the same handle and platform", () => {
    // Real shapes taken from the live ledger.
    for (const [hint, handle, platform] of [
      ["misterclimber@TikTok", "misterclimber", "TikTok"],
      ["kaylee.nhi@TikTok", "kaylee.nhi", "TikTok"],
      ["vnillalondon@Instagram", "vnillalondon", "Instagram"],
      ["mkbhd@YouTube", "mkbhd", "YouTube"],
      ["invisible.ads@TikTok", "invisible.ads", "TikTok"],
    ] as const) {
      expect(decodeSubject(hint)).toEqual({ handle, platform });
    }
  });

  it("the parse the queue used to do by hand agrees with the decoder", () => {
    // processCampaign and shapeCampaign both did `hint.split("@")`. Anything
    // that parsed before must parse the same now.
    for (const hint of ["a@TikTok", "b.c@Instagram", "d_e@TikTok"]) {
      const [oldHandle, oldPlatform] = hint.split("@");
      const decoded = decodeSubject(hint);
      expect(decoded.handle).toBe(oldHandle);
      expect(decoded.platform).toBe(oldPlatform);
    }
  });
});

describe("extras — only for subjects that need them", () => {
  it("a brand carries its locators and round-trips them exactly", () => {
    const subject = {
      handle: "https://www.glossier.com",
      platform: "Brand",
      extras: {
        googleMapsUrl: "https://maps.app.goo.gl/xyz?q=1",
        tiktokChannelUrl: "https://www.tiktok.com/@glossier",
        instagramHandle: "glossier",
      },
    };
    const hint = encodeSubject(subject);
    expect(hint.startsWith("https://www.glossier.com@Brand::")).toBe(true);
    expect(decodeSubject(hint)).toEqual(subject);
  });

  it("encoding is stable regardless of key order", () => {
    const a = encodeSubject({ handle: "x", platform: "Brand", extras: { b: "2", a: "1" } });
    const b = encodeSubject({ handle: "x", platform: "Brand", extras: { a: "1", b: "2" } });
    expect(a).toBe(b); // same subject, same key — otherwise resumption misses
  });

  it("values containing the separator or a URL survive intact", () => {
    const extras = { url: "https://x.test/a::b?c=1&d=2#frag" };
    expect(decodeSubject(encodeSubject({ handle: "h", platform: "Brand", extras })).extras)
      .toEqual(extras);
  });

  it("a handle that itself contains @ still yields the right platform", () => {
    expect(decodeSubject("weird@name@TikTok")).toEqual({ handle: "weird@name", platform: "TikTok" });
  });
});

describe("degrading, not throwing", () => {
  it("a corrupt extras suffix still yields a usable platform", () => {
    // The queue's first question is "can I run this platform at all?". A broken
    // suffix must not make that unanswerable inside the boot loop.
    const decoded = decodeSubject("x@Brand::%%%not-json%%%");
    expect(decoded.handle).toBe("x");
    expect(decoded.platform).toBe("Brand");
    expect(decoded.extras).toBeUndefined();
  });

  it("null, undefined and empty hints do not throw", () => {
    for (const hint of [null, undefined, ""]) {
      expect(() => decodeSubject(hint)).not.toThrow();
      expect(decodeSubject(hint).platform).toBe("");
    }
  });
});

/**
 * NOBODY BUILDS A SUBJECT HINT BY HAND.
 *
 * The queue enqueues through `encodeSubject`; the campaign then banks every
 * phase under a hint it derives itself. While every subject was a bare handle
 * those agreed by coincidence. The moment one carries extras they diverge — the
 * queue submits `name@Brand::{...}`, the campaign banks `name@Brand`, and a
 * single campaign's ledger rows split across two subject hints.
 *
 * Asserted as a source rule because it is not observable in any single test:
 * the two encoders live in different modules and only disagree for a subject
 * type that does not exist yet.
 */
describe("subject hints are never hand-rolled", () => {
  it("no live module rebuilds `handle@platform` with a template literal", () => {
    const roots = [
      "server/phases/creatorCampaign.ts",
      "server/queue/analysisQueue.ts",
      "server/webResearch.ts",
    ];
    for (const rel of roots) {
      const src = readFileSync(path.join(import.meta.dirname, "..", rel), "utf8");
      expect(src, `${rel} rebuilds a subject hint by hand`)
        .not.toMatch(/subjectHint\s*=\s*`\$\{/);
    }
  });
});
