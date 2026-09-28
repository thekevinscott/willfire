import type { Workflow } from "../types.js";
import type { YamlMap } from "../yamlValue.js";

/** The name of this job's first literal empty matrix axis, or null. */
export function emptyAxisOf(job: Workflow): string | null {
  const strategy = job["strategy"];
  const matrix =
    strategy !== null && typeof strategy === "object" ? (strategy as YamlMap)["matrix"] : undefined;
  if (matrix === null || matrix === undefined || typeof matrix !== "object") {
    return null;
  }
  const empty = Object.entries(matrix as YamlMap).find(
    ([k, v]) => k !== "include" && k !== "exclude" && Array.isArray(v) && v.length === 0,
  );
  return empty === undefined ? null : empty[0];
}
