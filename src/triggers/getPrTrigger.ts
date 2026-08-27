import type { Workflow } from "../types.js";
import type { YamlMap } from "../yamlValue.js";

export const MISSING = Symbol("missing");

export function getPrTrigger(wf: Workflow): YamlMap | typeof MISSING {
  // YAML 1.1 parsers read `on` as boolean true; the `yaml` package (1.2)
  // keeps it a string key. Handle both.
  const on = wf["on"] ?? wf["true"];
  if (on === null || on === undefined) {
    return MISSING;
  }
  if (typeof on === "string") {
    return on === "pull_request" ? {} : MISSING;
  }
  if (Array.isArray(on)) {
    return on.includes("pull_request") ? {} : MISSING;
  }
  if (typeof on === "object") {
    if ("pull_request" in on) {
      return (on["pull_request"] ?? {}) as YamlMap;
    }
    return MISSING;
  }
  return MISSING;
}
