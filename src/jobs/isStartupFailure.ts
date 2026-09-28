import type { StartupFailure } from "./startupFailure.js";

/** Tells a broken call graph from a transient read failure, which must keep propagating. */
export function isStartupFailure(e: unknown): e is StartupFailure {
  return e instanceof Error && (e as Partial<StartupFailure>).startupFailure === true;
}
