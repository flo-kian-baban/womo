# Postgres integration tests

Integration tests that exercise the real `server/db.ts` helpers against a
**disposable local Docker Postgres** — never production.

## Status: ⏳ pending activation

The harness (schema, seed chain, round-trip + cascade-delete assertions, config,
scripts) is complete and type-checks. It was **not executed end-to-end** in the
authoring session because the Docker daemon was not running there. Start Docker,
then run the three commands below to activate.

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

## What the example test covers

`db.integration.ts`:
1. Seeds `subject → observation → creator_observation` via the real helpers and asserts
   `getCreatorProfileById` round-trips fields (incl. bigint `follower_count` / `total_likes`).
2. Seeds a brand chain + a `match_scores` row, reads it via `getMatchWithProfiles`, then
   `deleteCreatorProfile(creatorId)` and asserts the observations, creator_observations, and the
   match row all **cascade-delete** (`match_scores.creator_subject_id → subjects ON DELETE CASCADE`).

Extend by adding more `*.integration.ts` files under this directory (e.g., signal_values/decoded_signals
round-trips, brand-side cascade, provenance writes).
