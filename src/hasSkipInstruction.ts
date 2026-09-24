/** Does a head commit message tell GitHub to dispatch nothing? */
export function hasSkipInstruction(message: string): boolean {
  // Inline literals, not module-scope consts: a regex const is a static mutant
  // that the mutation gate reports as surviving without running a test at it.
  return (
    /\[(skip ci|ci skip|no ci|skip actions|actions skip)\]/i.test(message) ||
    /^skip-checks:\s*true/im.test(message)
  );
}
