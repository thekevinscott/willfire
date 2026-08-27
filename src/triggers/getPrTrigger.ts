import type { Workflow } from "../types.js";

export const MISSING = Symbol("missing");

export function getPrTrigger(wf: Workflow): Record<string, any> | typeof MISSING {
  const on = wf["on"] ?? wf["true"];
  if (on == null) {
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
      return on["pull_request"] ?? {};
    }
    return MISSING;
  }
  return MISSING;
}
