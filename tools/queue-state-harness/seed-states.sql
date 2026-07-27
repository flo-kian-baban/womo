-- ═══════════════════════════════════════════════════════════════════════════
-- FORCED CAMPAIGN STATES — for verifying the queue rendering.
--
-- Runs ONLY against the isolated local Postgres (womo-test-pg, port 55432),
-- via `pnpm harness:up`. NEVER against the shared Supabase — this file begins
-- with TRUNCATE, which against production would erase the live queue.
-- See tools/queue-state-harness/README.md.
--
-- Every campaign below is WORKER-INERT by construction, so the running queue
-- worker cannot mutate a fixture out from under a screenshot:
--   committed rows            findIncompleteCampaigns skips (commit complete/partial)
--   genuine_empty rows        scanReadyWork excludes the class; findIncomplete calls it terminated
--   structural rows           same exclusion, both reads
--   a future next_earliest_at scanReadyWork's gate has not expired; findIncomplete skips parked
--   status='running'          not in READY_STATUSES; findIncomplete skips running
--                             (reclaimStaleRunning only touches rows older than 10 min,
--                              so updated_at is now())
-- The one state that CANNOT be forced inertly is a plain `queued` TikTok row —
-- the worker would pick it up and really scrape it. It is captured naturally
-- instead, plus one legacy-platform row the worker skips without writing.
-- ═══════════════════════════════════════════════════════════════════════════
TRUNCATE analysis_phase_state;

-- ── 1. COMPLETE, CLEAN — the only green tick in the set ────────────────────
INSERT INTO analysis_phase_state (run_id, subject_hint, phase, tool, status, attempt_count, output, updated_at) VALUES
('11111111-1111-4111-8111-000000000001','maya.linden@TikTok','capture','tiktok:capture','complete',1,NULL, now() - interval '31 minutes'),
('11111111-1111-4111-8111-000000000001','maya.linden@TikTok','augment','tiktok:augment','complete',1,NULL, now() - interval '30 minutes'),
('11111111-1111-4111-8111-000000000001','maya.linden@TikTok','transcribe','tiktok:transcribe','complete',1,NULL, now() - interval '28 minutes'),
('11111111-1111-4111-8111-000000000001','maya.linden@TikTok','derive','llm:themes+symbols','complete',1,NULL, now() - interval '27 minutes'),
('11111111-1111-4111-8111-000000000001','maya.linden@TikTok','extract_commit','llm:extractCreatorProfile+persist','complete',1,
 '{"subjectId":"aaaaaaaa-0000-4000-8000-000000000001","observationId":"bbbbbbbb-0000-4000-8000-000000000001","persistence":{"saved":"full","failedComponents":[],"error":null}}', now() - interval '26 minutes');

-- ── 2. COMMITTED WITH GAPS — the scheduler exhausted its ladder while still
--       blocked, downgraded `failed` to `partial`, and banked the gap. ───────
INSERT INTO analysis_phase_state (run_id, subject_hint, phase, tool, status, attempt_count, output, updated_at) VALUES
('11111111-1111-4111-8111-000000000002','theo.rivas@Instagram','capture','instagram:capture','complete',1,NULL, now() - interval '22 minutes'),
('11111111-1111-4111-8111-000000000002','theo.rivas@Instagram','augment','instagram:augment','complete',1,NULL, now() - interval '21 minutes'),
('11111111-1111-4111-8111-000000000002','theo.rivas@Instagram','transcribe','instagram:transcribe','partial',4,
 '{"blockedGap":{"phase":"transcribe","attempts":4,"failureClass":"transient","detail":"subtitle fetch returned HTTP 429 on 9 of 12 sampled posts","reason":"blocked after 4 of 4 attempts — committing with the gap recorded"}}', now() - interval '18 minutes'),
('11111111-1111-4111-8111-000000000002','theo.rivas@Instagram','derive','llm:themes+symbols','complete',1,NULL, now() - interval '17 minutes'),
('11111111-1111-4111-8111-000000000002','theo.rivas@Instagram','extract_commit','llm:extractCreatorProfile+persist','complete',1,
 '{"subjectId":"aaaaaaaa-0000-4000-8000-000000000002","observationId":"bbbbbbbb-0000-4000-8000-000000000002","persistence":{"saved":"full","failedComponents":[],"error":null}}', now() - interval '16 minutes');

-- ── 3. PARTIAL PERSISTENCE — committed, but a component did not save. ──────
INSERT INTO analysis_phase_state (run_id, subject_hint, phase, tool, status, attempt_count, output, updated_at) VALUES
('11111111-1111-4111-8111-000000000003','nadia.okafor@TikTok','capture','tiktok:capture','complete',1,NULL, now() - interval '14 minutes'),
('11111111-1111-4111-8111-000000000003','nadia.okafor@TikTok','augment','tiktok:augment','complete',1,NULL, now() - interval '13 minutes'),
('11111111-1111-4111-8111-000000000003','nadia.okafor@TikTok','transcribe','tiktok:transcribe','complete',1,NULL, now() - interval '12 minutes'),
('11111111-1111-4111-8111-000000000003','nadia.okafor@TikTok','derive','llm:themes+symbols','complete',1,NULL, now() - interval '11 minutes'),
('11111111-1111-4111-8111-000000000003','nadia.okafor@TikTok','extract_commit','llm:extractCreatorProfile+persist','partial',1,
 '{"subjectId":"aaaaaaaa-0000-4000-8000-000000000003","observationId":"bbbbbbbb-0000-4000-8000-000000000003","persistence":{"saved":"partial","failedComponents":["decoded_signals"],"error":"decoded_signals insert failed: value too long for type character varying(64) — the observation was saved without its decoded symbols."}}', now() - interval '10 minutes');

-- ── 4. REFUSED — EMPTY SUBJECT. A phase confirmed the subject has no content.
--       Terminal, nothing saved, and NOT a failure of ours. ────────────────
INSERT INTO analysis_phase_state (run_id, subject_hint, phase, tool, status, attempt_count, failure_class, output, updated_at) VALUES
('11111111-1111-4111-8111-000000000004','quiet.harbour@Instagram','capture','instagram:capture','genuine_empty',1,'genuine_empty',NULL, now() - interval '9 minutes'),
('11111111-1111-4111-8111-000000000004','quiet.harbour@Instagram','extract_commit','queue:terminal','failed',1,'structural',
 '{"terminal":true,"status":"error","message":"@quiet.harbour''s Instagram profile reports 0 posts — there is no content to analyze. (Confirmed by the profile''s own stats; this is not a scraping failure.)"}', now() - interval '9 minutes');

-- ── 5. REFUSED — INSUFFICIENT DATA. The frozen min-data gate declined to
--       extract. PRECONDITION_FAILED → min_data_rejection → genuine_empty. ──
INSERT INTO analysis_phase_state (run_id, subject_hint, phase, tool, status, attempt_count, failure_class, output, updated_at) VALUES
('11111111-1111-4111-8111-000000000005','bram.solheim@TikTok','capture','tiktok:capture','complete',1,NULL,NULL, now() - interval '8 minutes'),
('11111111-1111-4111-8111-000000000005','bram.solheim@TikTok','augment','tiktok:augment','partial',1,NULL,NULL, now() - interval '8 minutes'),
('11111111-1111-4111-8111-000000000005','bram.solheim@TikTok','transcribe','tiktok:transcribe','partial',1,NULL,NULL, now() - interval '7 minutes'),
('11111111-1111-4111-8111-000000000005','bram.solheim@TikTok','extract_commit','queue:terminal','genuine_empty',1,'genuine_empty',
 '{"terminal":true,"status":"min_data_rejection","message":"Insufficient data for @bram.solheim: 0 transcripts, 4 titles. The profile was reachable but yielded too little evidence to extract a cultural profile from. Nothing was saved."}', now() - interval '7 minutes');

-- ── 6. PARKED — a real external gate with a real retry time. It WILL resume. ─
--       Note the extract_commit terminal row: recordTerminalFailure writes one
--       even though the campaign is merely parked, which is why the row frames
--       that message as "what the last attempt reported".
INSERT INTO analysis_phase_state (run_id, subject_hint, phase, tool, status, attempt_count, failure_class, next_earliest_at, output, updated_at) VALUES
('11111111-1111-4111-8111-000000000006','ilse.vandermeer@TikTok','capture','tiktok:capture','blocked',2,'transient', now() + interval '7 minutes',
 '{"parkReason":"blocked — parked 300s for the gate to clear"}', now() - interval '3 minutes'),
('11111111-1111-4111-8111-000000000006','ilse.vandermeer@TikTok','extract_commit','queue:terminal','failed',1,'structural',
 NULL,'{"terminal":true,"status":"error","message":"No public content found for @ilse.vandermeer."}', now() - interval '3 minutes');

-- ── 7. PARKED FOR A HUMAN — the scheduler''s structural park. No retry time BY
--       DESIGN; scanReadyWork excludes it, so it never resumes on its own.
--       `resumeRun` is exactly its rescue. ──────────────────────────────────
INSERT INTO analysis_phase_state (run_id, subject_hint, phase, tool, status, attempt_count, failure_class, output, updated_at) VALUES
('11111111-1111-4111-8111-000000000007','soren.delacroix@Instagram','capture','instagram:capture','complete',1,NULL,NULL, now() - interval '46 minutes'),
('11111111-1111-4111-8111-000000000007','soren.delacroix@Instagram','augment','instagram:augment','failed',1,'structural',
 '{"parkReason":"structural — retrying a changed/removed path is futile; parked for a human"}', now() - interval '45 minutes'),
('11111111-1111-4111-8111-000000000007','soren.delacroix@Instagram','extract_commit','queue:terminal','failed',1,'structural',
 '{"terminal":true,"status":"error","message":"Analysis for @soren.delacroix stopped at the augment phase (unusable). Nothing was saved."}', now() - interval '45 minutes');

-- ── 8. FAILED — a terminal failure with an honest message and no park. ─────
INSERT INTO analysis_phase_state (run_id, subject_hint, phase, tool, status, attempt_count, failure_class, output, updated_at) VALUES
('11111111-1111-4111-8111-000000000008','crag.wells@TikTok','capture','tiktok:capture','complete',1,NULL,NULL, now() - interval '52 minutes'),
('11111111-1111-4111-8111-000000000008','crag.wells@TikTok','augment','tiktok:augment','complete',1,NULL,NULL, now() - interval '52 minutes'),
('11111111-1111-4111-8111-000000000008','crag.wells@TikTok','transcribe','tiktok:transcribe','complete',1,NULL,NULL, now() - interval '50 minutes'),
('11111111-1111-4111-8111-000000000008','crag.wells@TikTok','derive','llm:themes+symbols','complete',1,NULL,NULL, now() - interval '49 minutes'),
('11111111-1111-4111-8111-000000000008','crag.wells@TikTok','extract_commit','queue:terminal','failed',1,'structural',
 '{"terminal":true,"status":"error","message":"Extraction failed for @crag.wells: the model returned a response the profile schema rejected (missing archetype). Nothing was saved."}', now() - interval '48 minutes');

-- ── 9. RUNNING — mid-campaign. updated_at is now(), so the 10-minute stale
--       reclaim cannot touch it. ────────────────────────────────────────────
INSERT INTO analysis_phase_state (run_id, subject_hint, phase, tool, status, attempt_count, output, updated_at) VALUES
('11111111-1111-4111-8111-000000000009','lior.benavides@TikTok','capture','tiktok:capture','complete',1,NULL, now()),
('11111111-1111-4111-8111-000000000009','lior.benavides@TikTok','augment','tiktok:augment','complete',1,NULL, now()),
('11111111-1111-4111-8111-000000000009','lior.benavides@TikTok','transcribe','tiktok:transcribe','running',1,NULL, now());

-- ── 10. QUEUED — forced via a legacy-platform row, which `processCampaign`
--        skips WITHOUT writing (isRunnableSubject is false). This is also the
--        rendering of Gap C: a campaign that will never run, shown as queued,
--        because the client is not told whether a subject is runnable. ──────
INSERT INTO analysis_phase_state (run_id, subject_hint, phase, status, attempt_count, updated_at) VALUES
('11111111-1111-4111-8111-000000000010','anders.holt@YouTube','capture','pending',0, now() - interval '2 minutes');

-- ── 11. BRAND, COMPLETE — six phases, including channel_instagram. ─────────
INSERT INTO analysis_phase_state (run_id, subject_hint, phase, tool, status, attempt_count, output, updated_at) VALUES
('11111111-1111-4111-8111-000000000011','https://www.havenbotanics.com@Brand','capture','brand:capture','complete',1,NULL, now() - interval '40 minutes'),
('11111111-1111-4111-8111-000000000011','https://www.havenbotanics.com@Brand','augment','brand:augment','complete',1,NULL, now() - interval '39 minutes'),
('11111111-1111-4111-8111-000000000011','https://www.havenbotanics.com@Brand','transcribe','brand:transcribe','complete',1,NULL, now() - interval '38 minutes'),
('11111111-1111-4111-8111-000000000011','https://www.havenbotanics.com@Brand','channel_instagram','brand:channel_instagram','complete',1,NULL, now() - interval '37 minutes'),
('11111111-1111-4111-8111-000000000011','https://www.havenbotanics.com@Brand','derive','llm:brand_symbols','complete',1,NULL, now() - interval '36 minutes'),
('11111111-1111-4111-8111-000000000011','https://www.havenbotanics.com@Brand','extract_commit','llm:extractBrandProfile+persist','complete',1,
 '{"subjectId":"aaaaaaaa-0000-4000-8000-000000000011","observationId":"bbbbbbbb-0000-4000-8000-000000000011","persistence":{"saved":"full","failedComponents":[],"error":null}}', now() - interval '35 minutes');

-- ── 12. BRAND, RUNNING, NOT YET AT channel_instagram — the phase-shape case.
--        No row exists for channel_instagram yet, so row-presence would render
--        this brand with a creator's five marks. Subject kind gives it six. ──
INSERT INTO analysis_phase_state (run_id, subject_hint, phase, tool, status, attempt_count, output, updated_at) VALUES
('11111111-1111-4111-8111-000000000012','https://www.corvidcoffee.co@Brand','capture','brand:capture','complete',1,NULL, now()),
('11111111-1111-4111-8111-000000000012','https://www.corvidcoffee.co@Brand','augment','brand:augment','running',1,NULL, now());

-- ── 13. BRAND, INSTAGRAM NEVER ATTEMPTED — channel_instagram banks `partial`
--        + skippedReason when no handle is supplied. `skippedReason` is NOT
--        shipped to the client (Gap G), so this renders as a neutral `reduced`
--        mark: honest about "less than wanted", silent about why. ───────────
INSERT INTO analysis_phase_state (run_id, subject_hint, phase, tool, status, attempt_count, output, updated_at) VALUES
('11111111-1111-4111-8111-000000000013','https://www.thistlepress.org@Brand','capture','brand:capture','complete',1,NULL, now() - interval '5 minutes'),
('11111111-1111-4111-8111-000000000013','https://www.thistlepress.org@Brand','augment','brand:augment','complete',1,NULL, now() - interval '5 minutes'),
('11111111-1111-4111-8111-000000000013','https://www.thistlepress.org@Brand','transcribe','brand:transcribe','complete',1,NULL, now() - interval '4 minutes'),
('11111111-1111-4111-8111-000000000013','https://www.thistlepress.org@Brand','channel_instagram','brand:channel_instagram','partial',1,
 '{"metadata":null,"skippedReason":"no Instagram handle supplied"}', now() - interval '4 minutes'),
('11111111-1111-4111-8111-000000000013','https://www.thistlepress.org@Brand','derive','llm:brand_symbols','complete',1,NULL, now() - interval '4 minutes'),
('11111111-1111-4111-8111-000000000013','https://www.thistlepress.org@Brand','extract_commit','llm:extractBrandProfile+persist','complete',1,
 '{"subjectId":"aaaaaaaa-0000-4000-8000-000000000013","observationId":"bbbbbbbb-0000-4000-8000-000000000013","persistence":{"saved":"full","failedComponents":[],"error":null}}', now() - interval '3 minutes');

-- ── 14. FINDING 4 — the server''s projection and the ledger disagree.
--        transcribe is parked with a REAL future retry time, and the gate then
--        refused with PRECONDITION_FAILED, so deriveCampaignState hits
--        `genuine_empty → complete` BEFORE it checks for a live park and
--        reports `complete`. Both facts are rendered; neither is overridden. ─
INSERT INTO analysis_phase_state (run_id, subject_hint, phase, tool, status, attempt_count, failure_class, next_earliest_at, output, updated_at) VALUES
('11111111-1111-4111-8111-000000000014','wren.castellano@TikTok','capture','tiktok:capture','complete',1,NULL,NULL,NULL, now() - interval '6 minutes'),
('11111111-1111-4111-8111-000000000014','wren.castellano@TikTok','augment','tiktok:augment','complete',1,NULL,NULL,NULL, now() - interval '6 minutes'),
('11111111-1111-4111-8111-000000000014','wren.castellano@TikTok','transcribe','tiktok:transcribe','blocked',2,'transient', now() + interval '11 minutes',
 '{"parkReason":"blocked — parked 900s for the gate to clear"}', now() - interval '5 minutes'),
('11111111-1111-4111-8111-000000000014','wren.castellano@TikTok','extract_commit','queue:terminal','genuine_empty',1,'genuine_empty',NULL,
 '{"terminal":true,"status":"min_data_rejection","message":"Insufficient data for @wren.castellano: 0 transcripts, 11 titles. Nothing was saved."}', now() - interval '5 minutes');
