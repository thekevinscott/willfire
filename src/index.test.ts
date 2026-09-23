import { describe, expect, expectTypeOf, it } from "vitest";
import * as barrel from "./index.js";
import {
  evalIf,
  expandMatrix,
  expandWorkflowJobs,
  isJobEntry,
  isWorkflowEntry,
  jobName,
  makeGithubClient,
  matchFilters,
  parseUses,
  patternToRegex,
  predict,
} from "./index.js";
import type {
  Ctx,
  Entry,
  ExecOutcome,
  ExpandedJob,
  FetchWorkflow,
  GithubClient,
  JobEntry,
  JobExecutor,
  JobName,
  PredictOptions,
  Prediction,
  PrEventAction,
  ResolveRef,
  SourceRef,
  UsesTarget,
  WorkflowEntry,
  WorkflowReader,
  WorkflowSource,
} from "./index.js";
// Not part of the barrel — needed only to spell out the parameter types below,
// independently of whatever `../types.js` currently says they are.
import type { Scope } from "./expr/val.js";
import type { YamlValue } from "./yamlValue.js";

describe("root barrel", () => {
  it("exposes exactly the published surface", () => {
    // pr-monitor imports Entry, JobEntry, WorkflowEntry and Prediction from
    // here; the runtime names below are the rest of the contract.
    expect(Object.keys(barrel).sort()).toEqual([
      "evalIf",
      "expandMatrix",
      "expandWorkflowJobs",
      "isJobEntry",
      "isWorkflowEntry",
      "jobName",
      "makeGithubClient",
      "matchFilters",
      "parseUses",
      "patternToRegex",
      "predict",
    ]);
    // Each name is re-exported from the module that defines it, so the
    // function's own name is what catches a re-export bound to the wrong one.
    for (const [name, fn] of Object.entries(barrel)) {
      expect(typeof fn).toBe("function");
      expect(fn.name).toBe(name);
    }
  });

  it("re-exports the executor seam types", () => {
    // Type-only, erased at runtime — which is why the key list above cannot
    // show them. Compiling these assignments is the assertion.
    const outcome: ExecOutcome = { ok: false, reason: "r" };
    const executor: JobExecutor = { executeJob: async () => outcome };
    expect(typeof executor.executeJob).toBe("function");
  });

  it("re-exports the success variant of the outcome, not just the failure", async () => {
    // Both arms travel: pr-monitor reads `outputs` off a successful one.
    const outcome: ExecOutcome = { ok: true, outputs: { languages: "[]" } };
    const executor: JobExecutor = { executeJob: async () => outcome };
    expect(await executor.executeJob("detect", {}, {}, {})).toEqual({
      ok: true,
      outputs: { languages: "[]" },
    });
  });

  it("pins GithubClient's nine methods — #174 changed this shape behind an unchanged name", async () => {
    const client: GithubClient = {
      getPull: async () => ({
        base: { ref: "main" },
        merge_commit_sha: null,
        commits: 1,
        head: { sha: "abc" },
      }),
      listPulls: async () => [{ base: { ref: "main" }, merge_commit_sha: null }],
      listPullFiles: async () => [{ filename: "a.ts" }],
      getCommit: async () => ({ sha: "abc", commit: { message: "m" }, parents: [{ sha: "def" }] }),
      getContent: async () => "content",
      downloadTarball: async () => new ArrayBuffer(0),
      listWorkflows: async () => [{ path: ".github/workflows/x.yml", state: "active" }],
      listWorkflowFiles: async () => [{ path: ".github/workflows/x.yml", type: "file" }],
      listWorkflowRuns: async () => [{ id: 1, path: ".github/workflows/x.yml", status: "completed" }],
      listRunJobs: async () => [{ name: "test", conclusion: "success" }],
    };

    // Each call's argument literal pins the parameter shape; each awaited
    // value pins the return shape. `getCommit` is the one pr-monitor's
    // resolveSourceSha.ts actually calls, and the one #174 broke.
    await expect(client.getPull({ owner: "o", repo: "r", pull_number: 1 })).resolves.toEqual({
      base: { ref: "main" },
      merge_commit_sha: null,
      commits: 1,
      head: { sha: "abc" },
    });
    await expect(
      client.listPulls({ owner: "o", repo: "r", state: "open", head: "o:b" }),
    ).resolves.toEqual([{ base: { ref: "main" }, merge_commit_sha: null }]);
    await expect(client.listPullFiles({ owner: "o", repo: "r", pull_number: 1 })).resolves.toEqual([
      { filename: "a.ts" },
    ]);
    await expect(client.getCommit({ owner: "o", repo: "r", ref: "abc" })).resolves.toEqual({
      sha: "abc",
      commit: { message: "m" },
      parents: [{ sha: "def" }],
    });
    await expect(
      client.getContent({ owner: "o", repo: "r", path: "a.yml", ref: "abc" }),
    ).resolves.toBe("content");
    const tarball = await client.downloadTarball({ owner: "o", repo: "r", ref: "abc" });
    expect(tarball.byteLength).toBe(0);
    await expect(client.listWorkflows({ owner: "o", repo: "r" })).resolves.toEqual([
      { path: ".github/workflows/x.yml", state: "active" },
    ]);
    await expect(
      client.listWorkflowFiles({ owner: "o", repo: "r", ref: "abc" }),
    ).resolves.toEqual([{ path: ".github/workflows/x.yml", type: "file" }]);
    await expect(
      client.listWorkflowRuns({ owner: "o", repo: "r", head_sha: "abc", event: "pull_request" }),
    ).resolves.toEqual([{ id: 1, path: ".github/workflows/x.yml", status: "completed" }]);
    await expect(client.listRunJobs({ owner: "o", repo: "r", run_id: 1 })).resolves.toEqual([
      { name: "test", conclusion: "success" },
    ]);
  });

  it("pins the workflow-reader seam: FetchWorkflow, ResolveRef, WorkflowReader", () => {
    // Independent of WorkflowReader's own declaration, which just aliases
    // these two — comparing WorkflowReader["fetchWorkflow"] to FetchWorkflow
    // would always pass since they are the same type by definition.
    expectTypeOf<FetchWorkflow>().toEqualTypeOf<
      (path: string, source: WorkflowSource) => Promise<string | null>
    >();
    expectTypeOf<ResolveRef>().toEqualTypeOf<(source: SourceRef) => Promise<string | null>>();

    const reader: WorkflowReader = {
      fetchWorkflow: async () => null,
      resolveRef: async () => null,
    };
    expect(typeof reader.fetchWorkflow).toBe("function");
  });

  it("pins WorkflowEntry, JobEntry, Entry, and their narrowing predicates", () => {
    const workflowEntry: WorkflowEntry = {
      workflow: "w.yml",
      reason: "r",
      job: "*",
      checkName: null,
      status: "run",
    };
    const jobEntry: JobEntry = {
      workflow: "w.yml",
      reason: "r",
      job: jobName("build"),
      checkName: "build",
      status: "run",
    };
    const entries: Entry[] = [workflowEntry, jobEntry];
    expect(isWorkflowEntry(entries[0])).toBe(true);
    expect(isJobEntry(entries[1])).toBe(true);
  });

  it("pins Prediction, its sources, and the SourceRef/WorkflowSource shapes", () => {
    const sourceRef: SourceRef = { owner: "o", repo: "r", ref: "main" };
    const workflowSource: WorkflowSource = { ...sourceRef, sha: "abc" };
    const workflowEntry: Entry = {
      workflow: "w.yml",
      reason: "r",
      job: "*",
      checkName: null,
      status: "run",
    };
    const prediction: Prediction = {
      entries: [workflowEntry],
      checkNames: ["build"],
      skip: null,
      sources: [workflowSource],
    };
    expect(prediction.sources[0]).toEqual(workflowSource);
  });

  it("pins PredictOptions, PrEventAction, Ctx, ExpandedJob, and UsesTarget's two arms", () => {
    const options: PredictOptions = { action: "opened", executor: null, callbacks: ["cb"] };
    expect(options.action).toBe("opened");

    // Widening this union later is fine (per types.ts); narrowing it is not,
    // so every current member is pinned.
    const actions: PrEventAction[] = ["opened", "synchronize", "reopened"];
    expect(actions).toHaveLength(3);

    const ctx: Ctx = { action: "opened", baseRef: "main", stackTarget: "main", files: ["a.ts"] };
    expect(ctx.files).toEqual(["a.ts"]);

    const expandedJob: ExpandedJob = { job: "build", checkName: "build", status: "run", reason: "r" };
    expect(expandedJob.status).toBe("run");

    const sourceRef: SourceRef = { owner: "o", repo: "r", ref: "main" };
    const localTarget: UsesTarget = { path: "x.yml", source: null };
    const remoteTarget: UsesTarget = { path: "x.yml", source: sourceRef };
    expect(localTarget.source).toBeNull();
    expect(remoteTarget.source).toEqual(sourceRef);
  });

  it("pins JobName as a one-way brand over string", () => {
    const branded: JobName = jobName("detect");
    const widened: string = branded; // the brand must widen to string without a cast
    expect(widened).toBe("detect");
  });

  it("pins the remaining runtime exports' call signatures", () => {
    const toRegex: (pat: string) => RegExp = patternToRegex;
    expect(toRegex("a*").test("ab")).toBe(true);

    const match: (value: string, patterns: string[]) => boolean = matchFilters;
    expect(match("a.ts", ["*.ts"])).toBe(true);

    expectTypeOf(expandMatrix).parameter(0).toEqualTypeOf<YamlValue | undefined>();
    expectTypeOf(expandMatrix).parameter(1).toEqualTypeOf<Scope | undefined>();
    expect(expandMatrix({ matrix: { os: ["a", "b"] } }, {})).toEqual([{ os: "a" }, { os: "b" }]);

    expectTypeOf(evalIf).parameter(0).toEqualTypeOf<YamlValue | undefined>();
    const verdict: "run" | "skipped" | "unknown" = evalIf(undefined, {});
    expect(verdict).toBe("run");

    // `Workflow` (= YamlMap) is not part of the barrel; spelled out here
    // rather than imported so a change to it is what fails this line.
    const expand: (
      wf: Record<string, YamlValue | undefined>,
      ctx: Ctx,
      reader: WorkflowReader,
      source: WorkflowSource,
      scope?: Scope,
      executor?: JobExecutor,
    ) => Promise<ExpandedJob[]> = expandWorkflowJobs;
    expect(typeof expand).toBe("function");

    const parse: (uses: string) => UsesTarget | null = parseUses;
    expect(parse("./.github/workflows/x.yml")).toEqual({
      path: ".github/workflows/x.yml",
      source: null,
    });
    expect(parse("o/r/.github/workflows/x.yml@v1")).toEqual({
      path: ".github/workflows/x.yml",
      source: { owner: "o", repo: "r", ref: "v1" },
    });

    const make: () => GithubClient = makeGithubClient;
    expect(typeof make).toBe("function");

    const run: (
      github: GithubClient,
      repo: string,
      prNumber: number,
      opts?: PredictOptions,
    ) => Promise<Prediction> = predict;
    expect(typeof run).toBe("function");
  });
});
