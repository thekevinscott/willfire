import { defineConfig, mergeConfig } from 'vitest/config';
import { vitestConfig } from 'testing-conventions';

// The same testing-conventions base the root package extends — v8 coverage at
// the 100/100/100/100 floor — so this package is held to the repo's standard.
export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      // Root-relative, so the suite is found whether Vitest's root is this
      // package or the `src/` the testing-conventions CLI points it at.
      include: ['**/*.test.ts'],
      coverage: {
        exclude: ['**/*.test.ts'],
        reporter: ['text', 'json-summary'],
      },
    },
  }),
);
