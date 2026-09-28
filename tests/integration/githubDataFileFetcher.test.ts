import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { predict } from "willfire";
import { discoverCases } from "../cases.js";
import { getResponse } from "../getResponse.js";
import { getCalls } from "./getCalls.js";
import { replayClient } from "./mocks/replayClient.js";

const CASES = discoverCases(new URL("./fixtures/", import.meta.url)).map((c) => ({
  ...c,
  title: c.caseId === undefined ? `${c.owner}/${c.repo}#${c.pr}` : `${c.owner}/${c.repo}#${c.pr} case ${c.caseId}`,
}));

type Case = (typeof CASES)[number];

// A case dir usually holds a byte-identical copy of its parent recording, and
// a sandbox-executing replay costs minutes — share one prediction per
// distinct recording (and event action) instead of recomputing an identical
// answer per case.
const recordingKey = (c: Case): string => {
  const h = createHash("sha256");
  for (const f of readdirSync(c.dir)
    .filter((f) => f === "calls.json" || f.endsWith(".bin"))
    .sort()) {
    h.update(f).update(readFileSync(join(c.dir, f)));
  }
  return `${c.owner}/${c.repo}#${c.pr}:${c.action ?? ""}:${h.digest("hex")}`;
};

type Prediction = Awaited<ReturnType<typeof predict>>;

const predictions = new Map<string, Promise<Prediction>>();

const predictOnce = (c: Case): Promise<Prediction> => {
  const key = recordingKey(c);
  let prediction = predictions.get(key);
  if (prediction === undefined) {
    prediction = predict(replayClient(getCalls(c.dir)), `${c.owner}/${c.repo}`, c.pr, {
      action: c.action,
    });
    predictions.set(key, prediction);
  }
  return prediction;
};

test.each(CASES)(
  "$title predicts the dispatched check list exactly",
  async (c) => {
    expect((await predictOnce(c)).checkNames).toEqual(getResponse(c.dir));
  },
  // A replay with a runtime-computed matrix runs the docker sandbox, and CI
  // provisions the image inside the first such test.
  300_000,
);

// A skipped job still gets a check run, so a matching name list can hide a
// wrong verdict. `statuses.json` records what GitHub reported per dispatched
// check — `skipped`, or run — for the cases where that distinction is the case.
const STATUS_CASES = CASES.filter((c) => existsSync(join(c.dir, "statuses.json")));

test.each(STATUS_CASES)(
  "$title predicts each dispatched check's status",
  async (c) => {
    const expected = JSON.parse(readFileSync(join(c.dir, "statuses.json"), "utf8")) as Record<
      string,
      string
    >;
    const { entries } = await predictOnce(c);
    const actual = Object.fromEntries(
      Object.keys(expected).map((name) => [
        name,
        entries.find((e) => e.checkName === name)?.status,
      ]),
    );
    expect(actual).toEqual(expected);
  },
  300_000,
);
