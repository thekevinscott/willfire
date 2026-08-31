import type { JobExecutor } from "willfire";
import { execKey, type ExecRecord } from "../../../tests/fixtures/pinned/capture.js";

/**
 * A `JobExecutor` that runs the live one and keeps each outcome. Keyed by
 * `execKey` off the executor's own arguments, so the recorder and the replayer
 * cannot drift apart about what identifies a run.
 */
export function makeRecordingExecutor(live: JobExecutor): {
  executor: JobExecutor;
  exec: Map<string, ExecRecord>;
} {
  const exec = new Map<string, ExecRecord>();
  return {
    executor: {
      executeJob: async (jobId, job, wf, scope) => {
        const outcome = await live.executeJob(jobId, job, wf, scope);
        const key = execKey(jobId, job, wf, scope);
        exec.set(key, { key, job: jobId, outcome });
        return outcome;
      },
    },
    exec,
  };
}
