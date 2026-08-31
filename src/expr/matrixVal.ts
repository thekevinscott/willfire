import { lookupPath } from "./lookupPath.js";
import { UNKNOWN, type Val } from "./val.js";
import type { YamlMap } from "../yamlValue.js";

/**
 * `matrix.<path>` against the combination being named.
 *
 * An absent key stays unknown rather than collapsing to the empty string.
 * GitHub does substitute nothing for it, but that is unverified here and the
 * two existing name assertions read the other way.
 */
export function matrixVal(matrix: YamlMap, path: string): Val {
  const found = lookupPath(matrix, path);
  if (found === undefined) {
    return UNKNOWN;
  }
  if (found === null) {
    return { kind: "value", v: "" };
  }
  if (typeof found === "object") {
    return { kind: "json", v: found };
  }
  return { kind: "value", v: found };
}
