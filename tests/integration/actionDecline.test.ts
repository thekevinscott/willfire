// Read back from a live dispatch on thekevinbot/willrun-probe PR #15, the
// probe's only workflow with a step-level action. GitHub ran three checks off
// `action-decline.yml`: `action-gen`, `action-use (r)` and `action-use (s)`.
// willfire names the first and refuses the other two, because the producer's
// `actions/setup-node` step carries an input the executor does not model, so
// the consumer's matrix has no value to expand. The two names GitHub created
// are a deliberate under-prediction; the day that input is modelled, this file
// gets them.

import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { expandWorkflowJobs, type SourceRef, type WorkflowSource } from "../../src/index.js";
import { makeExecutor } from "../../src/execute/makeExecutor.js";

const HEAD: WorkflowSource = {
  owner: "thekevinbot",
  repo: "willrun-probe",
  ref: "headsha",
  sha: "headsha",
};

const resolveRef = async (source: SourceRef) => source.ref;

const workflow = parseYaml(
  readFileSync(
    fileURLToPath(
      new URL("../fixtures/willrun-probe/.github/workflows/action-decline.yml", import.meta.url),
    ),
    "utf8",
  ),
);

const executor = makeExecutor({
  workspace: HEAD,
  deps: {
    // The refusal lands before any step reads the workspace or opens a shell,
    // so an existing directory is enough to reach it.
    provideTree: async () => tmpdir(),
    runCommand: async () => {
      throw new Error("no step should reach a shell");
    },
    resolveRef,
    // Matches the workflow's `node-version: 20`, so the refusal is about the
    // extra input and nothing else.
    nodeMajor: 20,
  },
});

test("a step the executor refuses leaves the consumer honestly undecided", async () => {
  const entries = await expandWorkflowJobs(
    workflow,
    { action: "opened", baseRef: "main", files: ["src/action-decline.txt"] },
    { fetchWorkflow: async () => null, resolveRef },
    HEAD,
    {},
    executor,
  );
  expect(entries).toEqual([
    { job: "action-gen", checkName: "action-gen", status: "run", reason: "" },
    {
      job: "action-use",
      checkName: null,
      status: "unknown",
      reason:
        "dynamic matrix; executing 'action-gen' failed: " +
        "step 'setup-node with an input beyond node-version': " +
        "setup-node with inputs beyond node-version is not modelled",
    },
  ]);
});
