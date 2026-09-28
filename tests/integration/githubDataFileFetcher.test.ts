import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
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

const predictions = new Map<string, Promise<string[]>>();

const predictOnce = (c: Case): Promise<string[]> => {
  const key = recordingKey(c);
  let prediction = predictions.get(key);
  if (prediction === undefined) {
    prediction = predict(replayClient(getCalls(c.dir)), `${c.owner}/${c.repo}`, c.pr, {
      action: c.action,
    }).then(({ checkNames }) => checkNames);
    predictions.set(key, prediction);
  }
  return prediction;
};

test.each(CASES)(
  "$title predicts the dispatched check list exactly",
  async (c) => {
    expect(await predictOnce(c)).toEqual(getResponse(c.dir));
  },
  // A replay with a runtime-computed matrix runs the docker sandbox, and CI
  // provisions the image inside the first such test.
  300_000,
);
