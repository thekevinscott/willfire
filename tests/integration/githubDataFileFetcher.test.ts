import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { predict } from "../../src/index.js";
import { replayClient, type RecordedCall } from "./replayClient.js";

interface Fixture {
  repo: string;
  pr: number;
  dispatched: { workflow: string; name: string; conclusion: string | null }[];
  calls: RecordedCall[];
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/github-data-file-fetcher-3.json", import.meta.url), "utf8"),
) as Fixture;

const run = () => predict(replayClient(fixture.calls), fixture.repo, fixture.pr);

// The whole-PR test: every check GitHub created, and nothing else.
test("github-data-file-fetcher#3 predicts the dispatched check list exactly", async () => {
  const { checkNames } = await run();
  expect(checkNames).toEqual([...new Set(fixture.dispatched.map((c) => c.name))].sort());
});

test("D1 — a workflow with no pull_request trigger does not dispatch", async () => {
  const { entries } = await run();
  expect(entries).toContainEqual(
    expect.objectContaining({
      workflow: ".github/workflows/docs.yml",
      status: "no-dispatch",
      reason: "no pull_request trigger",
    }),
  );
});

test("D2 — a bare pull_request trigger dispatches", async () => {
  const { entries } = await run();
  expect(entries).toContainEqual(
    expect.objectContaining({
      workflow: ".github/workflows/pr-monitor.yml",
      status: "run",
      checkName: "CI Gate",
    }),
  );
});

test("an unrecorded call fails by name rather than returning a stub", () => {
  const client = replayClient([]);
  expect(() => client.getPull({ owner: "o", repo: "r", pull_number: 1 })).toThrow(
    'replayClient: no recorded response for getPull({"owner":"o","pull_number":1,"repo":"r"})',
  );
});
