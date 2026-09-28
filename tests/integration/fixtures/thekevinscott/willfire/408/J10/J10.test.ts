import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { predict } from "willfire";
import { getCalls } from "../../../../../getCalls.js";
import { replayClient } from "../../../../../mocks/replayClient.js";

test("J10 predicts the statuses of the vars-guarded jobs", async () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const conclusions = JSON.parse(readFileSync(new URL("./statuses.json", import.meta.url), "utf8")) as Record<string, string>;
  const { entries } = await predict(replayClient(getCalls(dir)), "thekevinscott/willfire", 408);
  const actual = Object.fromEntries(
    entries
      .filter((entry) => entry.workflow.startsWith(".github/workflows/probe-j10-"))
      .map(({ job, status }) => [job, status]),
  );
  const expected = Object.fromEntries(
    Object.entries(conclusions).map(([job, conclusion]) => [
      job,
      conclusion === "success" ? "run" : "skipped",
    ]),
  );
  expect(actual).toEqual(expected);
}, 300_000);
