// The entrypoint is exercised the way node runs it: set argv, reset the module
// registry, import. The dynamic import is the seam — a static import would run
// the main block once, before any test staged its fixture.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubClient } from "./predict/makeGithubClient.js";

// `makeGithubClient` is the seam the entrypoint reaches the network through.
// Replacing the module lets the CLI be driven without a token or a network.
// `hoisted` is the handoff: `vi.mock` factories are lifted above the imports,
// so they cannot close over ordinary module scope.
const hoisted = vi.hoisted(() => ({
  github: undefined as GithubClient | undefined,
  resolved: [] as (readonly string[])[],
}));

vi.mock("./predict/makeGithubClient.js", async () => {
  const actual = await vi.importActual<typeof import("./predict/makeGithubClient.js")>(
    "./predict/makeGithubClient.js",
  );
  return { ...actual, makeGithubClient: () => hoisted.github as GithubClient };
});

// Records what the prediction was asked to resolve, without spawning anything.
// The hoisted array outlives the module resets each invocation performs.
vi.mock("./callback/resolveCallbackMap.js", async () => {
  const actual = await vi.importActual<typeof import("./callback/resolveCallbackMap.js")>(
    "./callback/resolveCallbackMap.js",
  );
  const recording: typeof actual.resolveCallbackMap = async (commands) => {
    hoisted.resolved.push(commands);
    return undefined;
  };
  return { ...actual, resolveCallbackMap: recording };
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

function fakeGithub(f: Fixture): GithubClient {
  const contents = f.contents ?? {};
  const api = {
    getPull: async () => ({
      commits: f.commits ?? 1,
      base: { ref: "main" },
      head: { sha: HEAD_SHA },
      merge_commit_sha: null,
    }),
    listPullFiles: async () => [{ filename: "src/app.ts" }],
    getCommit: async () => ({
      sha: HEAD_SHA,
      commit: { message: f.message ?? "chore: routine" },
    }),
    getContent: async ({ path }: { path: string }) => {
      if (!(path in contents)) {
        // The shape the real client throws: a 404 in a field, not only in text.
        throw Object.assign(new Error(`GitHub API 404 for ${path}`), { status: 404 });
      }
      return contents[path];
    },
    listWorkflows: async () => [{ path: WF, state: "active" }],
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
    hoisted.resolved.length = 0;
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

  it("hands every --callback command to the prediction, in order", async () => {
    await invoke(
      ["--repo", "o/r", "--pr", "1", "--callback", "npx resolver a", "--callback", "other b"],
      { contents: { [WF]: WORKFLOW } },
    );
    expect(hoisted.resolved).toEqual([["npx resolver a", "other b"]]);
    expect(out).toEqual([`${WF} :: a :: run`, HEAD_READ]);
  });
});
