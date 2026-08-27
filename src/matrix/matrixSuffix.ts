import { formatMatrixValue } from "./formatMatrixValue.js";
import type { DetailedCombo } from "../types.js";

export function matrixSuffix(combo: DetailedCombo): string {
  const keys = combo.displayKeys.filter((k) => k in combo.values);
  if (keys.length === 0) {
    return "";
  }
  return ` (${keys.map((k) => formatMatrixValue(combo.values[k])).join(", ")})`;
}
