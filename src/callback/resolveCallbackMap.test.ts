import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCallbacks } from "./runCallbacks.js";
import { resolveCallbackMap } from "./resolveCallbackMap.js";

vi.mock("./runCallbacks.js", async () => {
  const actual = await vi.importActual<typeof import("./runCallbacks.js")>("./runCallbacks.js");
  return { ...actual, runCallbacks: vi.fn(actual.runCallbacks) };
});

describe("resolveCallbackMap", () => {
  beforeEach(() => {
    vi.mocked(runCallbacks).mockClear();
  });

  it("is absent when no callbacks were asked for, without running anything", async () => {
    expect(await resolveCallbackMap([])).toBeUndefined();
    expect(runCallbacks).not.toHaveBeenCalled();
  });

  it("splits each command on whitespace and answers the merged map", async () => {
    const map = { "o/r/.github/workflows/w.yml:plan": [] };
    vi.mocked(runCallbacks).mockResolvedValueOnce({ ok: true, map });
    expect(await resolveCallbackMap(["npx resolver one", " other  b "])).toBe(map);
    expect(runCallbacks).toHaveBeenCalledWith([
      ["npx", "resolver", "one"],
      ["other", "b"],
    ]);
  });

  it("throws the parse refusal for a malformed command, running nothing", async () => {
    await expect(resolveCallbackMap(["-x resolve"])).rejects.toThrow(
      "--callback command cannot start with '-': -x",
    );
    expect(runCallbacks).not.toHaveBeenCalled();
  });

  it("throws what the callbacks failed with", async () => {
    vi.mocked(runCallbacks).mockResolvedValueOnce({
      ok: false,
      reason: "callback 'resolver' exited 2",
    });
    await expect(resolveCallbackMap(["resolver"])).rejects.toThrow("callback 'resolver' exited 2");
  });
});
