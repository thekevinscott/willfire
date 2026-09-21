import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnCollect, type Collected } from "../spawnCollect.js";
import { runCallbacks } from "./runCallbacks.js";

vi.mock("../spawnCollect.js", async () => {
  const actual = await vi.importActual<typeof import("../spawnCollect.js")>("../spawnCollect.js");
  return { ...actual, spawnCollect: vi.fn() };
});

const KEY_A = "o/r/.github/workflows/a.yml:plan";
const KEY_B = "o/r/.github/workflows/b.yml:detect";

const mapDoc = (key: string) =>
  JSON.stringify({ [key]: [{ inputs: {}, outputs: { checks: "[]" } }] });

const said = (stdout: string): Collected => ({ code: 0, stdout, stderr: "" });

const script = (...results: Collected[]): void => {
  const queue = [...results];
  vi.mocked(spawnCollect).mockImplementation(async () => queue.shift() ?? said("{}"));
};

const calls = () => vi.mocked(spawnCollect).mock.calls;

beforeEach(() => {
  vi.mocked(spawnCollect).mockReset();
  script();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runCallbacks", () => {
  it("runs each command as bare argv, keeping stdout whole", async () => {
    script(said("{}"));
    const r = await runCallbacks([["npx", "putitoutthere", "resolve"]]);
    expect(r).toEqual({ ok: true, map: {} });
    expect(calls()).toHaveLength(1);
    const [bin, argv, opts] = calls()[0];
    expect(bin).toBe("npx");
    expect(argv).toEqual(["putitoutthere", "resolve"]);
    // The map is parsed from stdout whole, and a callback gets no cwd or stdin.
    expect(opts.wholeStdout).toBe(true);
    expect(opts.cwd).toBeUndefined();
    expect(opts.stdin).toBeUndefined();
  });

  it("hands over the invoker's env minus the GitHub tokens, adding nothing", async () => {
    vi.stubEnv("GH_TOKEN", "secret-a");
    vi.stubEnv("GITHUB_TOKEN", "secret-b");
    vi.stubEnv("CALLBACK_MARKER", "kept");
    await runCallbacks([["resolver"]]);
    const expected = { ...process.env };
    delete expected.GH_TOKEN;
    delete expected.GITHUB_TOKEN;
    expect(calls()[0][2].env).toEqual(expected);
    expect(calls()[0][2].env.CALLBACK_MARKER).toBe("kept");
  });

  it("merges the maps of every callback", async () => {
    script(said(mapDoc(KEY_A)), said(mapDoc(KEY_B)));
    const r = await runCallbacks([["resolver-a"], ["resolver-b"]]);
    expect(r).toEqual({
      ok: true,
      map: {
        [KEY_A]: [{ inputs: {}, outputs: { checks: "[]" } }],
        [KEY_B]: [{ inputs: {}, outputs: { checks: "[]" } }],
      },
    });
    expect(calls().map((c) => c[0])).toEqual(["resolver-a", "resolver-b"]);
  });

  it("is fatal when a callback cannot be started at all", async () => {
    script({ failed: "spawn ENOENT" });
    expect(await runCallbacks([["no-such-bin", "arg"]])).toEqual({
      ok: false,
      reason: "callback 'no-such-bin arg' failed to start: spawn ENOENT",
    });
  });

  it("is fatal on a non-zero exit, quoting stderr", async () => {
    script({ code: 2, stdout: "", stderr: "warning: setup\nfatal: no lockfile\n" });
    expect(await runCallbacks([["npx", "resolver"]])).toEqual({
      ok: false,
      reason: "callback 'npx resolver' exited 2\nwarning: setup\nfatal: no lockfile",
    });
  });

  it("reports a silent non-zero exit without an empty quote", async () => {
    script({ code: 3, stdout: "", stderr: "" });
    expect(await runCallbacks([["resolver"]])).toEqual({
      ok: false,
      reason: "callback 'resolver' exited 3",
    });
  });

  it("is fatal when stdout is not the documented map, naming the callback", async () => {
    script(said("not json"));
    expect(await runCallbacks([["resolver"]])).toEqual({
      ok: false,
      reason: "callback 'resolver': stdout is not JSON",
    });
  });

  it("refuses the same key from two callbacks, after both have run", async () => {
    script(said(mapDoc(KEY_A)), said(mapDoc(KEY_A)));
    expect(await runCallbacks([["resolver-a"], ["resolver-b"]])).toEqual({
      ok: false,
      reason: `'${KEY_A}' is answered by two callbacks: 'resolver-a' and 'resolver-b'`,
    });
    expect(calls()).toHaveLength(2);
  });

  it("runs nothing and answers the empty map for no callbacks", async () => {
    expect(await runCallbacks([])).toEqual({ ok: true, map: {} });
    expect(spawnCollect).not.toHaveBeenCalled();
  });
});
