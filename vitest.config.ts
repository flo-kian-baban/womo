import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
    // Test-only env so env.ts (ENV.cookieSecret / ENV.pinCode) is populated when the
    // auth modules load under vitest. These are NOT production secrets.
    env: {
      JWT_SECRET: "test-jwt-secret-do-not-use-in-prod-0123456789abcdef",
      PIN_CODE: "1234",
    },
  },
});
