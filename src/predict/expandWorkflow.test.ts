import { describe, expect, it } from "vitest";
import { expandWorkflow } from "./expandWorkflow.js";
import type { Scope } from "../expr/val.js";
import type { Ctx, WorkflowReader, WorkflowSource } from "../types.js";

const CTX: Ctx = { action: "opened", baseRef: "main", files: ["a.ts"] };
const HEAD: WorkflowSource = { owner: "o", repo: "r", ref: "deadbeef", sha: "deadbeef" };
const FACTS: Scope = { github: { repository: "o/r" } };
const WF = ".github/workflows/test.yml";

function readerOf(content: string | null, calls: string[] = []): WorkflowReader {
  return {
    fetchWorkflow: async (path) => {
      calls.push(path);
      return content;
    },
    resolveRef: async () => null,
  };
}

const expand = (w: { path: string; state: string }, content: string | null): Promise<unknown> =>
  expandWorkflow(w, CTX, readerOf(content), HEAD, FACTS, undefined);

describe("expandWorkflow", () => {
  it("ignores a listing outside .github/workflows", async () => {
    expect(await expand({ path: "dynamic/pages/x", state: "active" }, "on: pull_request\n")).toEqual(
      [],
    );
  });

  it("reports an inactive workflow without reading its file", async () => {
    const calls: string[] = [];
    const w = { path: WF, state: "disabled_manually" };
    expect(await expandWorkflow(w, CTX, readerOf("x", calls), HEAD, FACTS, undefined)).toEqual([
      { workflow: WF, job: "*", status: "no-dispatch", reason: "workflow state: disabled_manually" },
    ]);
    expect(calls).toEqual([]);
  });

  it("reports a workflow with no file at head", async () => {
    expect(await expand({ path: WF, state: "active" }, null)).toEqual([
      { workflow: WF, job: "*", status: "no-dispatch", reason: "no workflow file at head" },
    ]);
  });

  it("keeps an unparseable workflow as a workflow-level run", async () => {
    expect(await expand({ path: WF, state: "active" }, "{")).toEqual([
      {
        workflow: WF,
        job: "*",
        status: "run",
        reason: expect.stringMatching(/^YAML parse error: /),
      },
    ]);
  });

  it("reports a workflow the PR does not dispatch", async () => {
    expect(await expand({ path: WF, state: "active" }, "on: push\njobs:\n  a: {}\n")).toEqual([
      { workflow: WF, job: "*", status: "no-dispatch", reason: "no pull_request trigger" },
    ]);
  });

  it("expands jobs, filling the workflow reason where a job has none", async () => {
    const body = "on: pull_request\njobs:\n  a: {}\n  b:\n    if: false\n";
    expect(await expand({ path: WF, state: "active" }, body)).toEqual([
      { workflow: WF, job: "a", checkName: "a", status: "run", reason: "trigger matched" },
      { workflow: WF, job: "b", checkName: "b", status: "skipped", reason: "if: false" },
    ]);
  });
});
