import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    dir: "tests/e2e",
    include: ["**/*.test.ts"],
    testTimeout: 300_000,
  },
});
