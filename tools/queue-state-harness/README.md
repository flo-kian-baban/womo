# Queue state harness

Reproduce **every state a campaign can occupy** and screenshot the real
rendering, without touching the shared database.

## Why this exists

The queue view has to render ten distinguishable states, and most of them
cannot be produced on demand. Parking had never fired in production when this
surface was built; committed-with-gaps had never been observed; a genuine-empty
refusal happens only when a real profile reports zero posts. Waiting for
production to produce them is not a verification strategy, and the states that
never appear are exactly the ones whose rendering rots unnoticed.

So the states are forced as ledger rows in an **isolated local Postgres**, and
the real app is pointed at it. Nothing is mocked: the server, the router, the
tRPC transport and the client are all the real ones. Only the ledger contents
are fabricated.

> **Never run the seed against the shared Supabase.** `DATABASE_URL` in `.env`
> points at the database every analyst shares. The seed begins with `TRUNCATE
> analysis_phase_state` — against production that would erase the queue. Every
> command below names the local database explicitly for that reason.

## The whole loop

```bash
pnpm harness:up        # start local Postgres, apply schema, seed the states
pnpm harness:app       # run the real app against it (Ctrl-C to stop)
pnpm harness:capture   # screenshot every state into tmp/shots/ (separate shell)
pnpm harness:down      # remove the container
```

`tmp/shots/` is gitignored — screenshots are evidence for a review, not
artefacts to commit.

## What gets seeded

`seed-states.sql` writes 14 campaigns covering all ten display states plus three
structural cases. Read it top to bottom; each block says which state it produces
and why it is shaped that way.

| campaign | state it produces |
|---|---|
| `maya.linden` | complete, clean — the only green tick in the set |
| `theo.rivas` | committed **with gaps** (scheduler exhausted its ladder while blocked) |
| `nadia.okafor` | committed, **partial save** (a component failed to persist) |
| `quiet.harbour` | **refused** — subject confirmed empty |
| `bram.solheim` | **refused** — the frozen min-data gate declined |
| `ilse.vandermeer` | parked, with a real retry time |
| `soren.delacroix` | **parked for a human** (structural; never retries by itself) |
| `crag.wells` | failed, with an honest message |
| `lior.benavides` | running |
| `anders.holt` | queued — via a legacy platform (also demonstrates Gap C) |
| `havenbotanics` | brand, complete — six phases |
| `corvidcoffee` | brand, running, **before** `channel_instagram` exists |
| `thistlepress` | brand whose Instagram was **never attempted** (Gap G) |
| `wren.castellano` | the ledger and `deriveCampaignState` **disagree** (see below) |

### Every fixture is worker-inert, by construction

The queue worker starts with the app and polls every 5s. If a fixture were
schedulable, the worker would pick it up and really scrape it, mutating the row
out from under the screenshot. Each fixture is therefore shaped so that both
reads which offer work decline it:

| fixture shape | why the worker skips it |
|---|---|
| committed (`extract_commit` complete/partial) | `findIncompleteCampaigns` treats it as finished |
| `genuine_empty` | excluded by class from `scanReadyWork`; terminated in `findIncompleteCampaigns` |
| `structural` | same exclusion in both reads |
| future `next_earliest_at` | the gate has not expired; `findIncompleteCampaigns` skips parked |
| `status='running'`, fresh `updated_at` | not in `READY_STATUSES`; `reclaimStaleRunning` only touches rows older than `STALE_RUNNING_MS` (10 min) |

**Verify this held** after a capture run — if anything was touched, the
screenshots are of a moving target. The two `running` fixtures are stamped
`now()` by the seed (5 rows between them), so exclude them and expect `0`:

```bash
docker exec womo-test-pg psql -U postgres -d womo_test -tAc \
  "select count(*) from analysis_phase_state
    where updated_at > now() - interval '2 minutes'
      and run_id not in ('11111111-1111-4111-8111-000000000009',
                         '11111111-1111-4111-8111-000000000012')"
```

Anything above `0` means the worker wrote to a fixture — re-seed and recapture.

**Re-seed (`pnpm harness:seed`) if more than ~8 minutes have passed.** Those two
`running` rows cross the 10-minute `STALE_RUNNING_MS` threshold, get reclaimed
to `pending`, and then genuinely do become schedulable — at which point the
worker will try to scrape `lior.benavides` for real.

The log is the other confirmation. The only campaign the worker ever picks up is
the legacy-platform one, and it refuses it without writing — repeated once per
poll (every 5s), which is expected and harmless:

```
[queue] draining 1 campaign(s)
[queue] …0010: platform YouTube has no registered phase toolset — skipping
```

Any *other* run id appearing in a `draining` line means a fixture became
schedulable. Stop, re-seed, recapture.

### The one state that cannot be forced

A plain `queued` TikTok row. It is schedulable by definition, so the worker
would scrape it for real. `anders.holt` forces the *rendering* via a legacy
platform — `processCampaign` refuses it through `isRunnableSubject` and returns
without writing — but a genuinely queued campaign has to be observed naturally,
by queueing one against the real database and looking within the first few
seconds.

## Natural runs

Forced states prove the rendering. They do not prove the rendering matches
reality. For that, queue real campaigns against the shared database and compare
what is displayed against what the ledger holds:

```bash
pnpm start:local                                   # the real database
pnpm exec tsx tools/queue-state-harness/ledger.ts  # the ledger's own account
pnpm exec tsx tools/queue-state-harness/capture-natural.ts creator natural-run
```

`ledger.ts` prints each campaign's phase statuses, failure classes, blocked
gaps, park gates and `deriveCampaignState` verdict. Compare row by row against
the UI. **Label every screenshot natural or forced** — a forced state presented
as a natural one is a claim the harness cannot support.

## `wren.castellano` — a deliberate disagreement

This fixture is not a rendering case; it is a **server finding kept visible**.

`deriveCampaignState` checks `genuine_empty → complete` *before* it checks for a
live park. So a campaign whose `transcribe` is parked with a real future retry
time, and whose gate then refused with `PRECONDITION_FAILED`, reports
`complete` — while a phase is still gated to run again.

The client does **not** override this. It renders both facts and says they
disagree. If a server session fixes the ordering, this fixture's rendering
changes, and that is the point: it is a live regression test for a known,
unfixed defect. Do not delete it to make the screenshot tidy.

## Measuring before adding a per-row fetch

`measure.ts` times `listCampaigns` and `getRunDiagnostics` against whatever
`DATABASE_URL` points at. It is read-only and safe against production.

It exists because capture health looks cheap and is not. Measured against the
shared database with 49 of 50 campaigns committed:

```
listCampaigns(50, includeTerminal)   1821 ms      ← this is the poll itself
getRunDiagnostics                     426 ms mean (n=8)
8 in parallel                         964 ms
```

Which is why the row shows capture health **from cache only** and never fetches
it. Re-run this before putting any per-campaign query behind the queue's poll.

## Files

| file | what it does |
|---|---|
| `seed-states.sql` | the 14 fixtures, each annotated with the state it produces |
| `capture.ts` | screenshots every forced state, one file per state |
| `capture-natural.ts` | screenshots a page against whatever database is live |
| `ledger.ts` | prints the ledger's own account, for comparison against the UI |
| `measure.ts` | times the queue's reads before anything is added to them |
