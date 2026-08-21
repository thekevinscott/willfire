import { describe, expect, it } from "vitest";
import { workflowDispatches } from "./workflowDispatches.js";
import type { Ctx, Workflow } from "../types.js";

const CTX: Ctx = { action: "opened", baseRef: "main", files: ["src/app.ts"] };

const onPr = (trigger: unknown): Workflow => ({ on: { pull_request: trigger } });

describe("workflowDispatches", () => {
  it("declines a workflow with no pull_request trigger", () => {
    expect(workflowDispatches({ on: { push: null } }, CTX)).toEqual([
      false,
      "no pull_request trigger",
    ]);
  });

  it("declines an event action outside the declared types", () => {
    expect(workflowDispatches(onPr({ types: ["labeled"] }), CTX)).toEqual([
      false,
      "action 'opened' not in types [labeled]",
    ]);
  });

  it("accepts the default types when none are declared", () => {
    expect(workflowDispatches(onPr(null), CTX)).toEqual([true, "trigger matched"]);
  });

  // Both-filters is invalid config. GitHub does not fall back to "no filter"
  // and does not skip the workflow: it creates the run and concludes
  // `startup_failure`. The run exists, so the workflow dispatches (#7).

  it("dispatches when both branches and branches-ignore are set", () => {
    expect(
      workflowDispatches(onPr({ branches: ["main"], "branches-ignore": ["main"] }), CTX),
    ).toEqual([true, "both branches and branches-ignore set: startup failure"]);
  });

  it("dispatches when both paths and paths-ignore are set", () => {
    expect(
      workflowDispatches(onPr({ paths: ["**"], "paths-ignore": ["**"] }), CTX),
    ).toEqual([true, "both paths and paths-ignore set: startup failure"]);
  });

  it("checks the conflicting filters before evaluating either one", () => {
    // `branches: [dev]` alone would decline on a `main` base. The
    // startup-failure verdict has to win.
    const [dispatches] = workflowDispatches(
      onPr({ branches: ["dev"], "branches-ignore": ["dev"] }),
      CTX,
    );
    expect(dispatches).toBe(true);
  });

  it("declines a base branch outside branches", () => {
    expect(workflowDispatches(onPr({ branches: ["releases/*"] }), CTX)).toEqual([
      false,
      "base branch 'main' not in branches",
    ]);
  });

  it("accepts a base branch inside branches", () => {
    expect(workflowDispatches(onPr({ branches: ["main"] }), CTX)).toEqual([
      true,
      "trigger matched",
    ]);
  });

  it("declines a base branch inside branches-ignore", () => {
    expect(workflowDispatches(onPr({ "branches-ignore": ["main"] }), CTX)).toEqual([
      false,
      "base branch in branches-ignore",
    ]);
  });

  it("accepts a base branch outside branches-ignore", () => {
    expect(workflowDispatches(onPr({ "branches-ignore": ["dev"] }), CTX)[0]).toBe(true);
  });

  it("declines when no changed file matches paths", () => {
    expect(workflowDispatches(onPr({ paths: ["docs/**"] }), CTX)).toEqual([
      false,
      "no changed file matches paths",
    ]);
  });

  it("accepts when one changed file matches paths", () => {
    const ctx: Ctx = { ...CTX, files: ["src/app.ts", "docs/a.md"] };
    expect(workflowDispatches(onPr({ paths: ["docs/**"] }), ctx)[0]).toBe(true);
  });

  it("declines when every changed file matches paths-ignore", () => {
    const ctx: Ctx = { ...CTX, files: ["docs/a.md", "docs/b.md"] };
    expect(workflowDispatches(onPr({ "paths-ignore": ["docs/**"] }), ctx)).toEqual([
      false,
      "all changed files match paths-ignore",
    ]);
  });

  it("accepts when one changed file escapes paths-ignore", () => {
    const ctx: Ctx = { ...CTX, files: ["docs/a.md", "src/app.ts"] };
    expect(workflowDispatches(onPr({ "paths-ignore": ["docs/**"] }), ctx)[0]).toBe(true);
  });

  // Stacked PRs (#30): `branches:` is evaluated against the stack's terminal
  // target, and a declining reason names it.

  const STACKED: Ctx = { action: "opened", baseRef: "feature-1", stackTarget: "main", files: [] };

  it("evaluates branches against the stack target", () => {
    expect(workflowDispatches(onPr({ branches: ["main"] }), STACKED)[0]).toBe(true);
  });

  it("names the stack target when branches declines", () => {
    expect(workflowDispatches(onPr({ branches: ["releases/*"] }), STACKED)).toEqual([
      false,
      "stack target 'main' not in branches",
    ]);
  });

  it("names the stack target when branches-ignore declines", () => {
    expect(workflowDispatches(onPr({ "branches-ignore": ["main"] }), STACKED)).toEqual([
      false,
      "stack target 'main' in branches-ignore",
    ]);
  });
});
