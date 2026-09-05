// `index.ts` is a top-level script: importing it *is* running it. So each case
// stages the world it wants — argv and every collaborator — then re-imports the
// module and reads back what it wrote, printed, and exited with.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchedCheck } from "../../../tests/fixtures/pinned/capture.js";

const hoisted = vi.hoisted(() => ({
  writeFile: vi.fn(),
  makeGithubClient: vi.fn(),
  buildCapture: vi.fn(),
  dispatchedChecks: vi.fn(),
  parseArgs: vi.fn(),
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return { ...actual, writeFile: hoisted.writeFile };
});
vi.mock("willfire", async () => {
  const actual = await vi.importActual<typeof import("willfire")>("willfire");
  return { ...actual, makeGithubClient: hoisted.makeGithubClient };
});
vi.mock("./buildCapture.js", async () => {
  const actual = await vi.importActual<typeof import("./buildCapture.js")>("./buildCapture.js");
  return { ...actual, buildCapture: hoisted.buildCapture };
});
vi.mock("./dispatchedChecks.js", async () => {
  const actual =
    await vi.importActual<typeof import("./dispatchedChecks.js")>("./dispatchedChecks.js");
  return { ...actual, dispatchedChecks: hoisted.dispatchedChecks };
});

// Argument parsing is the script's own contract, so the real parser runs; the
// spy is there to observe what the script hands it.
vi.mock("./parseArgs.js", async () => {
  const actual = await vi.importActual<typeof import("./parseArgs.js")>("./parseArgs.js");
  hoisted.parseArgs.mockImplementation(actual.parseArgs);
  return { ...actual, parseArgs: hoisted.parseArgs };
});

const HEAD = "head-sha";
const MERGE = "merge-sha";
const CAPTURE = { repo: "o/r", pr: 5 };

const CHECKS: DispatchedCheck[] = [
  { workflow: "a.yml", name: "one", conclusion: "success" },
  { workflow: "a.yml", name: "two", conclusion: "skipped" },
];

interface Fixture {
  argv?: string[];
  merge?: string | null;
  incomplete?: string[];
}

describe("the dispatch recorder", () => {
  const argv = process.argv;
  let out: string[];
  let err: string[];
  let client: unknown;
  let pullsGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void out.push(line));
    vi.spyOn(console, "error").mockImplementation((line: string) => void err.push(line));
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exited");
    }) as () => never);
  });

  afterEach(() => {
    process.argv = argv;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  /** Re-import the module as if node had been pointed at it directly. */
  async function invoke(f: Fixture = {}): Promise<void> {
    const merge = f.merge === undefined ? MERGE : f.merge;
    pullsGet = vi.fn(async () => ({ head: { sha: HEAD }, merge_commit_sha: merge }));
    client = { getPull: pullsGet };
    hoisted.makeGithubClient.mockReturnValue(client);
    hoisted.dispatchedChecks.mockResolvedValue({
      checks: CHECKS,
      incomplete: f.incomplete ?? [],
    });
    hoisted.buildCapture.mockReturnValue(CAPTURE);
    process.argv = ["node", "/somewhere/index.ts", ...(f.argv ?? ["--repo", "o/r", "--pr", "5"])];
    vi.resetModules();
    await import("./index.js");
  }

  const OUT = "/tests/fixtures/pinned/r-5.json";

  it("writes the capture the builder handed back", async () => {
    await invoke();
    const [path, body] = hoisted.writeFile.mock.calls[0];
    expect(path).toContain(OUT);
    expect(body).toBe(`${JSON.stringify(CAPTURE, null, 2)}\n`);
    expect(out).toEqual([`wrote ${path}: 2 dispatched`]);
  });

  it("parses the arguments, not the interpreter and the script path", async () => {
    await invoke();
    expect(hoisted.parseArgs).toHaveBeenCalledWith(["--repo", "o/r", "--pr", "5"]);
  });

  it("hands the builder the PR's commits and the dispatch", async () => {
    await invoke();
    expect(hoisted.buildCapture).toHaveBeenCalledWith({
      repo: "o/r",
      pr: 5,
      commits: { head: HEAD, merge: MERGE },
      dispatched: CHECKS,
    });
  });

  it("reads the dispatch off the head commit", async () => {
    await invoke();
    expect(pullsGet).toHaveBeenCalledWith({ owner: "o", repo: "r", pull_number: 5 });
    expect(hoisted.dispatchedChecks).toHaveBeenCalledWith(client, "o", "r", HEAD);
  });

  it("records a null merge commit on a PR that has none", async () => {
    await invoke({ merge: null });
    expect(hoisted.buildCapture).toHaveBeenCalledWith(
      expect.objectContaining({ commits: { head: HEAD, merge: null } }),
    );
  });

  it("exits 1 rather than pinning a dispatch still in flight", async () => {
    await expect(invoke({ incomplete: ["a.yml", "b.yml"] })).rejects.toThrow("exited");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(err).toEqual(["still running: a.yml, b.yml; wait for the dispatch to settle"]);
    expect(hoisted.writeFile).not.toHaveBeenCalled();
  });
});
