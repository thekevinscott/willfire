// `index.ts` is a top-level script: importing it *is* running it. So each case
// stages the world it wants — argv and every collaborator — then re-imports the
// module and reads back what it wrote, printed, and exited with.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prediction, WorkflowSource } from "willfire";
import type {
  ApiRecord,
  DispatchedCheck,
  ExecRecord,
} from "../../../tests/fixtures/pinned/capture.js";

const hoisted = vi.hoisted(() => ({
  writeFile: vi.fn(),
  predictedEntries: vi.fn(),
  reconcile: vi.fn(),
  makeGithubClient: vi.fn(),
  predict: vi.fn(),
  makeLiveExecutor: vi.fn(),
  buildCapture: vi.fn(),
  dispatchedChecks: vi.fn(),
  makeRecordingClient: vi.fn(),
  makeRecordingExecutor: vi.fn(),
  makeResolveRef: vi.fn(),
  parseArgs: vi.fn(),
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return { ...actual, writeFile: hoisted.writeFile };
});
vi.mock("../../../tests/fixtures/pinned/capture.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../../tests/fixtures/pinned/capture.js")>(
      "../../../tests/fixtures/pinned/capture.js",
    );
  return { ...actual, predictedEntries: hoisted.predictedEntries, reconcile: hoisted.reconcile };
});
vi.mock("willfire", async () => {
  const actual = await vi.importActual<typeof import("willfire")>("willfire");
  return { ...actual, makeGithubClient: hoisted.makeGithubClient, predict: hoisted.predict };
});
vi.mock("willfire/internal", async () => {
  const actual = await vi.importActual<typeof import("willfire/internal")>("willfire/internal");
  return { ...actual, makeLiveExecutor: hoisted.makeLiveExecutor };
});
vi.mock("./buildCapture.js", async () => {
  const actual =
    await vi.importActual<typeof import("./buildCapture.js")>("./buildCapture.js");
  return { ...actual, buildCapture: hoisted.buildCapture };
});
vi.mock("./dispatchedChecks.js", async () => {
  const actual =
    await vi.importActual<typeof import("./dispatchedChecks.js")>("./dispatchedChecks.js");
  return { ...actual, dispatchedChecks: hoisted.dispatchedChecks };
});
vi.mock("./makeRecordingClient.js", async () => {
  const actual =
    await vi.importActual<typeof import("./makeRecordingClient.js")>("./makeRecordingClient.js");
  return { ...actual, makeRecordingClient: hoisted.makeRecordingClient };
});
vi.mock("./makeRecordingExecutor.js", async () => {
  const actual =
    await vi.importActual<typeof import("./makeRecordingExecutor.js")>(
      "./makeRecordingExecutor.js",
    );
  return { ...actual, makeRecordingExecutor: hoisted.makeRecordingExecutor };
});
vi.mock("./makeResolveRef.js", async () => {
  const actual =
    await vi.importActual<typeof import("./makeResolveRef.js")>("./makeResolveRef.js");
  return { ...actual, makeResolveRef: hoisted.makeResolveRef };
});

// Argument parsing is the script's own contract, so the real parser runs; the
// spy is there to observe what the script hands it.
vi.mock("./parseArgs.js", async () => {
  const actual = await vi.importActual<typeof import("./parseArgs.js")>("./parseArgs.js");
  hoisted.parseArgs.mockImplementation(actual.parseArgs);
  return { ...actual, parseArgs: hoisted.parseArgs };
});

// ------------------------------------------------------------------ fixtures

const HEAD = "head-sha";
const MERGE = "merge-sha";
const LIVE = Symbol("live client");
const LIVE_EXECUTOR = Symbol("live executor");
const RESOLVE_REF = Symbol("resolveRef");
const EXECUTOR = Symbol("recording executor");
const CAPTURE = { repo: "o/r", pr: 5 };

const HEAD_SOURCE: WorkflowSource = { owner: "o", repo: "r", ref: HEAD, sha: HEAD };
const MERGE_SOURCE: WorkflowSource = { owner: "o", repo: "r", ref: MERGE, sha: MERGE };

const API: ApiRecord = { key: "a", data: "x" };
const EXEC: ExecRecord = { key: "b", job: "gen", outcome: { ok: true, outputs: {} } };

const CHECKS: DispatchedCheck[] = [
  { workflow: "a.yml", name: "one", conclusion: "success" },
  { workflow: "a.yml", name: "two", conclusion: "skipped" },
];

const ENTRIES = [{ workflow: "a.yml", job: "one", checkName: "one", status: "run" }];

const PREDICTION = {
  checkNames: ["one"],
  entries: [{ workflow: "a.yml", job: "one", checkName: "one", status: "run", reason: "why" }],
  sources: [MERGE_SOURCE],
  skip: null,
} as unknown as Prediction;

interface Fixture {
  argv?: string[];
  merge?: string | null;
  sources?: WorkflowSource[];
  incomplete?: string[];
  disagreements?: string[];
}

describe("the capture recorder", () => {
  const argv = process.argv;
  let out: string[];
  let err: string[];
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
    pullsGet = vi.fn(async () => ({ data: { head: { sha: HEAD }, merge_commit_sha: merge } }));
    const client = { rest: { pulls: { get: pullsGet } } };
    hoisted.makeGithubClient.mockReturnValue(LIVE);
    hoisted.makeRecordingClient.mockReturnValue({ client, api: new Map([[API.key, API]]) });
    hoisted.makeResolveRef.mockReturnValue(RESOLVE_REF);
    hoisted.makeLiveExecutor.mockReturnValue(LIVE_EXECUTOR);
    hoisted.makeRecordingExecutor.mockReturnValue({
      executor: EXECUTOR,
      exec: new Map([[EXEC.key, EXEC]]),
    });
    hoisted.predict.mockResolvedValue({ ...PREDICTION, sources: f.sources ?? [MERGE_SOURCE] });
    hoisted.dispatchedChecks.mockResolvedValue({
      checks: CHECKS,
      incomplete: f.incomplete ?? [],
    });
    hoisted.predictedEntries.mockReturnValue(ENTRIES);
    hoisted.reconcile.mockReturnValue(f.disagreements ?? []);
    hoisted.buildCapture.mockReturnValue(CAPTURE);
    process.argv = [
      "node",
      "/somewhere/index.ts",
      ...(f.argv ?? ["--repo", "o/r", "--pr", "5", "--shape", "a fan-out"]),
    ];
    vi.resetModules();
    await import("./index.js");
  }

  const OUT = "/tests/fixtures/pinned/r-5.json";

  it("writes the capture the builder handed back", async () => {
    await invoke();
    const [path, body] = hoisted.writeFile.mock.calls[0];
    expect(path).toContain(OUT);
    expect(body).toBe(`${JSON.stringify(CAPTURE, null, 2)}\n`);
    expect(out).toEqual([`wrote ${path}: 2 dispatched, 1 reads, 1 runs`]);
  });

  it("parses the arguments, not the interpreter and the script path", async () => {
    await invoke();
    expect(hoisted.parseArgs).toHaveBeenCalledWith([
      "--repo",
      "o/r",
      "--pr",
      "5",
      "--shape",
      "a fan-out",
    ]);
  });

  it("hands the builder the prediction, the dispatch and both recordings", async () => {
    await invoke();
    expect(hoisted.buildCapture).toHaveBeenCalledWith({
      repo: "o/r",
      pr: 5,
      shape: "a fan-out",
      commits: { head: HEAD, merge: MERGE },
      dispatched: CHECKS,
      predicted: {
        checkNames: PREDICTION.checkNames,
        entries: ENTRIES,
        sources: [MERGE_SOURCE],
        skip: null,
      },
      recording: { api: [API], exec: [EXEC] },
    });
  });

  it("predicts through the recording client and the recording executor", async () => {
    await invoke();
    const client = hoisted.makeRecordingClient.mock.results[0].value.client;
    expect(hoisted.makeRecordingClient).toHaveBeenCalledWith(LIVE);
    expect(pullsGet).toHaveBeenCalledWith({ owner: "o", repo: "r", pull_number: 5 });
    expect(hoisted.makeResolveRef).toHaveBeenCalledWith(client);
    expect(hoisted.makeLiveExecutor).toHaveBeenCalledWith(client, MERGE_SOURCE, RESOLVE_REF);
    expect(hoisted.makeRecordingExecutor).toHaveBeenCalledWith(LIVE_EXECUTOR);
    expect(hoisted.predict).toHaveBeenCalledWith(client, "o/r", 5, { executor: EXECUTOR });
    expect(hoisted.dispatchedChecks).toHaveBeenCalledWith(client, "o", "r", HEAD);
    expect(hoisted.reconcile).toHaveBeenCalledWith(CHECKS, ENTRIES);
  });

  it("reads at head on a PR with no merge commit", async () => {
    await invoke({ merge: null, sources: [HEAD_SOURCE] });
    const client = hoisted.makeRecordingClient.mock.results[0].value.client;
    expect(hoisted.makeLiveExecutor).toHaveBeenCalledWith(client, HEAD_SOURCE, RESOLVE_REF);
    expect(hoisted.buildCapture).toHaveBeenCalledWith(
      expect.objectContaining({ commits: { head: HEAD, merge: null } }),
    );
  });

  it.each([
    ["a different owner", { owner: "other", repo: "r", ref: MERGE, sha: MERGE }],
    ["a different repo", { owner: "o", repo: "other", ref: MERGE, sha: MERGE }],
    // Head instead of the merge commit is the regression this guard exists for.
    ["the head commit", HEAD_SOURCE],
  ])("exits 1 when predict read the workspace at %s", async (_case, source) => {
    await expect(invoke({ sources: [source] })).rejects.toThrow("exited");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(err).toEqual([
      `predict no longer reads o/r at ${MERGE}; update the workspace in capture-e2e`,
    ]);
    expect(hoisted.writeFile).not.toHaveBeenCalled();
  });

  it("exits 1 rather than pinning a dispatch still in flight", async () => {
    await expect(invoke({ incomplete: ["a.yml", "b.yml"] })).rejects.toThrow("exited");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(err).toEqual(["still running: a.yml, b.yml; wait for the dispatch to settle"]);
    expect(hoisted.writeFile).not.toHaveBeenCalled();
  });

  it("exits 1, listing every disagreement, rather than pinning a wrong answer", async () => {
    // A capture the reconciler finds anything in would record a prediction
    // that was already wrong when it was captured.
    await expect(
      invoke({ disagreements: ["MISS a.yml :: three", "OVER a.yml :: two"] }),
    ).rejects.toThrow("exited");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(err).toEqual([
      "prediction disagrees with the dispatch; refusing to record o/r#5:",
      "  MISS a.yml :: three",
      "  OVER a.yml :: two",
    ]);
    expect(hoisted.writeFile).not.toHaveBeenCalled();
  });
});
