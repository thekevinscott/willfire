import type { Workflow } from "../types.js";

export const MISSING = Symbol("missing");

export function getPrTrigger(wf: Workflow): Record<string, unknown> | typeof MISSING {
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
      const trig = (on as Record<string, unknown>)["pull_request"];
      return trig !== null && trig !== undefined ? (trig as Record<string, unknown>) : {};
    }
    return MISSING;
  }
  return MISSING;
}
