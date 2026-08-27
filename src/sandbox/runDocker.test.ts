import { spawn } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDocker } from "./runDocker.js";

interface Behavior {
  stderr?: string[];
  close?: number | null;
  error?: true;
}

const h = vi.hoisted(() => ({
  calls: [] as { bin: string; argv: string[]; stdin: string; stdio: unknown }[],
  script: [] as { stderr?: string[]; close?: number | null; error?: true }[],
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const fakeSpawn = vi.fn((bin: string, argv: string[], opts: { stdio: unknown }) => {
    const behavior: Behavior = h.script.shift() ?? {};
    const call = { bin, argv, stdin: "", stdio: opts.stdio };
    h.calls.push(call);
    const handlers = new Map<string, (arg?: unknown) => void>();
    const child = {
      stderr: { on: (ev: string, cb: (d: unknown) => void) => handlers.set(`stderr:${ev}`, cb) },
      stdin: {
        write: (d: string) => {
          call.stdin += d;
        },
        end: () => {},
      },
      on: (ev: string, cb: (arg?: unknown) => void) => handlers.set(ev, cb),
    };
    queueMicrotask(() => {
      if (behavior.error) {
        handlers.get("error")?.(new Error("spawn ENOENT"));
        return;
      }
      handlers.get("spawn")?.();
      for (const chunk of behavior.stderr ?? []) {
        handlers.get("stderr:data")?.(chunk);
      }
      handlers.get("close")?.(behavior.close === undefined ? 0 : behavior.close);
    });
    return child as unknown as ReturnType<typeof actual.spawn>;
  });
  return { ...actual, spawn: fakeSpawn as unknown as typeof actual.spawn };
});

beforeEach(() => {
  h.calls.length = 0;
  h.script.length = 0;
  vi.mocked(spawn).mockClear();
});

describe("runDocker", () => {
  it("runs the binary with the argv and hands back code and stderr", async () => {
    h.script = [{ close: 7, stderr: ["boom\n"] }];
    const r = await runDocker("dkr", ["image", "inspect", "t"]);
    expect(r).toEqual({ code: 7, stderr: "boom\n" });
    expect(h.calls[0]).toMatchObject({ bin: "dkr", argv: ["image", "inspect", "t"] });
  });

  it("pipes stdin only when given one", async () => {
    h.script = [{}, {}];
    await runDocker("dkr", ["build", "-"], "FROM x\n");
    await runDocker("dkr", ["run"]);
    expect(h.calls[0].stdin).toBe("FROM x\n");
    expect(h.calls[0].stdio).toEqual(["pipe", "ignore", "pipe"]);
    expect(h.calls[1].stdin).toBe("");
    expect(h.calls[1].stdio).toEqual(["ignore", "ignore", "pipe"]);
  });

  it("reports a missing binary as 127", async () => {
    h.script = [{ error: true }];
    expect(await runDocker("/nonexistent/docker", ["run"])).toEqual({ code: 127, stderr: "" });
  });

  it("reports a signal death as exit 1", async () => {
    h.script = [{ close: null }];
    expect((await runDocker("dkr", ["run"])).code).toBe(1);
  });

  it("caps captured stderr at its tail", async () => {
    h.script = [{ close: 0, stderr: [`${"x".repeat(5000)}END\n`] }];
    const r = await runDocker("dkr", ["run"]);
    expect(r.stderr.length).toBeLessThanOrEqual(4096);
    expect(r.stderr).toContain("END");
  });
});
