import { describe, expect, it } from "vitest";
import { expandReusableCall } from "./expandReusableCall.js";
import type { Ctx, DetailedCombo, WorkflowReader, WorkflowSource } from "../types.js";

const SHA = "a".repeat(40);
const SOURCE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };
const CTX: Ctx = { action: "opened", baseRef: "main", files: ["src/app.ts"] };
const USES = "./.github/workflows/sub.yml";

const readerFor = (files: Record<string, string>): WorkflowReader => ({
  fetchWorkflow: async (path) => files[path] ?? null,
  resolveRef: async (src) => src.ref,
});

const SUB = {
  ".github/workflows/sub.yml": JSON.stringify({
    on: { workflow_call: null },
    jobs: { inner: {} },
  }),
};

const call = (
  job: Record<string, unknown>,
  combos: Array<DetailedCombo | null>,
  reader: WorkflowReader,
  prefixResolved = true,
) =>
  expandReusableCall("call", job, combos, CTX, reader, SOURCE, 0, "", prefixResolved, {});

describe("expandReusableCall", () => {
  it("inlines the called workflow's jobs under a prefixed name", async () => {
    const entries = await call({ uses: USES }, [null], readerFor(SUB));
    expect(entries).toEqual([
      { job: "call / inner", checkName: "call / inner", status: "run", reason: "" },
    ]);
  });

  it("multiplies the whole callee set by the caller's matrix", async () => {
    const combos: DetailedCombo[] = [
      { values: { os: "linux" }, displayKeys: ["os"] },
      { values: { os: "mac" }, displayKeys: ["os"] },
    ];
    const entries = await call({ uses: USES }, combos, readerFor(SUB));
    expect(entries.map((e) => e.job)).toEqual(["call (linux) / inner", "call (mac) / inner"]);
  });

  it("resolves the callee once, then reports the same failure per combination", async () => {
    const fetched: string[] = [];
    const reader: WorkflowReader = {
      fetchWorkflow: async (path) => {
        fetched.push(path);
        return null;
      },
      resolveRef: async (src) => src.ref,
    };
    const combos: DetailedCombo[] = [
      { values: { os: "linux" }, displayKeys: ["os"] },
      { values: { os: "mac" }, displayKeys: ["os"] },
    ];
    const entries = await call({ uses: USES }, combos, reader);
    expect(fetched).toEqual([".github/workflows/sub.yml"]);
    expect(entries).toEqual([
      { job: "call (linux)", checkName: null, status: "unknown", reason: `cannot fetch ${USES}` },
      { job: "call (mac)", checkName: null, status: "unknown", reason: `cannot fetch ${USES}` },
    ]);
  });

  it("reports a callee that parses to nothing as unresolvable", async () => {
    const entries = await call(
      { uses: USES },
      [null],
      readerFor({ ".github/workflows/sub.yml": "" }),
    );
    expect(entries).toEqual([
      { job: "call", checkName: null, status: "unknown", reason: `cannot resolve ${USES}` },
    ]);
  });

  it("poisons the subtree's check names under an unresolved prefix", async () => {
    const entries = await call({ uses: USES }, [null], readerFor(SUB), false);
    expect(entries).toEqual([
      { job: "call / inner", checkName: null, status: "run", reason: "" },
    ]);
  });
});
