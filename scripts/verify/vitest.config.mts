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
        // Vitest 4 forces `skipFull: true` onto the text reporter whenever
        // std-env reports an AI agent, which at 100% coverage suppresses every
        // row and the `All files` total, leaving a header-only table. An
        // explicit value survives that override.
        reporter: [['text', { skipFull: false }], 'json-summary'],
      },
    },
  }),
);
