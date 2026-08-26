import { describe, expect, it } from "vitest";
import type { WorkflowSource } from "../types.js";
import { materialize } from "./materialize.js";

const SRC: WorkflowSource = { owner: "o", repo: "r", ref: "c".repeat(40), sha: "c".repeat(40) };

describe("materialize", () => {
  it("hands a failed download through as null, touching nothing", async () => {
    const tree = await materialize(SRC, async () => null, async () => {
      throw new Error("must not run");
    });
    expect(tree).toBe(null);
  });

  it("hands a failed extraction through as null", async () => {
    const tree = await materialize(
      SRC,
      async () => new Uint8Array([1, 2, 3]),
      async () => ({ code: 1, stderr: "not a tarball" }),
    );
    expect(tree).toBe(null);
  });
});
