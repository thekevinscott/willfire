import { describe, expect, it } from "vitest";
import { workflowEntries } from "./workflowEntries.js";
import type { Ctx, WorkflowReader, WorkflowSource } from "../types.js";

const SHA = "a".repeat(40);
const SOURCE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };
const CTX: Ctx = { action: "opened", baseRef: "main", files: ["src/app.ts"] };
const WF = ".github/workflows/w.yml";

const readerFor = (files: Record<string, string>): WorkflowReader => ({
  fetchWorkflow: async (path) => files[path] ?? null,
  resolveRef: async (src) => src.ref,
});

const entriesFor = (files: Record<string, string>, state = "active") =>
  workflowEntries({ path: WF, state }, CTX, readerFor(files), SOURCE, {});

describe("workflowEntries", () => {
  it("reports an inactive workflow as no-dispatch", async () => {
    const entries = await entriesFor({}, "disabled_manually");
    expect(entries).toEqual([
      {
        workflow: WF,
        job: "*",
        status: "no-dispatch",
        reason: "workflow state: disabled_manually",
      },
    ]);
  });

  it("reports a listed workflow with no file at head as no-dispatch", async () => {
    const entries = await entriesFor({});
    expect(entries).toEqual([
      { workflow: WF, job: "*", status: "no-dispatch", reason: "no workflow file at head" },
    ]);
  });

  it("reports an unparseable workflow as a run with no jobs", async () => {
    const entries = await entriesFor({ [WF]: "jobs:\n  a: [unclosed\n" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ workflow: WF, job: "*", status: "run" });
    expect(entries[0].reason).toMatch(/^YAML parse error: /);
  });

  it("reports a workflow whose trigger does not match as no-dispatch", async () => {
    const entries = await entriesFor({ [WF]: JSON.stringify({ on: "push", jobs: { a: {} } }) });
    expect(entries).toEqual([
      { workflow: WF, job: "*", status: "no-dispatch", reason: "no pull_request trigger" },
    ]);
  });

  it("expands the jobs of a dispatching workflow, dispatch reason as the fallback", async () => {
    const entries = await entriesFor({
      [WF]: JSON.stringify({
        on: { pull_request: null },
        jobs: { a: {}, b: { if: false } },
      }),
    });
    expect(entries).toEqual([
      { workflow: WF, job: "a", checkName: "a", status: "run", reason: "trigger matched" },
      { workflow: WF, job: "b", checkName: "b", status: "skipped", reason: "if: false" },
    ]);
  });
});
