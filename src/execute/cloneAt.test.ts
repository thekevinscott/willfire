import { describe, expect, it } from "vitest";
import type { WorkflowSource } from "../types.js";
import { cloneAt } from "./cloneAt.js";
import type { RunSpec } from "./types.js";

const SHA = "c".repeat(40);
const SRC: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };

describe("cloneAt", () => {
  it("builds an isolated clone invocation, auth only as an ephemeral header", async () => {
    const specs: RunSpec[] = [];
    const tree = await cloneAt(SRC, "https://example.test/o/r.git", "tok-123", async (spec) => {
      specs.push(spec);
      return { code: 0, stderr: "" };
    });
    const [spec] = specs;
    expect(tree).toBe(spec.env.WILLFIRE_DEST);
    expect(spec.env.WILLFIRE_REMOTE).toBe("https://example.test/o/r.git");
    expect(spec.env.WILLFIRE_SHA).toBe(SHA);
    expect(spec.script).toContain('-c "$WILLFIRE_AUTH"');
    expect(spec.script).not.toContain("tok-123");
    expect(spec.env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(spec.env.GIT_CONFIG_NOSYSTEM).toBe("1");
  });

  it("passes no auth flag without a token", async () => {
    const specs: RunSpec[] = [];
    await cloneAt(SRC, "https://example.test/o/r.git", null, async (spec) => {
      specs.push(spec);
      return { code: 1, stderr: "" };
    });
    const [spec] = specs;
    expect("WILLFIRE_AUTH" in spec.env).toBe(false);
    expect(spec.script).not.toContain("WILLFIRE_AUTH");
  });

  it("hands a failed clone through as null", async () => {
    const tree = await cloneAt(SRC, "https://example.test/o/r.git", null, async () => ({
      code: 1,
      stderr: "",
    }));
    expect(tree).toBe(null);
  });
});
