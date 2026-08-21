import type { JobName } from "../types.js";

/** Tag a job display name. Rejects the workflow-level sentinel. */
export const jobName = <S extends string>(name: S extends "*" ? never : S): JobName =>
  name as unknown as JobName;
