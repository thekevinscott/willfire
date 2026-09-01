import type { Scope } from "../expr/val.js";
import type { DetailedCombo, DetailedCombos } from "../types.js";
import type { YamlMap, YamlValue } from "../yamlValue.js";
import { axisValues } from "./axisValues.js";
import { comboList } from "./comboList.js";

export function expandMatrixDetailed(strategy: unknown, scope: Scope = {}): DetailedCombos {
  const matrix =
    strategy !== null && typeof strategy === "object"
      ? (strategy as YamlMap)["matrix"]
      : undefined;
  if (matrix === null || matrix === undefined) {
    return [null];
  }
  // `matrix: ${{ ... }}` — the whole matrix as one expression, rather than the
  // per-axis form below. It yields include-style entries, not axes, so it is a
  // separate expansion and is not modelled.
  if (typeof matrix === "string") {
    return null;
  }
  const m = matrix as YamlMap;
  const include = comboList(m["include"], scope);
  const exclude = comboList(m["exclude"], scope);
  if (include === null || exclude === null) {
    return null;
  }
  const axes: Record<string, YamlValue[]> = {};
  for (const [k, v] of Object.entries(m)) {
    if (k !== "include" && k !== "exclude") {
      const vals = axisValues(v, scope);
      if (vals === null) {
        return null;
      }
      axes[k] = vals;
    }
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
