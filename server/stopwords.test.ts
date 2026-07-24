/**
 * Session 9 (C2) — multilingual function-word filtering for keyword extraction.
 */
import { describe, it, expect } from "vitest";
import { isStopword } from "@shared/stopwords";

describe("stopword filtering", () => {
  it("filters the English function words that used to leak and outrank real signal", () => {
    for (const w of ["because", "there", "over", "going", "done", "out", "wants"]) {
      expect(isStopword(w)).toBe(true);
    }
  });

  it("does NOT filter real content words (any niche)", () => {
    for (const w of ["jesus", "church", "rapture", "christ", "prophecy", "shawarma", "guitar", "startup", "dios", "iglesia"]) {
      expect(isStopword(w)).toBe(false);
    }
  });

  it("filters common NON-English function words (Spanish / French / Portuguese / German / Italian)", () => {
    for (const w of ["que", "los", "para", "con", "porque", "les", "des", "une", "dans", "uma", "por", "und", "nicht", "che", "sono"]) {
      expect(isStopword(w)).toBe(true);
    }
  });

  it("PROTECTS English content homographs from being dropped by a foreign meaning", () => {
    // "sin" is Spanish "without" but a central English content word (religion) —
    // it must survive. Same for son/hay/war.
    expect(isStopword("sin")).toBe(false);
    expect(isStopword("son")).toBe(false);
    expect(isStopword("hay")).toBe(false);
    expect(isStopword("war")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isStopword("BECAUSE")).toBe(true);
    expect(isStopword("Que")).toBe(true);
  });
});
