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

// A case dir usually holds a byte-identical copy of its parent recording, and
// a sandbox-executing replay costs minutes — share one prediction per
// distinct recording instead of recomputing an identical answer per case.
const recordingKey = (owner: string, repo: string, pr: number, dir: string): string => {
  const h = createHash("sha256");
  for (const f of readdirSync(dir)
    .filter((f) => f === "calls.json" || f.endsWith(".bin"))
    .sort()) {
    h.update(f).update(readFileSync(join(dir, f)));
  }
  return `${owner}/${repo}#${pr}:${h.digest("hex")}`;
};

const predictions = new Map<string, Promise<string[]>>();

const predictOnce = (owner: string, repo: string, pr: number, dir: string): Promise<string[]> => {
  const key = recordingKey(owner, repo, pr, dir);
  let prediction = predictions.get(key);
  if (prediction === undefined) {
    prediction = predict(replayClient(getCalls(dir)), `${owner}/${repo}`, pr).then(
      ({ checkNames }) => checkNames,
    );
    predictions.set(key, prediction);
  }
  return prediction;
};

test.each(CASES)(
  "$title predicts the dispatched check list exactly",
  async ({ owner, repo, pr, dir }) => {
    expect(await predictOnce(owner, repo, pr, dir)).toEqual(getResponse(dir));
  },
  // A replay with a runtime-computed matrix runs the docker sandbox, and CI
  // provisions the image inside the first such test.
  300_000,
);
