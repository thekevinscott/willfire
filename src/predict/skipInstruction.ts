const SKIP_RE = /\[(skip ci|ci skip|no ci|skip actions|actions skip)\]/i;
const SKIP_TRAILER_RE = /^skip-checks:\s*true/im;

/** Whether a head commit message tells GitHub to dispatch nothing at all. */
export function hasSkipInstruction(message: string): boolean {
  return SKIP_RE.test(message) || SKIP_TRAILER_RE.test(message);
}
