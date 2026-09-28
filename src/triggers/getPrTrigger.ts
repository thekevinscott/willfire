import type { Workflow } from "../types.js";
import type { YamlMap } from "../yamlValue.js";

export const MISSING = Symbol("missing");

/** The two PR-shaped events. They differ only in which ref the file is read from. */
export type PrEvent = "pull_request" | "pull_request_target";

export function getPrTrigger(wf: Workflow, event: PrEvent = "pull_request"): YamlMap | typeof MISSING {
  // YAML 1.1 parsers read `on` as boolean true; the `yaml` package (1.2)
  // keeps it a string key. Handle both.
  const on = wf["on"] ?? wf["true"];
  if (on === null || on === undefined) {
    return MISSING;
  }
  if (typeof on === "string") {
    return on === event ? {} : MISSING;
  }
  if (Array.isArray(on)) {
    return on.includes(event) ? {} : MISSING;
  }
  if (typeof on === "object") {
    if (event in on) {
      return (on[event] ?? {}) as YamlMap;
    }
    return MISSING;
  }
  return MISSING;
}
