import { defaultExclude, defineConfig } from 'vitest/config';

// Deliberately does not extend testing-conventions' published vitest base: that
// base exists to carry the 100/100/100/100 floor, and willfire enforces no
// coverage floor. `pnpm test:coverage` reports; it never fails on a number.
export default defineConfig({
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
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', '**/*.test.ts'],
      // Vitest 4 forces `skipFull: true` onto the text reporter whenever
      // std-env reports an AI agent, which suppresses every fully covered row.
      // An explicit value survives that override.
      reporter: [['text', { skipFull: false }], 'json-summary'],
    },
  },
});
