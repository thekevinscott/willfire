import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCallbacks } from "./runCallbacks.js";

interface SpawnOpts {
  env: Record<string, string | undefined>;
  stdio: unknown;
  cwd?: unknown;
  shell?: unknown;
}

const h = vi.hoisted(() => ({
  calls: [] as { bin: string; argv: string[]; opts: SpawnOpts }[],
  script: [] as { stdout?: string[]; stderr?: string[]; close?: number | null; error?: true }[],
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const fakeSpawn = vi.fn((bin: string, argv: string[], opts: SpawnOpts) => {
    const behavior = h.script.shift() ?? {};
    h.calls.push({ bin, argv, opts });
    const handlers = new Map<string, (arg?: unknown) => void>();
    const child = {
      stdout: { on: (ev: string, cb: (d?: unknown) => void) => handlers.set(`stdout:${ev}`, cb) },
      stderr: { on: (ev: string, cb: (d?: unknown) => void) => handlers.set(`stderr:${ev}`, cb) },
      on: (ev: string, cb: (arg?: unknown) => void) => handlers.set(ev, cb),
    };
    // After the synchronous return, so every handler is registered first.
    queueMicrotask(() => {
      if (behavior.error) {
        handlers.get("error")?.(new Error("spawn ENOENT"));
        return;
      }
      for (const chunk of behavior.stdout ?? []) {
        handlers.get("stdout:data")?.(chunk);
      }
      for (const chunk of behavior.stderr ?? []) {
        handlers.get("stderr:data")?.(chunk);
      }
      handlers.get("close")?.(behavior.close === undefined ? 0 : behavior.close);
    });
    return child as unknown as ReturnType<typeof actual.spawn>;
  });
  return { ...actual, spawn: fakeSpawn as unknown as typeof actual.spawn };
});

const KEY_A = "o/r/.github/workflows/a.yml:plan";
const KEY_B = "o/r/.github/workflows/b.yml:detect";

const mapDoc = (key: string) =>
  JSON.stringify({ [key]: [{ inputs: {}, outputs: { checks: "[]" } }] });

beforeEach(() => {
  h.calls.length = 0;
  h.script.length = 0;
  vi.mocked(spawn).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runCallbacks", () => {
  it("spawns each command as bare argv — no shell, no cwd override", async () => {
    h.script = [{ stdout: ["{}"] }];
    const r = await runCallbacks([["npx", "putitoutthere", "resolve"]]);
    expect(r).toEqual({ ok: true, map: {} });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].bin).toBe("npx");
    expect(h.calls[0].argv).toEqual(["putitoutthere", "resolve"]);
    expect(h.calls[0].opts.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect("cwd" in h.calls[0].opts).toBe(false);
    expect("shell" in h.calls[0].opts).toBe(false);
  });

  it("hands over the invoker's env minus the GitHub tokens, adding nothing", async () => {
    vi.stubEnv("GH_TOKEN", "secret-a");
    vi.stubEnv("GITHUB_TOKEN", "secret-b");
    vi.stubEnv("CALLBACK_MARKER", "kept");
    h.script = [{ stdout: ["{}"] }];
    await runCallbacks([["resolver"]]);
    const expected = { ...process.env };
    delete expected.GH_TOKEN;
    delete expected.GITHUB_TOKEN;
    expect(h.calls[0].opts.env).toEqual(expected);
    expect(h.calls[0].opts.env.CALLBACK_MARKER).toBe("kept");
  });

  it("assembles stdout across chunks and merges the maps of every callback", async () => {
    const doc = mapDoc(KEY_A);
    h.script = [
      { stdout: [doc.slice(0, 10), doc.slice(10)] },
      { stdout: [mapDoc(KEY_B)] },
    ];
    const r = await runCallbacks([["resolver-a"], ["resolver-b"]]);
    expect(r).toEqual({
      ok: true,
      map: {
        [KEY_A]: [{ inputs: {}, outputs: { checks: "[]" } }],
        [KEY_B]: [{ inputs: {}, outputs: { checks: "[]" } }],
      },
    });
    expect(h.calls.map((c) => c.bin)).toEqual(["resolver-a", "resolver-b"]);
  });

  it("is fatal when a callback cannot be started at all", async () => {
    h.script = [{ error: true }];
    expect(await runCallbacks([["no-such-bin", "arg"]])).toEqual({
      ok: false,
      reason: "callback 'no-such-bin arg' failed to start: spawn ENOENT",
    });
  });

  it("is fatal on a non-zero exit, quoting the last stderr line", async () => {
    h.script = [{ stderr: ["warning: setup\n", "fatal: no lockfile\n"], close: 2 }];
    expect(await runCallbacks([["npx", "resolver"]])).toEqual({
      ok: false,
      reason: "callback 'npx resolver' exited 2 (fatal: no lockfile)",
    });
  });

  it("reports a silent non-zero exit without an empty quote", async () => {
    h.script = [{ close: 3 }];
    expect(await runCallbacks([["resolver"]])).toEqual({
      ok: false,
      reason: "callback 'resolver' exited 3",
    });
  });

  it("keeps only the stderr tail when a callback floods it", async () => {
    h.script = [{ stderr: ["x".repeat(5000)], close: 1 }];
    expect(await runCallbacks([["resolver"]])).toEqual({
      ok: false,
      reason: `callback 'resolver' exited 1 (${"x".repeat(4096)})`,
    });
  });

  it("treats a close without an exit code as a failure", async () => {
    h.script = [{ close: null }];
    expect(await runCallbacks([["resolver"]])).toEqual({
      ok: false,
      reason: "callback 'resolver' exited 1",
    });
  });

  it("is fatal when stdout is not the documented map, naming the callback", async () => {
    h.script = [{ stdout: ["not json"] }];
    expect(await runCallbacks([["resolver"]])).toEqual({
      ok: false,
      reason: "callback 'resolver': stdout is not JSON",
    });
  });

  it("refuses the same key from two callbacks, after both have run", async () => {
    h.script = [{ stdout: [mapDoc(KEY_A)] }, { stdout: [mapDoc(KEY_A)] }];
    expect(await runCallbacks([["resolver-a"], ["resolver-b"]])).toEqual({
      ok: false,
      reason: `'${KEY_A}' is answered by two callbacks: 'resolver-a' and 'resolver-b'`,
    });
    expect(h.calls).toHaveLength(2);
  });

  it("runs nothing and answers the empty map for no callbacks", async () => {
    expect(await runCallbacks([])).toEqual({ ok: true, map: {} });
    expect(spawn).not.toHaveBeenCalled();
  });
});
