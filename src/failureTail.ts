import { tailLine } from "./tailLine.js";

/**
 * The line to quote when a command exits non-zero. stderr first, falling back
 * to stdout: pnpm prints fatal errors such as ERR_PNPM_NO_PKG_MANIFEST there,
 * and so does `core.setFailed`, so stderr alone can quote no cause at all.
 */
export const failureTail = (r: { stdout: string; stderr: string }): string => {
  const fromStderr = tailLine(r.stderr);
  return fromStderr === "" ? tailLine(r.stdout) : fromStderr;
};
