/**
 * Admission control — phased architecture S3a, Part 1.
 *
 * THE REGRESSION THIS FILE EXISTS FOR: the old `pLimit(2)` in
 * instrumentedRun.ts was handed a promise that had ALREADY STARTED, so it
 * deferred the observation of running work instead of the work itself. Nothing
 * was bounded. Every test below is written so that the old shape would FAIL it:
 * the assertions are about when `fn` is CALLED, not about when the wrapper
 * settles.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NestedResourceSlotError,
  __testSlots,
  classForPhase,
  currentBounds,
  currentlyHeldClass,
  slotSnapshot,
  withResourceSlot,
} from "./_core/resourceSlots";
import { PHASE_NAMES } from "./_core/analysisPhase";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A job whose body records entry/exit and blocks until released. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((r) => { release = r; });
  return { opened, release };
}

beforeEach(() => { __testSlots.reset(); });
afterEach(() => { __testSlots.reset(); });

describe("phase → resource class", () => {
  it("maps every phase, browser for the scraping three and llm for the two model phases", () => {
    expect(classForPhase("capture")).toBe("browser");
    expect(classForPhase("augment")).toBe("browser");
    expect(classForPhase("transcribe")).toBe("browser");
    expect(classForPhase("derive")).toBe("llm");
    expect(classForPhase("extract_commit")).toBe("llm");
    // No phase may be unclassified — a new phase must make a deliberate choice.
    for (const p of PHASE_NAMES) {
      expect(["browser", "llm", "compute"]).toContain(classForPhase(p));
    }
  });
});

describe("bounds are configuration, with the approved starting values", () => {
  it("defaults to browser 2 / llm 4 / compute unbounded", () => {
    expect(currentBounds()).toEqual({ browser: 2, llm: 4, compute: 0 });
  });
});

describe("ADMISSION BOUNDS WORK — the fix for the non-functional semaphore", () => {
  it("never calls more than `bound` job bodies at once, and does not start the rest", async () => {
    __testSlots.setBounds({ browser: 2 });

    const started: number[] = [];
    const finished: number[] = [];
    let concurrent = 0;
    let peak = 0;
    const g = gate();

    const jobs = [0, 1, 2, 3, 4].map((i) =>
      withResourceSlot("browser", async () => {
        // Reaching HERE is the proof: the old eager shape ran this immediately.
        started.push(i);
        concurrent++;
        peak = Math.max(peak, concurrent);
        await g.opened;
        concurrent--;
        finished.push(i);
        return i;
      }),
    );

    await sleep(20); // plenty of turns for every eager body to have run

    // The load-bearing assertion: three of the five bodies have NOT executed.
    expect(started).toEqual([0, 1]);
    expect(started).toHaveLength(2);

    g.release();
    const results = await Promise.all(jobs);

    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(started.sort()).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("admits a waiting job only once a permit frees", async () => {
    __testSlots.setBounds({ browser: 1 });

    const order: string[] = [];
    const first = gate();

    const a = withResourceSlot("browser", async () => {
      order.push("a-start");
      await first.opened;
      order.push("a-end");
    });
    const b = withResourceSlot("browser", async () => {
      order.push("b-start");
    });

    await sleep(20);
    expect(order).toEqual(["a-start"]); // b has not begun

    first.release();
    await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "a-end", "b-start"]);
  });

  it("bounds each class independently — llm work is not queued behind browser work", async () => {
    __testSlots.setBounds({ browser: 1, llm: 4 });

    const order: string[] = [];
    const held = gate();

    const browserJob = withResourceSlot("browser", async () => {
      order.push("browser-start");
      await held.opened;
    });
    const llmJob = withResourceSlot("llm", async () => {
      order.push("llm-start");
    });

    await llmJob;
    expect(order).toEqual(["browser-start", "llm-start"]);

    held.release();
    await browserJob;
  });

  it("an unbounded class (compute) runs everything immediately", async () => {
    const started: number[] = [];
    const g = gate();
    const jobs = [0, 1, 2, 3, 4, 5].map((i) =>
      withResourceSlot("compute", async () => { started.push(i); await g.opened; }),
    );
    await sleep(20);
    expect(started).toHaveLength(6);
    g.release();
    await Promise.all(jobs);
  });
});

describe("PERMIT ⊃ CONTEXT — a waiting job holds no browser context (the TTL reaper trap)", () => {
  it("does not acquire a context until the permit is held, and releases before the next job runs", async () => {
    __testSlots.setBounds({ browser: 1 });

    // Stand-in for browserClient.getContext / retireContext: what matters is
    // that acquisition happens strictly INSIDE the admitted body, so a queued
    // job cannot be sitting on a context that the TTL reaper will either refuse
    // to collect (occupancy climbs past the cap) or close out from under it.
    let contextsHeld = 0;
    let peakContexts = 0;
    const acquires: string[] = [];
    const holder = gate();

    const job = (id: string, block: Promise<void> | null) =>
      withResourceSlot("browser", async () => {
        acquires.push(id);
        contextsHeld++;
        peakContexts = Math.max(peakContexts, contextsHeld);
        try {
          if (block) await block;
        } finally {
          contextsHeld--; // retireContext()
        }
      });

    const a = job("a", holder.opened);
    const b = job("b", null);

    await sleep(20);
    // b is queued. If it had grabbed a context first and THEN waited, this
    // would read ["a", "b"] and contextsHeld would be 2 — the reaper race.
    expect(acquires).toEqual(["a"]);
    expect(contextsHeld).toBe(1);

    holder.release();
    await Promise.all([a, b]);

    expect(acquires).toEqual(["a", "b"]);
    expect(contextsHeld).toBe(0);
    expect(peakContexts).toBe(1); // never more contexts than permits
  });
});

describe("nesting guard — one permit per phase, never nested", () => {
  it("throws when a permit is requested while another is held", async () => {
    __testSlots.setBounds({ browser: 2, llm: 2 });
    await expect(
      withResourceSlot("browser", async () => {
        await withResourceSlot("llm", async () => "should not get here");
      }),
    ).rejects.toBeInstanceOf(NestedResourceSlotError);
  });

  it("throws on re-entry into the SAME class too (self-deadlock at bound 1)", async () => {
    __testSlots.setBounds({ browser: 1 });
    await expect(
      withResourceSlot("browser", async () => {
        await withResourceSlot("browser", async () => "nope");
      }),
    ).rejects.toBeInstanceOf(NestedResourceSlotError);
  });

  it("guards the unbounded class as well, so compute is not a nesting loophole", async () => {
    await expect(
      withResourceSlot("compute", async () => {
        await withResourceSlot("browser", async () => "nope");
      }),
    ).rejects.toBeInstanceOf(NestedResourceSlotError);
  });

  it("exposes the held class inside the body and nothing outside it", async () => {
    expect(currentlyHeldClass()).toBeNull();
    await withResourceSlot("llm", async () => {
      expect(currentlyHeldClass()).toBe("llm");
    });
    expect(currentlyHeldClass()).toBeNull();
  });

  it("sequential acquisitions are fine — only nesting is forbidden", async () => {
    __testSlots.setBounds({ browser: 1, llm: 1 });
    await withResourceSlot("browser", async () => "capture");
    await withResourceSlot("llm", async () => "derive");
    // Reaching here without throwing IS the assertion: a campaign runs
    // capture → … → derive as a sequence of separate permits.
  });
});

describe("release discipline", () => {
  it("releases the permit when the body throws", async () => {
    __testSlots.setBounds({ browser: 1 });

    await expect(
      withResourceSlot("browser", async () => { throw new Error("phase blew up"); }),
    ).rejects.toThrow("phase blew up");

    // The slot must be free — otherwise one failed phase wedges the class.
    const ran = await withResourceSlot("browser", async () => "next job ran");
    expect(ran).toBe("next job ran");
    expect(slotSnapshot().browser.inFlight).toBe(0);
  });

  it("reports live occupancy, queue depth and the peak high-water mark", async () => {
    __testSlots.setBounds({ browser: 2 });
    const g = gate();

    const jobs = [0, 1, 2].map(() => withResourceSlot("browser", async () => { await g.opened; }));
    await sleep(20);

    const busy = slotSnapshot().browser;
    expect(busy.bound).toBe(2);
    expect(busy.inFlight).toBe(2);
    expect(busy.queued).toBe(1);
    expect(busy.peakInFlight).toBe(2);

    g.release();
    await Promise.all(jobs);

    const idle = slotSnapshot().browser;
    expect(idle.inFlight).toBe(0);
    expect(idle.queued).toBe(0);
    expect(idle.peakInFlight).toBe(2); // high-water mark is monotonic
  });
});
