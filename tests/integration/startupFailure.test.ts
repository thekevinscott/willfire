import { expect, test } from "vitest";
import { predict } from "willfire";
import { getCalls } from "./getCalls.js";
import { replayClient } from "./mocks/replayClient.js";

const DIR = new URL("./fixtures/thekevinscott/willfire/409/IFCTX/", import.meta.url).pathname;

// The IFCTX capture's own README records what each of these files did live:
// one zero-job `push` failure run each and no `pull_request` run at all. The
// case fixture asserts the names; this asserts the verdict behind them, which
// a name list cannot distinguish from a job that merely resolved no name.
test("a workflow GitHub refuses at startup contributes one no-dispatch entry", async () => {
  const { entries } = await predict(replayClient(getCalls(DIR)), "thekevinscott/willfire", 409, {
    action: "opened",
  });
  const refused = entries
    .filter((e) => /secr-[abcd]\.yml$/.test(e.workflow))
    .map((e) => ({ workflow: e.workflow, job: e.job, status: e.status }));
  expect(refused).toEqual([
    { workflow: ".github/workflows/secr-a.yml", job: "*", status: "no-dispatch" },
    { workflow: ".github/workflows/secr-b.yml", job: "*", status: "no-dispatch" },
    { workflow: ".github/workflows/secr-c.yml", job: "*", status: "no-dispatch" },
    { workflow: ".github/workflows/secr-d.yml", job: "*", status: "no-dispatch" },
  ]);
});
