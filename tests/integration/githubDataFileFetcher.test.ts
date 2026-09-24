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

test("github-data-file-fetcher#3 predicts the dispatched check list exactly", async () => {
  const { checkNames } = await predict(replayClient(fixture.calls), fixture.repo, fixture.pr);
  expect(checkNames).toEqual([...new Set(fixture.dispatched.map((c) => c.name))].sort());
});
