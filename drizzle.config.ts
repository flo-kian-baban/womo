/**
 * TYPES ONLY — this DB is Supabase-migration-managed; do NOT run drizzle-kit
 * (migrate / push / generate) against production. There is no drizzle
 * __drizzle_migrations ledger in this database, so drizzle-kit would attempt to
 * recreate every object. Make schema changes via a Supabase migration
 * (apply_migration), then mirror them into drizzle/schema.ts for types.
 * See docs/STORAGE_MODEL.md.
 */
import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
