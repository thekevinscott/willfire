import type { StartupFailure } from "./startupFailure.js";

/** Tells a broken call graph from a transient read failure, which must keep propagating. */
export const isStartupFailure = (e: unknown): e is StartupFailure =>
  e instanceof Error && (e as Partial<StartupFailure>).startupFailure === true;
