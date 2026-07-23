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
  },
});
