# Postgres integration tests

Integration tests that exercise the real `server/db.ts` helpers against a
**disposable local Docker Postgres** — never production.

## Status: ✅ active

Runs end-to-end against Docker Postgres (first executed in Session 5, 2026-07-23).
Two latent harness bugs were fixed at activation: pg_dump emits psql
meta-commands (`\restrict`/`\unrestrict`) and its own `CREATE SCHEMA public;`,
neither of which the `pg` driver can execute after the harness's own
`CREATE SCHEMA` — both are filtered out when `schema.sql` is loaded, so future
`pg_dump` regenerations need no hand-editing.

## Run

```bash
pnpm test:db:up        # docker run postgres:17-alpine, listening on localhost:55432
pnpm test:integration  # applies schema.sql to a clean DB, seeds, asserts round-trip + cascade
pnpm test:db:down      # remove the container
```

`test:integration` sets `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/womo_test`
and runs `vitest --config vitest.integration.config.ts` (which includes only
`server/integration/**/*.integration.ts`). If `TEST_DATABASE_URL` is unset the suite
`describe.skip`s, so the default `pnpm test` never needs Docker.

## How the schema is applied (important)

**drizzle-kit is intentionally blocked** against the live DB (it is Supabase-migration-managed;
see [`docs/STORAGE_MODEL.md`](../../docs/STORAGE_MODEL.md)). The integration DB is instead built
from **`schema.sql`**, a schema-only structural mirror of production generated with:

```bash
pg_dump "$DATABASE_URL" --schema=public --schema-only --no-owner --no-privileges --file=server/integration/schema.sql
```

`beforeAll` runs `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` then applies `schema.sql`,
giving each run a clean, production-identical structure (21 tables, 24 enums, all constraints/indexes;
no extensions needed — UUID PKs use core `gen_random_uuid()`).

**Regenerate `schema.sql`** with the `pg_dump` command above whenever a Supabase migration changes
the schema, so the integration structure stays in sync.

## What the tests cover

`persistence.integration.ts` (Session 5 — persistence integrity, hybrid model):
1. **Atomic core rollback** (creator + brand): a constraint violation at a known
   mid-core step (varchar overflow / bad real cast) rolls back the whole
   subject → handle → observation → subtype chain — no orphans.
2. **Enrichment failure isolation**: a poisoned `signal_values` write fails and
   is recorded (`failed` + root-cause reason) while the core and sibling
   enrichments (decoded_signals) still save.
3. **`persistence_status` truth**: returned map == stored JSONB == actual row
   counts, including the `skipped_no_data` vs `skipped_not_attempted` distinction
   on the brand path.

`db.integration.ts`:
1. Seeds `subject → observation → creator_observation` via the real helpers and asserts
   `getCreatorProfileById` round-trips fields (incl. bigint `follower_count` / `total_likes`).
2. Seeds a brand chain + a `match_scores` row, reads it via `getMatchWithProfiles`, then
   `deleteCreatorProfile(creatorId)` and asserts the observations, creator_observations, and the
   match row all **cascade-delete** (`match_scores.creator_subject_id → subjects ON DELETE CASCADE`).

Extend by adding more `*.integration.ts` files under this directory (e.g., signal_values/decoded_signals
round-trips, brand-side cascade, provenance writes).
