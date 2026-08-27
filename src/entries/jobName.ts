import type { JobName } from "../types.js";

export const jobName = <S extends string>(name: S extends "*" ? never : S): JobName =>
  name as unknown as JobName;
