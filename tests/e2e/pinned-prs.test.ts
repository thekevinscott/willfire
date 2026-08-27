import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { isJobEntry, type Prediction } from "../../src/index.js";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));

const tsx = (args: string[]) =>
  exec(join(root, "node_modules/.bin/tsx"), args, { cwd: root });

const PROBE_PR8_CHECKS = [
  "Caller Label / Inner Label",
  "Caller Label / inner",
  "Caller Label / inner-matrix (1)",
  "Caller Label / inner-matrix (2)",
  "Custom Name",
  "Static Label (x)",
  "Static Label (y)",
  "alpha",
  "beta job",
  "build x-p",
  "build y-p",
  "call-it / inner-matrix (a)",
  "call-it / inner-matrix (b)",
  "call-it / inner-one",
  "call-matrix (a) / Inner Label",
  "call-matrix (a) / inner",
  "call-matrix (a) / inner-matrix (1)",
  "call-matrix (a) / inner-matrix (2)",
  "call-matrix (b) / Inner Label",
  "call-matrix (b) / inner",
  "call-matrix (b) / inner-matrix (1)",
  "call-matrix (b) / inner-matrix (2)",
  "call-nested / Mid Call / Inner Label",
  "call-nested / Mid Call / inner",
  "call-nested / Mid Call / inner-matrix (1)",
  "call-nested / Mid Call / inner-matrix (2)",
  "call-nested / mid",
  "call-plain / Inner Label",
  "call-plain / inner",
  "call-plain / inner-matrix (1)",
  "call-plain / inner-matrix (2)",
  "cm a / Inner Label",
  "cm a / inner",
  "cm a / inner-matrix (1)",
  "cm a / inner-matrix (2)",
  "cm b / Inner Label",
  "cm b / inner",
  "cm b / inner-matrix (1)",
  "cm b / inner-matrix (2)",
  "dependent-always",
  "ev pull_request",
  "gamma",
  "gen",
  "hello",
  "into-main",
  "m-auto (x, 1)",
  "m-auto (x, 2)",
  "m-auto (y, 1)",
  "m-auto (y, 2)",
  "m-exclude (x, p)",
  "m-exclude (x, q)",
  "m-exclude (y, p)",
  "m-include (x)",
  "m-include (y)",
  "m-include (z)",
  "m-include-noaxis (x)",
  "m-include-noaxis (y)",
  "m-include-only (1)",
  "m-include-only (2)",
  "m-include-only2 (1, one)",
  "m-include-only2 (2)",
  "m-include-overwrite (x, p)",
  "m-include-overwrite (x, q)",
  "m-include-overwrite (y, p)",
  "m-include2 (x)",
  "m-include2 (z, e2)",
  "m-numeric (18)",
  "m-numeric (20.5)",
  "m-object (linux, x64)",
  "m-object (mac, arm64)",
  "main-and-src",
  "non-docs",
  "non-vendor-src",
  "on pull_request",
  "p x",
  "plain-job",
  "pr-only",
  "src-changed",
  "test (1.0, fast)",
  "test (1.0, slow)",
  "test (2.0, fast)",
  "test (3.0)",
];

test("probe PR #8 predicts exactly the checks GitHub dispatched", async () => {
  const { stdout } = await tsx(["src/cli.ts", "--repo", "thekevinbot/willrun-probe", "--pr", "8", "--json"]);
  const prediction = JSON.parse(stdout) as Prediction;
  expect(prediction.checkNames).toEqual(PROBE_PR8_CHECKS);
  expect(prediction.skip).toBeNull();
  const undecided = prediction.entries
    .filter(isJobEntry)
    .filter((e) => e.status === "unknown" || e.checkName === null);
  expect(undecided.map((e) => `${e.workflow} :: ${e.job}`)).toEqual([
    ".github/workflows/dynamic-matrix.yml :: use",
  ]);
});

// Live verify pins: each PR's predicted run set must match what GitHub
// actually dispatched (verify.ts tolerates `unknown` entries — only
// MISS/OVER/DIFF fail). Probe PRs pin exact rules; the fleet PRs below pin
// real-world workflow shapes the probe repo does not exercise (release
// matrices, reusable-workflow e2e fixtures, testing-conventions dispatch).
// Every entry was read off a live dispatch, not invented — see AGENTS.md.
for (const [repo, pr] of [
  ["thekevinbot/willrun-probe", 8],
  ["thekevinbot/willrun-probe", 9],
  ["thekevinscott/willfire", 34],
  ["thekevinscott/dirsql", 1000],
  ["thekevinscott/dirsql", 1014],
  ["thekevinscott/putitoutthere", 647],
  ["thekevinscott/putitoutthere", 649],
  ["thekevinscott/pr-monitor", 24],
  ["thekevinscott/pr-monitor", 26],
] as const) {
  test(`${repo}#${pr}: predicted set matches what GitHub dispatched`, async () => {
    const { stdout } = await tsx(["src/verify.ts", "--repo", repo, "--pr", String(pr)]);
    const lines = stdout.trimEnd().split("\n");
    expect(lines[lines.length - 1]).toBe("PASS");
  });
}
