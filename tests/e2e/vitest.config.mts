import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    dir: "tests/e2e",
    // verify.test.ts is the mocked unit drive of verify.ts, colocated here with
    // its subject; it runs on every `pnpm test`, not in the live suite.
    exclude: [...defaultExclude, "**/verify.test.ts"],
    testTimeout: 300_000,
  },
});
