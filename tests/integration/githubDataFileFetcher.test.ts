import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { predict, type Prediction } from "willfire";
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

// `run` vs `skipped` per check name, derived from each job's GitHub conclusion
// (`skipped` -> skipped, anything else -> run). Optional: a case that only
// pins the name list omits the file.
const getStatuses = (dir: string): Record<string, string> | null => {
  const path = join(dir, "statuses.json");
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>)
    : null;
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

// The name list alone cannot see a wrong boolean: a job whose `if:` willfire
// decided backwards still contributes its name. The conclusions separate them.
test.each(CASES.filter((c) => getStatuses(c.dir) !== null))(
  "$title predicts each entry's run-or-skipped status",
  async (c) => {
    const expected = getStatuses(c.dir);
    const actual: Record<string, string> = {};
    for (const e of (await predictOnce(c)).entries) {
      if (e.checkName !== null) {
        actual[e.checkName] = e.status;
      }
    }
    expect(actual).toEqual(expected);
  },
  300_000,
);
