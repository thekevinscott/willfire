/** Does a head commit message tell GitHub to dispatch nothing? */
export function hasSkipInstruction(message: string): boolean {
  // Inline literals, not module-scope consts: a regex const is a static mutant
  // that the mutation gate reports as surviving without running a test at it.
  return (
    /\[(skip ci|ci skip|no ci|skip actions|actions skip)\]/i.test(message) ||
    // The trailer counts only where GitHub documents it: two empty lines, then
    // it, then the end of the message. Probe #391 (one empty line) and #392
    // (prose after it) both dispatched; #380 (both) did not.
    /\n\n\nskip-checks:[ \t]*true\s*$/i.test(message)
  );
}
