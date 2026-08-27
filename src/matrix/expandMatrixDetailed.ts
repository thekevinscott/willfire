import { evaluateValue } from "../expr/evaluateValue.js";
import type { Scope } from "../expr/val.js";
import type { DetailedCombo, DetailedCombos } from "../types.js";

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

export function expandMatrixDetailed(strategy: any, scope: Scope = {}): DetailedCombos {
  const matrix = strategy?.matrix;
  if (matrix == null) {
    return [null];
  }
  if (typeof matrix === "string") {
    return null;
  }
  const include: any[] = matrix.include ?? [];
  const exclude: any[] = matrix.exclude ?? [];
  if (typeof include === "string" || typeof exclude === "string") {
    return null;
  }
  const axes: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(matrix)) {
    if (k === "include" || k === "exclude") {
      continue;
    }
    const vals = axisValues(v, scope);
    if (vals == null) {
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
      for (const c of targets) {
        Object.assign(c.values, inc);
      }
    } else {
      extra.push({ values: { ...inc }, displayKeys: Object.keys(inc) });
    }
  }
  combos.push(...extra);
  return combos;
}
