import { describe, expect, it } from "vitest";
import { rejectedIfContext } from "./rejectedIfContext.js";
import type { Workflow } from "../types.js";

const wf = (v: unknown): Workflow => v as Workflow;

describe("rejectedIfContext", () => {
  it("names the job whose guard reads a refused context", () => {
    expect(rejectedIfContext(wf({ jobs: { a: { if: "${{ secrets.X != '' }}" } } }))).toBe(
      "job 'a' if: reads secrets, unavailable there: startup failure",
    );
    expect(rejectedIfContext(wf({ jobs: { a: { if: "${{ env.FOO != '' }}" } } }))).toBe(
      "job 'a' if: reads env, unavailable there: startup failure",
    );
  });

  it("names the job whose step guard reads a refused context", () => {
    expect(
      rejectedIfContext(wf({ jobs: { a: { steps: [{ if: "${{ secrets.X }}", run: "true" }] } } })),
    ).toBe("a step of job 'a' if: reads secrets, unavailable there: startup failure");
  });

  it("fails the file on a refused guard anywhere in it, valid siblings included", () => {
    const answer = rejectedIfContext(
      wf({ jobs: { ok: { steps: [{ run: "true" }] }, bad: { if: "secrets.X != ''" } } }),
    );
    expect(answer).toBe("job 'bad' if: reads secrets, unavailable there: startup failure");
  });

  it("passes a workflow whose guards read only what GitHub allows", () => {
    expect(
      rejectedIfContext(
        wf({
          jobs: {
            a: {
              if: "github.event_name == 'pull_request'",
              steps: [{ if: "env.FOO == 'y'", run: "true" }],
            },
          },
        }),
      ),
    ).toBeNull();
  });

  it("reads nothing out of a workflow with no jobs or no guards", () => {
    expect(rejectedIfContext(wf({}))).toBeNull();
    expect(rejectedIfContext(wf({ jobs: { a: { "runs-on": "ubuntu-latest" } } }))).toBeNull();
  });

  it("ignores entries that are not maps", () => {
    expect(rejectedIfContext(wf({ jobs: { a: null, b: ["x"] } }))).toBeNull();
    expect(rejectedIfContext(wf({ jobs: { a: { steps: "not-a-list" } } }))).toBeNull();
    expect(rejectedIfContext(wf({ jobs: { a: { steps: [null, "x"] } } }))).toBeNull();
  });
});
