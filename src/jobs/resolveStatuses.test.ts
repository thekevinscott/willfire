import { describe, expect, it, vi } from "vitest";
import { resolveStatuses } from "./resolveStatuses.js";

// `evalIf` is the guard verdict this pass is built around, so the real one
// runs rather than a stub answering for it.
vi.mock("./evalIf.js", async () => await vi.importActual<typeof import("./evalIf.js")>("./evalIf.js"));
import type { Workflow } from "../types.js";
import type { YamlMap } from "../yamlValue.js";

const resolve = (jobs: YamlMap) => resolveStatuses(jobs as Record<string, Workflow>, {});

const statuses = (jobs: YamlMap): Record<string, string> =>
  Object.fromEntries(Object.entries(resolve(jobs)).map(([id, v]) => [id, v.status]));

describe("resolveStatuses", () => {
  it("settles a job with no guard and no needs as run", () => {
    expect(resolve({ a: {} })["a"]).toEqual({ status: "run", reason: "", needs: [] });
  });

  it("tolerates a job whose body is empty", () => {
    expect(statuses({ a: null })).toEqual({ a: "run" });
  });

  it("reads a scalar `needs` as one id", () => {
    expect(resolve({ a: { if: false }, b: { needs: "a" } })["b"]).toMatchObject({
      status: "skipped",
      needs: ["a"],
    });
  });

  describe("declaration order", () => {
    // Probe PR #373, run 36430122487: `needs-first` and `caller-first`, both
    // declared above the `if: false` job they need, each collapsed to a single
    // skipped check — identical to the same three jobs in the reverse order.
    it("skips a dependent declared before the job it needs", () => {
      expect(statuses({ b: { needs: ["a"] }, a: { if: false } })).toEqual({
        b: "skipped",
        a: "skipped",
      });
    });

    it("propagates an unknown status upward through a later declaration", () => {
      expect(statuses({ b: { needs: ["a"] }, a: { if: "github.ref == 'x'" } })).toEqual({
        b: "unknown",
        a: "unknown",
      });
    });

    it("settles a status function against a need declared later", () => {
      expect(statuses({ b: { needs: ["a"], if: "${{ !cancelled() }}" }, a: { if: false } })).toEqual(
        { b: "run", a: "skipped" },
      );
    });

    it("carries a skip down a chain declared back to front", () => {
      expect(statuses({ c: { needs: ["b"] }, b: { needs: ["a"] }, a: { if: false } })).toEqual({
        c: "skipped",
        b: "skipped",
        a: "skipped",
      });
    });

    it("settles a shared dependency once for every dependent", () => {
      expect(statuses({ b: { needs: ["a"] }, c: { needs: ["a"] }, a: { if: false } })).toEqual({
        b: "skipped",
        c: "skipped",
        a: "skipped",
      });
    });
  });

  describe("a graph GitHub rejects", () => {
    // Probe PR #374, run 36430154587: the workflow failed at startup and no
    // run attached to the pull request, so there is no check name to predict.
    it("calls a job whose need the workflow does not declare unknown", () => {
      expect(resolve({ a: { needs: ["nosuchjob"] } })["a"]).toMatchObject({
        status: "unknown",
        reason: "needs 'nosuchjob', which the workflow does not declare",
      });
    });

    it("answers unknown for a dangling need even under a false guard", () => {
      expect(statuses({ a: { if: false, needs: ["nosuchjob"] } })).toEqual({ a: "unknown" });
    });

    // Probe PR #374, run 36430153246: same startup failure, no attached run.
    it("terminates on a two-job cycle", () => {
      expect(statuses({ a: { needs: ["b"] }, b: { needs: ["a"] } })).toEqual({
        a: "unknown",
        b: "unknown",
      });
    });

    it("terminates on a job that needs itself", () => {
      expect(resolve({ a: { needs: ["a"] } })["a"]).toMatchObject({ status: "unknown" });
    });

    it("terminates on a longer cycle", () => {
      expect(statuses({ a: { needs: ["c"] }, b: { needs: ["a"] }, c: { needs: ["b"] } })).toEqual({
        a: "unknown",
        b: "unknown",
        c: "unknown",
      });
    });
  });
});
