import { defaultExclude, defineConfig, mergeConfig } from 'vitest/config';
import { vitestConfig } from 'testing-conventions';

// Extends testing-conventions' published vitest base — v8 coverage over
// `src/**/*.ts` at the 100/100/100/100 floor — so a local `pnpm test:coverage`
// is held to the same standard the CI gate enforces. Keep the block below to
// project-specific overrides only; the floor itself lives upstream.
export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      // The base glob is relative to Vitest's root — the repo root for a normal
      // `pnpm test`, but `src/` when the testing-conventions CLI invokes Vitest
      // there. This root-relative pattern finds the suite under either root.
      include: ['**/*.test.ts'],
      // `scripts/*` are their own workspace packages with their own configs and
      // their own conventions.yml call; this suite is willfire's alone. Nested
      // git worktrees are checkouts of other branches, not part of this tree;
      // collecting them runs a stale suite against code that is not here.
      exclude: [
        ...defaultExclude,
        'tests/e2e/**',
        'scripts/**',
        '**/.worktrees/**',
        '**/.claude/worktrees/**',
      ],
      coverage: {
        // The CLI measures the whole `src/` tree and ignores these excludes; they
        // only scope the local `pnpm test:coverage` report. mergeConfig concatenates,
        // so they add to the base's `src/**/*.d.ts` rather than replacing it.
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
