/**
 * Collection-fixture capture for the phase path (S2 cutover).
 *
 * Ported here when the inline orchestration was deleted. Removing a function
 * must not silently remove a capability: the collection identity harness
 * replays RECORDED raw platform payloads, and when TikTok's response shapes
 * drift the fixture has to be refreshable. That refresh procedure lived inside
 * fetchTikTokTranscripts; it now lives with the phases.
 *
 * INERT BY DEFAULT. With WOMO_COLLECTION_FIXTURE unset, `capturing()` is false
 * and nothing here allocates or writes.
 *
 * Refresh procedure (documented in docs/CREATOR_PIPELINE_AUDIT.md):
 *   WOMO_COLLECTION_FIXTURE=/tmp/collection.json PORT=3300 \
 *     NODE_ENV=development pnpm exec tsx server/_core/index.ts
 *   …run ONE creator analysis, then copy the file to
 *   server/__fixtures__/collection.tiktok.json and re-run the harness.
 *
 * The recorded shape is deliberately identical to the committed fixture's, so
 * a refreshed capture is a drop-in replacement.
 */
import { writeFileSync } from "node:fs";

export interface CollectionFixtureDraft {
  handle: string;
  samplingNowSec?: number;
  raw: {
    prefetchedProfile: unknown;
    searchResponses: Array<{ query: string; items: unknown[] }>;
  };
  expected: {
    poolAfterApi: unknown;
    poolAfterAugment: unknown;
    sample: Array<{ id: string; bucket: string }>;
    /** Boundary 4 — the per-video transcript results, in order. */
    transcriptsAfterFetch: unknown[];
  };
}

/** Per-campaign drafts. Runs are sequential within a request and this is a
 *  dev-only flag, so a plain map keyed by run id is sufficient. */
const drafts = new Map<string, CollectionFixtureDraft>();

export function fixturePath(): string | undefined {
  return process.env.WOMO_COLLECTION_FIXTURE;
}

export function capturing(): boolean {
  return Boolean(fixturePath());
}

export function draftFor(runId: string, handle: string): CollectionFixtureDraft {
  let d = drafts.get(runId);
  if (!d) {
    d = {
      handle,
      raw: { prefetchedProfile: null, searchResponses: [] },
      expected: { poolAfterApi: null, poolAfterAugment: null, sample: [], transcriptsAfterFetch: [] },
    };
    drafts.set(runId, d);
  }
  return d;
}

/** Write the draft to disk and drop it. Failures are swallowed — a debug hook
 *  must never be able to fail an analysis. */
export function flush(runId: string): void {
  const target = fixturePath();
  const draft = drafts.get(runId);
  if (!target || !draft) return;
  drafts.delete(runId);
  try {
    writeFileSync(target, JSON.stringify(draft, null, 2), "utf-8");
    console.log(`[fixtureCapture] collection fixture written: ${target}`);
  } catch (err) {
    console.warn("[fixtureCapture] write failed (ignored):", (err as Error).message);
  }
}
