/**
 * A tri-state evaluator for the slice of GitHub expressions that job `if:`
 * conditions actually use.
 *
 * The point is not to reimplement the expression language. It is to stop
 * returning `unknown` for conditions that are already decided. A reusable
 * workflow's jobs commonly guard on the caller's own literals:
 *
 *     if: ${{ github.event_name == 'pull_request'
 *             && (inputs.gates == '' || contains(inputs.gates, '"mutation"'))
 *             && (needs.detect.outputs.mutation_languages || ...) != '[]' }}
 *
 * The last clause needs a job that has not run yet. The middle one does not:
 * the caller passed `gates` as a literal string, and it does not contain
 * `"mutation"`, so the clause is false, so the whole `&&` is false whatever
 * `detect` reports. Deciding that is the difference between a predictable
 * check name and a hole in the prediction.
 *
 * Two ideas carry the whole module:
 *
 * 1. **Truthiness can be known when the value is not.** `A && B` with an
 *    unknown `A` and a false `B` is false either way. So the lattice has four
 *    points, not three: a concrete value, known-truthy, known-falsy, and
 *    nothing at all.
 *
 * 2. **Unrecognized is unknown, never a guess.** An unparseable condition, an
 *    unsupported function, a comparison between types we do not model — all
 *    collapse to `unknown` and leave the caller exactly where it was. This
 *    adds no tolerance and no third outcome; it converts conditions that are
 *    already decidable into the answer they already have.
 */
export { evaluate } from "./evaluate.js";
export { evaluateValue } from "./evaluateValue.js";
export { UNKNOWN } from "./val.js";
export type { Scope, Val } from "./val.js";
