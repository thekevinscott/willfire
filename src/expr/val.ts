import type { YamlMap, YamlValue } from "../yamlValue.js";

/**
 * A partially-known value.
 *
 * `truthy` and `falsy` exist because short-circuiting yields truthiness
 * without a value: `unknown && false` is falsy, but there is no string to
 * hand back for it. Collapsing those into `unknown` would throw away the
 * only fact worth having.
 */
export type Val =
  | { kind: "value"; v: string | number | boolean }
  /**
   * An array or an object, which `fromJSON` and a structured matrix value
   * produce. Kept apart from `value` because nothing else in the language
   * accepts one: comparison refuses it, and its truthiness is not modelled.
   * Its consumers ask for the document directly — matrix expansion for the
   * array, name rendering for the parenthetical.
   */
  | { kind: "json"; v: YamlValue[] | YamlMap }
  // The valueless kinds declare `v` as absent so a consumer can test `val.v`
  // across the whole union. `json` is the only kind whose `v` can be an array,
  // which is what lets an array test alone stand in for a kind test.
  | { kind: "truthy"; v?: undefined }
  | { kind: "falsy"; v?: undefined }
  | { kind: "unknown"; v?: undefined };

export const UNKNOWN: Val = { kind: "unknown" };

/** What a bare path resolves against. Anything absent is unknown, not empty. */
export interface Scope {
  /**
   * The inputs the caller passed, plus declared defaults for the ones it did
   * not. A key mapped to `unknown` is deliberate: the caller supplied it, but
   * as a `${{ }}` template we cannot evaluate. That is different from absent.
   */
  inputs?: Record<string, Val>;
  /** `github.*` values that are fixed for the run being predicted. */
  github?: Record<string, string>;
  /**
   * Outputs of jobs this workflow's jobs `needs`, keyed by job id.
   *
   * `outputs` is the *complete* set for that job, which is what makes a key
   * that is absent from it mean the empty string — the same answer the runner
   * gives for an output no step wrote. Handing in a partial map is therefore a
   * lie, not a shortcut: leave the job out entirely instead, and every lookup
   * against it stays unknown.
   *
   * The values are raw strings, because that is what a step wrote to
   * `$GITHUB_OUTPUT` and what the runner substitutes. Parsing eagerly would
   * break the guards written against them — `!= '[]'` compares a string to a
   * string, and an array on the left makes it unknown. `fromJSON` is the only
   * thing that turns one into a structure, at the point the workflow asks.
   */
  needs?: Record<string, { outputs: Record<string, string> }>;
  /**
   * Outputs of steps that already ran, keyed by step id. Only one caller can
   * fill this honestly: the executor's step walk (see ../execute/runSteps.ts),
   * which is the single place a step has actually run by the time an
   * expression reads it. The contract is the same as `needs`: a step named
   * here carries its *complete* output set, so an absent key is the empty
   * string the runner substitutes, while a step this map does not name stays
   * unknown. A skipped step is present with no outputs at all — which is
   * exactly what lets `steps.a.outputs.x || steps.b.outputs.x` coalesce past
   * it.
   */
  steps?: Record<string, { outputs: Record<string, string> }>;
  /**
   * The matrix combination in effect: the one a name is being rendered for,
   * or the caller combination a reusable call's `with:` is evaluated under.
   * A job `if:` never sees one — it is evaluated once for the job, before
   * the matrix is expanded.
   */
  matrix?: YamlMap;
}
