import { describe, expect, it } from "vitest";
import { executeGranted } from "./executeGranted.js";
import type { Scope } from "../expr/val.js";
import type { ExecOutcome, JobExecutor } from "../execute/types.js";
import type { Workflow, WorkflowSource } from "../types.js";

const SHA = "a".repeat(40);
const SOURCE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };
const WF = {} as Workflow;

const executorOf = (
  grantedIds: string[],
  results: Record<string, ExecOutcome>,
  calls: string[] = [],
): JobExecutor => ({
  granted: (_source, jobId) => grantedIds.includes(jobId),
  executeJob: async (jobId) => {
    calls.push(jobId);
    return results[jobId];
  },
});

describe("executeGranted", () => {
  it("returns the scope untouched without an executor", async () => {
    const scope: Scope = { github: { repository: "o/r" } };
    const res = await executeGranted({ a: {} as Workflow }, WF, scope, SOURCE, undefined);
    expect(res.scoped).toBe(scope);
    expect(res.failures).toEqual({});
  });

  it("executes only granted jobs", async () => {
    const calls: string[] = [];
    const ex = executorOf(["a"], { a: { ok: true, outputs: {} } }, calls);
    await executeGranted({ a: {} as Workflow, b: {} as Workflow }, WF, {}, SOURCE, ex);
    expect(calls).toEqual(["a"]);
  });

  it("does not execute a job whose guard is not run", async () => {
    const calls: string[] = [];
    const ex = executorOf(["a", "b"], { b: { ok: true, outputs: {} } }, calls);
    const jobs = {
      a: { if: false } as Workflow,
      b: { if: "inputs.x == 'v'" } as Workflow,
    };
    await executeGranted(jobs, WF, {}, SOURCE, ex);
    expect(calls).toEqual([]);
  });

  it("merges a successful execution's outputs into the scope", async () => {
    const ex = executorOf(["a"], { a: { ok: true, outputs: { x: "1" } } });
    const res = await executeGranted({ a: null as unknown as Workflow }, WF, {}, SOURCE, ex);
    expect(res.scoped).toEqual({ needs: { a: { outputs: { x: "1" } } } });
    expect(res.failures).toEqual({});
  });

  it("lets a later granted job's guard read an earlier job's outputs", async () => {
    const calls: string[] = [];
    const ex = executorOf(
      ["a", "b"],
      { a: { ok: true, outputs: { x: "1" } }, b: { ok: true, outputs: {} } },
      calls,
    );
    const jobs = {
      a: {} as Workflow,
      b: { if: "needs.a.outputs.x == '1'" } as Workflow,
    };
    await executeGranted(jobs, WF, {}, SOURCE, ex);
    expect(calls).toEqual(["a", "b"]);
  });

  it("records a failed execution's reason and leaves the scope alone", async () => {
    const ex = executorOf(["a"], { a: { ok: false, reason: "boom" } });
    const scope: Scope = {};
    const res = await executeGranted({ a: {} as Workflow }, WF, scope, SOURCE, ex);
    expect(res.scoped).toBe(scope);
    expect(res.failures).toEqual({ a: "boom" });
  });
});
