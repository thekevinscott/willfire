// The entrypoint is exercised the way node runs it: set argv, reset the module
// registry, import. The dynamic import is the seam — a static import would run
// the main block once, before any test staged its fixture.

import type { Octokit } from "@octokit/rest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real `Octokit` constructor is the one third-party edge the entrypoint
// reaches for through `makeOctokit`. Replacing the class lets it be driven
// without a network. `hoisted` is the handoff: `vi.mock` factories are lifted
// above the imports, so they cannot close over ordinary module scope.
const hoisted = vi.hoisted(() => ({ octokit: undefined as unknown }));

vi.mock("@octokit/rest", async () => {
  const actual = await vi.importActual<typeof import("@octokit/rest")>("@octokit/rest");
  return {
    ...actual,
    // Returning an object from a constructor overrides `this`, so `new Octokit()`
    // hands back whatever the case under test staged.
    Octokit: class {
      constructor(_options: { auth?: string }) {
        return (hoisted.octokit ?? {}) as object;
      }
    },
  };
});

const WF = ".github/workflows/w.yml";

interface Fixture {
  /** Repo contents at head, keyed by path. A missing key is a 404. */
  contents?: Record<string, string>;
  /** Head commit message — the surface the skip instructions are read from. */
  message?: string;
  commits?: number;
}

const HEAD_SHA = "deadbeef";

const HEAD_SOURCE = { owner: "o", repo: "r", ref: HEAD_SHA, sha: HEAD_SHA };

// Sentinels standing in for the paginating route methods. `predict` passes the
// method itself to `octokit.paginate`, never calls it, so identity is all the
// stub needs to tell the two routes apart.
const LIST_FILES = Symbol("pulls.listFiles");
const LIST_WORKFLOWS = Symbol("actions.listRepoWorkflows");

function fakeOctokit(f: Fixture): Octokit {
  const contents = f.contents ?? {};
  const api = {
    rest: {
      pulls: {
        get: async () => ({
          data: {
            commits: f.commits ?? 1,
            base: { ref: "main" },
            head: { sha: HEAD_SHA },
            merge_commit_sha: null,
          },
        }),
        listFiles: LIST_FILES,
      },
      repos: {
        getCommit: async () => ({
          data: { sha: HEAD_SHA, commit: { message: f.message ?? "chore: routine" } },
        }),
        getContent: async ({ path }: { path: string }) => {
          if (!(path in contents)) {
            throw new Error(`404 ${path}`);
          }
          return { data: contents[path] };
        },
      },
      actions: { listRepoWorkflows: LIST_WORKFLOWS },
    },
    paginate: async (route: symbol) => {
      if (route === LIST_FILES) {
        return [{ filename: "src/app.ts" }];
      }
      return [{ path: WF, state: "active" }];
    },
  };
  return api as unknown as Octokit;
}

describe("the CLI entrypoint", () => {
  const argv = process.argv;
  let out: string[];

  beforeEach(() => {
    out = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void out.push(line));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("GH_TOKEN", "gh");
  });

  afterEach(() => {
    process.argv = argv;
    hoisted.octokit = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /** Re-import the module as if node had been pointed at it directly. */
  async function invoke(args: string[], f: Fixture = {}): Promise<void> {
    hoisted.octokit = fakeOctokit(f);
    process.argv = ["node", "/somewhere/cli.ts", ...args];
    vi.resetModules();
    await import("./cli.js");
  }

  const WORKFLOW = "on: pull_request\njobs:\n  a: {}\n";

  /** Provenance trails every plain-text run: one line, the head commit. */
  const HEAD_READ = `# read o/r@${HEAD_SHA} -> ${HEAD_SHA}`;

  it("stays quiet when the module is imported rather than run", async () => {
    process.argv = ["node"];
    vi.resetModules();
    await import("./cli.js");
    expect(out).toEqual([]);
  });

  it("prints one line per entry", async () => {
    await invoke(["--repo", "o/r", "--pr", "1"], { contents: { [WF]: WORKFLOW } });
    expect(out).toEqual([`${WF} :: a :: run`, HEAD_READ]);
  });

  it("comments out a workflow-level verdict", async () => {
    await invoke(["--repo", "o/r", "--pr", "1"], { contents: {} });
    expect(out).toEqual([`# ${WF} :: no-dispatch (no workflow file at head)`, HEAD_READ]);
  });

  it("reports a suppressing skip instruction on its own", async () => {
    await invoke(["--repo", "o/r", "--pr", "1"], {
      contents: { [WF]: WORKFLOW },
      message: "chore: docs [skip ci]",
    });
    expect(out).toEqual([
      "# head commit message contains a skip instruction -> nothing dispatches",
      HEAD_READ,
    ]);
  });

  it("says so in the line rather than printing a name it could not resolve", async () => {
    await invoke(["--repo", "o/r", "--pr", "1"], {
      contents: { [WF]: "on: pull_request\njobs:\n  a:\n    name: on ${{ inputs.x }}\n" },
    });
    expect(out).toEqual([`${WF} :: on \${{ inputs.x }} (name unresolved) :: run`, HEAD_READ]);
  });

  it("emits JSON under --json", async () => {
    await invoke(["--repo", "o/r", "--pr", "1", "--json"], { contents: { [WF]: WORKFLOW } });
    expect(JSON.parse(out.join("\n"))).toEqual({
      skip: null,
      checkNames: ["a"],
      entries: [
        { workflow: WF, job: "a", checkName: "a", status: "run", reason: "trigger matched" },
      ],
      sources: [HEAD_SOURCE],
    });
  });

  it("passes --action through instead of inferring one", async () => {
    // `types: [synchronize]` with a single commit: the heuristic says `opened`
    // and the workflow would not dispatch.
    await invoke(["--repo", "o/r", "--pr", "1", "--action", "synchronize"], {
      contents: { [WF]: "on:\n  pull_request:\n    types: [synchronize]\njobs:\n  a: {}\n" },
    });
    expect(out).toEqual([`${WF} :: a :: run`, HEAD_READ]);
  });

});
