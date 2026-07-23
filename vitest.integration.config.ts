import { defineConfig } from "vitest/config";
import path from "path";

// Separate config for Postgres integration tests (require a local Docker
// Postgres, activated via `pnpm test:integration`). Kept out of the default
// `pnpm test` so unit/golden runs never need Docker.
const root = path.resolve(import.meta.dirname);

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@": path.resolve(root, "client", "src"),
      "@shared": path.resolve(root, "shared"),
      "@assets": path.resolve(root, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/integration/**/*.integration.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    // Each integration file drops + recreates the public schema in beforeAll —
    // files must run serially or they destroy each other's tables mid-test.
    fileParallelism: false,
    // Test-only env, mirrors vitest.config.ts (auth modules read ENV at import).
    env: {
      JWT_SECRET: "test-jwt-secret-do-not-use-in-prod-0123456789abcdef",
      PIN_CODE: "1234",
    },
  },
});
