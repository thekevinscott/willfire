import { describe, expect, it } from "vitest";
import { cloneAt } from "./cloneAt.js";
import type { RunSpec } from "./types.js";
import type { WorkflowSource } from "../types.js";

const SHA = "c".repeat(40);
const SOURCE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };

describe("cloneAt", () => {
  it("hands a failed clone through as null", async () => {
    expect(
      await cloneAt(SOURCE, "https://example.invalid/o/r.git", null, async () => ({
        code: 1,
        stdout: "", stderr: "",
      })),
    ).toBe(null);
  });

  it("yields the tree path on success", async () => {
    const dest = await cloneAt(SOURCE, "https://example.invalid/o/r.git", null, async () => ({
      code: 0,
      stdout: "", stderr: "",
    }));
    expect(dest).toMatch(/\/tree$/);
  });

  it("omits the auth header machinery when there is no token", async () => {
    const specs: RunSpec[] = [];
    await cloneAt(SOURCE, "https://example.invalid/o/r.git", null, async (spec) => {
      specs.push(spec);
      return { code: 1, stdout: "", stderr: "" };
    });
    const [spec] = specs;
    expect("WILLFIRE_AUTH" in spec.env).toBe(false);
    expect(spec.script).not.toContain("-c ");
  });
});
