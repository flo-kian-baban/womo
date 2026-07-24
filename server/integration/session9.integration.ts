/**
 * Session 9 — panel truthfulness & transcript honesty (ephemeral Postgres).
 * Gated on TEST_DATABASE_URL; skips when unset. See server/integration/README.md.
 *
 * Coverage grows across the Session 9 commits:
 *  - B3: read model orders transcript evidence by value (speech first, then word
 *    count), NOT by view count; discovered pool keeps view order; source fields exposed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";
import * as db from "../db";
import { persistCreatorToV2 } from "../routers";
import { TRANSCRIPT_SOURCE } from "@shared/transcriptSource";

const TEST_URL = process.env.TEST_DATABASE_URL;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const suite = TEST_URL ? describe : describe.skip;
const here = path.dirname(fileURLToPath(import.meta.url));

suite("session 9: panel truthfulness (ephemeral Postgres)", () => {
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    await admin.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const ddl = readFileSync(path.join(here, "schema.sql"), "utf8")
      .split("\n")
      .filter(line => !line.startsWith("\\") && line.trim() !== "CREATE SCHEMA public;")
      .join("\n");
    await admin.query(ddl);
    await admin.query("SET search_path TO public;");
  });

  afterAll(async () => { await admin.end(); });

  // ── B3: transcript evidence ordered by value, not views ─────────────────────
  it("orders transcripts speech-first then word-count-desc; pool stays view-ordered", async () => {
    // v_viral: a 95M-view clip whose only 'transcript' is a 20-word POST CAPTION.
    // v_speech: a 400K-view clip with a 1645-word SUBTITLE (real speech).
    // Old behavior surfaced v_viral first (view_count DESC). New: v_speech first.
    const result = await persistCreatorToV2({
      handle: "order_creator", platform: "TikTok", displayName: "Order Creator",
      extracted: { archetype: "The Sage" },
      researchData: {
        followerCount: 187200,
        discoveredVideoPoolJson: [
          { id: "v_viral", url: "https://www.tiktok.com/@order_creator/video/v_viral",
            caption: "They said it couldn't be done #hooverdam", createTime: 1699000000,
            views: 95300000, likes: 8400000, comments: 22700, saves: 0, shares: 0, musicOriginal: false, durationSec: 20 },
          { id: "v_speech", url: "https://www.tiktok.com/@order_creator/video/v_speech",
            caption: "an urgency brothers and sisters", createTime: 1690000000,
            views: 424500, likes: 74300, comments: 2918, saves: 0, shares: 0, musicOriginal: false, durationSec: 300 },
        ],
        transcripts: [
          { videoId: "v_viral", transcript: "They said it couldn't be done. So we did it.", wordCount: 20, transcriptSource: TRANSCRIPT_SOURCE.postCaption, bucket: "mid" },
          { videoId: "v_speech", transcript: "So I've had it on my heart to do this video for weeks now about the urgency…", wordCount: 1645, transcriptSource: TRANSCRIPT_SOURCE.subtitle, bucket: "anchor" },
        ],
      },
    });
    if ("error" in result) throw new Error(result.error);

    const profile = (await db.getCreatorProfileById(result.subjectId)) as any;
    const excerpts = profile.transcriptExcerpts as Array<any>;
    expect(excerpts).toHaveLength(2);

    // Speech transcript first, even though it has far fewer views.
    expect(excerpts[0].videoId).toBe("v_speech");
    expect(excerpts[0].sourceKind).toBe("speech");
    expect(excerpts[0].sourceLabel).toBe("Subtitle track");
    expect(excerpts[1].videoId).toBe("v_viral");
    expect(excerpts[1].sourceKind).toBe("caption");
    expect(excerpts[1].sourceLabel).toBe("Post caption");

    // The discovered pool is unchanged — still highest-view first.
    const pool = profile.discoveredVideoPoolJson as Array<any>;
    expect(pool[0].id).toBe("v_viral"); // 95.3M views leads the pool

    // The music round-trip array (fit.calculate input) is order-agnostic but must
    // still contain both, unaffected by the reorder.
    expect((profile.transcripts as Array<any>).map(t => t.videoId).sort()).toEqual(["v_speech", "v_viral"]);
  });
});
