import { describe, expect, it } from "vitest";
import { finalize } from "./finalize.js";
import type { DraftEntry, JobName } from "../types.js";

const WF = ".github/workflows/w.yml";
// The brand constructor lives in entries/, which is not this unit's
// collaborator; the cast is the same claim it would make.
const j = (name: string) => name as JobName;

describe("finalize", () => {
  it("settles a workflow-level draft's checkName to null", () => {
    const wf: DraftEntry = { workflow: WF, job: "*", status: "no-dispatch", reason: "no PR trigger" };
    expect(finalize(wf)).toEqual({ ...wf, checkName: null });
  });

  it("nulls a workflow-level draft's checkName even when one is carried", () => {
    // `DraftWorkflowEntry` omits `checkName` rather than forbidding it, so a
    // spread can carry one; passing it through would name a "run" workflow.
    const carried = {
      workflow: WF,
      job: "*" as const,
      status: "run" as const,
      reason: "YAML parse error: bad indent",
      checkName: "A",
    };
    const draft: DraftEntry = carried;
    expect(finalize(draft)).toEqual({ ...carried, checkName: null });
  });

  it("settles an omitted job checkName to null and keeps a given one", () => {
    const drafted: DraftEntry = {
      workflow: WF,
      job: j("a"),
      status: "unknown",
      reason: "dynamic matrix",
    };
    expect(finalize(drafted).checkName).toBeNull();
    expect(finalize({ ...drafted, checkName: "A" }).checkName).toBe("A");
  });
});
