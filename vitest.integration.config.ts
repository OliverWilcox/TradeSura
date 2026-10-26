import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests: real route handlers against the local Docker database
// (docker-compose.yml, database tradesura_test). `npm test` doesn't run these.
//   npm run db:up && npm run test:integration
export default defineConfig({
  test: {
    include: ["tests-integration/**/*.test.ts"],
    globalSetup: ["tests-integration/global-setup.ts"],
    setupFiles: ["tests-integration/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
