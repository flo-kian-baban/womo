/**
 * Phased-architecture S1 — contract-level unit tests.
 *
 * The contract is definition-only this session, so what is testable is its
 * DECISION LOGIC: which outcomes are usable downstream, and which are allowed
 * to requeue. These two predicates are what the S3 scheduler will run on, and
 * getting them wrong is how you either lose work (never requeue a transient) or
 * burn a creator's quota forever (requeue a structural failure).
 */
import { describe, expect, it } from "vitest";
import {
  PHASE_NAMES,
  isRequeueable,
  isUsableOutcome,
  type PhaseFailureClass,
  type PhaseOutcome,
} from "./_core/analysisPhase";

describe("phase names", () => {
  it("are the six approved phases, in pipeline order", () => {
    // Six since S5. `channel_instagram` is written only by brand campaigns; it
    // is a phase rather than part of augment because the phase is the RETRY
    // UNIT, and a failed Instagram scrape must not re-run the review and
    // mention fetches.
    expect(PHASE_NAMES).toEqual([
      "capture",
      "augment",
      "transcribe",
      "channel_instagram",
      "derive",
      "extract_commit",
    ]);
  });
});

describe("isUsableOutcome — may downstream phases consume this output?", () => {
  it("complete and partial are usable (a budget-bailed transcribe still feeds derive)", () => {
    expect(isUsableOutcome("complete")).toBe(true);
    expect(isUsableOutcome("partial")).toBe(true);
  });

  it("blocked / genuine_empty / failed are not usable", () => {
    for (const o of ["blocked", "genuine_empty", "failed"] as PhaseOutcome[]) {
      expect(isUsableOutcome(o)).toBe(false);
    }
  });
});

describe("isRequeueable — will the scheduler try again?", () => {
  it("never requeues a completed phase (idempotency guard)", () => {
    expect(isRequeueable("complete", undefined)).toBe(false);
  });

  it("never requeues a confirmed genuine-empty — that is a fact, not a failure", () => {
    expect(isRequeueable("genuine_empty", "genuine_empty")).toBe(false);
    expect(isRequeueable("failed", "genuine_empty")).toBe(false);
  });

  it("never requeues a structural failure — retrying a dead path is futile", () => {
    // The removed search HTML-parse leg (0/38 lifetime) is the canonical case.
    expect(isRequeueable("failed", "structural")).toBe(false);
    expect(isRequeueable("blocked", "structural")).toBe(false);
  });

  it("requeues transient failures and blocks (fresh context / quota recovery)", () => {
    expect(isRequeueable("failed", "transient")).toBe(true);
    expect(isRequeueable("blocked", "transient")).toBe(true);
    expect(isRequeueable("blocked", undefined)).toBe(true);
  });

  it("requeues a partial — more of the sample may still be collectable", () => {
    expect(isRequeueable("partial", undefined)).toBe(true);
  });

  it("classifies every (outcome, class) pair without throwing", () => {
    const outcomes: PhaseOutcome[] = ["complete", "partial", "blocked", "genuine_empty", "failed"];
    const classes: Array<PhaseFailureClass | undefined> = ["transient", "structural", "genuine_empty", undefined];
    for (const o of outcomes) {
      for (const c of classes) {
        expect(typeof isRequeueable(o, c)).toBe("boolean");
      }
    }
  });
});
