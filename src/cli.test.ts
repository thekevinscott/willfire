// The entrypoint is exercised the way node runs it: set argv, reset the module
// registry, import. The dynamic import is the seam — a static import would run
// the main block once, before any test staged its fixture.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubClient } from "./predict/makeGithubClient.js";

// `makeGithubClient` is the seam the entrypoint reaches the network through.
// Replacing the module lets the CLI be driven without a token or a network.
// `hoisted` is the handoff: `vi.mock` factories are lifted above the imports,
// so they cannot close over ordinary module scope.
const hoisted = vi.hoisted(() => ({ github: undefined as GithubClient | undefined }));

vi.mock("./predict/makeGithubClient.js", async () => {
  const actual = await vi.importActual<typeof import("./predict/makeGithubClient.js")>(
    "./predict/makeGithubClient.js",
  );
  return { ...actual, makeGithubClient: () => hoisted.github as GithubClient };
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
// method itself to `github.paginate`, never calls it, so identity is all the
// stub needs to tell the two routes apart.
const LIST_FILES = Symbol("pulls.listFiles");
const LIST_WORKFLOWS = Symbol("actions.listRepoWorkflows");

function fakeGithub(f: Fixture): GithubClient {
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
  return api as unknown as GithubClient;
}

describe("the CLI entrypoint", () => {
  const argv = process.argv;
  let out: string[];

  beforeEach(() => {
    out = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void out.push(line));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.argv = argv;
    hoisted.github = undefined;
    vi.restoreAllMocks();
  });

  /** Re-import the module as if node had been pointed at it directly. */
  async function invoke(args: string[], f: Fixture = {}): Promise<void> {
    hoisted.github = fakeGithub(f);
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

  const DYNAMIC =
    "on: pull_request\njobs:\n  detect:\n    steps: []\n  cover:\n" +
    "    needs: detect\n    strategy:\n      matrix:\n" +
    "        language: ${{ fromJSON(needs.detect.outputs.langs) }}\n";

  /** The reason on the entry the dynamic matrix belongs to. */
  const coverReason = (): string => JSON.parse(out.join("\n")).entries[1].reason;

  it("executes the needed job by default", async () => {
    // The fixture serves no tarball, so the live executor fails to materialize
    // the workspace — which is what proves it was built and reached at all.
    await invoke(["--repo", "o/r", "--pr", "1", "--json"], { contents: { [WF]: DYNAMIC } });
    expect(coverReason()).toBe(
      `dynamic matrix; executing 'detect' failed: cannot materialize workspace o/r@${HEAD_SHA}`,
    );
  });

  it("builds no executor at all under --no-execute", async () => {
    await invoke(["--repo", "o/r", "--pr", "1", "--json", "--no-execute"], {
      contents: { [WF]: DYNAMIC },
    });
    expect(coverReason()).toBe("dynamic matrix");
  });
});
