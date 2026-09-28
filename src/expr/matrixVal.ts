import { lookupPath } from "./lookupPath.js";
import { UNKNOWN, type Val } from "./val.js";
import type { YamlMap } from "../yamlValue.js";

/**
 * `matrix.<path>` against the combination being named, or against no
 * combination at all — a job `if:` is evaluated before the matrix expands.
 *
 * A key the combination does not carry substitutes nothing. Probe PR #372 over
 * `a: [x, y]` with `include: [{a: x, label: L}]`: `name: build ${{ matrix.label
 * }}` dispatched `build L` and `build` (run 36431257532), and `name: ${{
 * matrix.label }} build` dispatched `L build` and `build` (run 36431257588).
 * With no combination at all there is nothing to be absent *from*, so that
 * stays unknown.
 */
export function matrixVal(matrix: YamlMap | undefined, path: string): Val {
  const found = lookupPath(matrix, path);
  if (found === undefined) {
    return matrix === undefined ? UNKNOWN : { kind: "value", v: "" };
  }
  if (found === null) {
    return { kind: "value", v: "" };
  }
  if (typeof found === "object") {
    return { kind: "json", v: found };
  }
  return { kind: "value", v: found };
}
