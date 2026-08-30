import { describe, expect, it, vi } from "vitest";
import type { JobExecutor } from "willfire";
import { execKey } from "../../../tests/fixtures/pinned/cassette.js";
import { makeRecordingExecutor } from "./makeRecordingExecutor.js";

// The key derivation is the contract the recorder and the replayer share, so
// it is exercised for real rather than stubbed.
vi.mock(
  "../../../tests/fixtures/pinned/cassette.js",
  async () =>
    await vi.importActual<typeof import("../../../tests/fixtures/pinned/cassette.js")>(
      "../../../tests/fixtures/pinned/cassette.js",
    ),
);

const SCOPE = { event: "pull_request" } as never;
const JOB = { runs_on: "ubuntu-latest" };
const WF = { env: { A: "1" } };

const liveOf = (impl: JobExecutor["executeJob"]): JobExecutor => ({ executeJob: impl });

describe("makeRecordingExecutor", () => {
  it("hands the live outcome back and files it under the executor's own key", async () => {
    const outcome = { ok: true, outputs: { m: "[1]" } } as const;
    const { executor, exec } = makeRecordingExecutor(liveOf(async () => outcome));
    expect(await executor.executeJob("gen", JOB, WF, SCOPE)).toBe(outcome);
    const key = execKey("gen", JOB, WF, SCOPE);
    expect([...exec.values()]).toEqual([{ key, job: "gen", outcome }]);
  });

  it("passes every argument through to the live executor", async () => {
    const live = vi.fn(async () => ({ ok: false, reason: "no" }) as const);
    const { executor } = makeRecordingExecutor(liveOf(live));
    await executor.executeJob("gen", JOB, WF, SCOPE);
    expect(live).toHaveBeenCalledWith("gen", JOB, WF, SCOPE);
  });

  it("keeps one record per distinct run", async () => {
    const { executor, exec } = makeRecordingExecutor(
      liveOf(async (jobId) => ({ ok: true, outputs: { id: jobId } })),
    );
    await executor.executeJob("gen", JOB, WF, SCOPE);
    await executor.executeJob("gen", JOB, WF, SCOPE);
    await executor.executeJob("other", JOB, WF, SCOPE);
    expect([...exec.values()].map((r) => r.job)).toEqual(["gen", "other"]);
  });

  it("records a failed run as readily as a successful one", async () => {
    const outcome = { ok: false, reason: "docker missing" } as const;
    const { executor, exec } = makeRecordingExecutor(liveOf(async () => outcome));
    await executor.executeJob("gen", JOB, WF, SCOPE);
    expect([...exec.values()][0].outcome).toEqual(outcome);
  });
});
