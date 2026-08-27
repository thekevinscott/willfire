import { evaluateValue } from "../expr/evaluateValue.js";
import type { Scope } from "../expr/val.js";
import type { DetailedCombo, DetailedCombos } from "../types.js";

/**
 * The values of one matrix axis, or null when they cannot be known.
 *
 * A plain list is itself. An axis written as an expression —
 * `language: ${{ fromJSON(needs.detect.outputs.coverage_languages) }}` — is
 * the values another job computed, and is knowable exactly when the scope
 * carries that job's outputs. Anything else stays null, which is what makes
 * the whole job `unknown` rather than a guess at how many checks it creates.
 */
function axisValues(v: unknown, scope: Scope): unknown[] | null {
  if (Array.isArray(v)) {
    return v;
  }
  if (typeof v !== "string") {
    return null;
  }
  const val = evaluateValue(v, scope);
  if (val.kind !== "json" || !Array.isArray(val.v)) {
    return null;
  }
  return val.v;
}

/**
 * An `include:`/`exclude:` block: a literal list or an expression evaluating
 * to one. Absent means empty; anything unresolvable fails the expansion.
 */
function comboList(v: unknown, scope: Scope): any[] | null {
  if (v === null || v === undefined) {
    return [];
  }
  if (Array.isArray(v)) {
    return v;
  }
  if (typeof v !== "string") {
    return null;
  }
  const val = evaluateValue(v, scope);
  if (val.kind !== "json" || !Array.isArray(val.v)) {
    return null;
  }
  return val.v;
}

export function expandMatrixDetailed(strategy: any, scope: Scope = {}): DetailedCombos {
  const matrix = strategy?.matrix;
  if (matrix === null || matrix === undefined) {
    return [null];
  }
  // `matrix: ${{ ... }}` — the whole matrix as one expression, rather than the
  // per-axis form below. It yields include-style entries, not axes, so it is a
  // separate expansion and is not modelled.
  if (typeof matrix === "string") {
    return null;
  }
  const include = comboList(matrix.include, scope);
  const exclude = comboList(matrix.exclude, scope);
  if (include === null || exclude === null) {
    return null;
  }
  const axes: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(matrix)) {
    if (k === "include" || k === "exclude") {
      continue;
    }
    const vals = axisValues(v, scope);
    if (vals === null) {
      return null;
    }
    axes[k] = vals;
  }
  const axisKeys = Object.keys(axes);
  let combos: DetailedCombo[] = [{ values: {}, displayKeys: axisKeys }];
  for (const [k, vals] of Object.entries(axes)) {
    combos = combos.flatMap((c) =>
      vals.map((v) => ({ values: { ...c.values, [k]: v }, displayKeys: axisKeys })),
    );
  }
  if (axisKeys.length === 0) {
    combos = [];
  }
  combos = combos.filter(
    (c) => !exclude.some((ex) => Object.entries(ex).every(([k, v]) => c.values[k] === v)),
  );
  const extra: DetailedCombo[] = [];
  for (const inc of include) {
    const overlapping = Object.fromEntries(
      Object.entries(inc).filter(([k]) => k in axes),
    );
    const targets = combos.filter((c) =>
      Object.entries(overlapping).every(([k, v]) => c.values[k] === v),
    );
    if (axisKeys.length > 0 && targets.length > 0) {
      // Merge into the matching combinations. With no overlapping keys this
      // matches every combination, per the docs ("added to each of the matrix
      // combinations if none of the key:value pairs overwrite any of the
      // original matrix values").
      for (const c of targets) {
        Object.assign(c.values, inc);
      }
    } else {
      // No combination to attach to: the include entry becomes a combination
      // of its own, and every one of its keys shows in the name.
      extra.push({ values: { ...inc }, displayKeys: Object.keys(inc) });
    }
  }
  combos.push(...extra);
  // Zero combinations is a real answer, not a missing one: an empty axis, or an
  // `exclude` that removes everything, schedules no jobs at all. Only an absent
  // `matrix:` key means "one unsuffixed job", and that returned above.
  return combos;
}
