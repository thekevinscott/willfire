import type { JobName } from "../types.js";

/** Tag a job display name. Rejects the workflow-level sentinel. */
export function jobName<S extends string>(name: S extends "*" ? never : S): JobName {
  // The parameter is a deferred conditional, which is not comparable to the
  // brand; widening it to `string` first makes the assertion a single step.
  const plain: string = name;
  return plain as JobName;
}
