import { describe, expect, it } from "vitest";
import { materialize } from "./materialize.js";
import type { WorkflowSource } from "../types.js";

const SHA = "c".repeat(40);
const SOURCE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };

describe("materialize", () => {
  it("hands a failed download through as null", async () => {
    expect(
      await materialize(SOURCE, async () => null, async () => ({ code: 0, stderr: "" })),
    ).toBe(null);
  });

  it("hands a failed extraction through as null", async () => {
    expect(
      await materialize(
        SOURCE,
        async () => new Uint8Array([1, 2, 3]),
        async () => ({ code: 1, stderr: "" }),
      ),
    ).toBe(null);
  });
});
