import type { DisplayName, Workflow } from "../types.js";

export function skippedDisplayName(jobId: string, job: Workflow): DisplayName {
  const raw = job != null && job.name != null ? String(job.name) : null;
  return { name: raw ?? jobId, resolved: true };
}
