import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { stepOutcome } from "./stepOutcome.js";

// The isolation gate wants collaborators mocked; reading a real GITHUB_OUTPUT
// is what this suite pins, so the mocks pass the real modules through.
vi.mock(
  "node:fs/promises",
  async () => await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
);
vi.mock("node:os", async () => await vi.importActual<typeof import("node:os")>("node:os"));
vi.mock("node:path", async () => await vi.importActual<typeof import("node:path")>("node:path"));

const ok = { code: 0, stdout: "", stderr: "" };

let outFile: string;

beforeAll(async () => {
  outFile = join(await mkdtemp(join(tmpdir(), "willfire-outcome-")), "output");
});

describe("stepOutcome", () => {
  it("reads GITHUB_OUTPUT on success", async () => {
    await writeFile(outFile, "one=1\ntwo=2\n");
    expect(await stepOutcome(ok, outFile, "step")).toEqual({
      ok: true,
      v: { one: "1", two: "2" },
    });
  });

  it("refuses a malformed GITHUB_OUTPUT", async () => {
    await writeFile(outFile, "no-delimiter\n");
    expect(await stepOutcome(ok, outFile, "step")).toEqual({
      ok: false,
      reason: "step: malformed GITHUB_OUTPUT",
    });
  });

  it("quotes the failure cause on a non-zero exit", async () => {
    const r = { code: 2, stdout: "", stderr: "boom\n" };
    expect(await stepOutcome(r, outFile, "step")).toEqual({
      ok: false,
      reason: "step: exited 2\nboom",
    });
  });

  it("omits the quote when neither stream said anything", async () => {
    const r = { code: 2, stdout: "", stderr: "" };
    expect(await stepOutcome(r, outFile, "step")).toEqual({
      ok: false,
      reason: "step: exited 2",
    });
  });
});
