import type { Workflow } from "../types.js";

export function workflowCallInputs(wf: Workflow): Record<string, any> {
  const on = wf?.["on"] ?? wf?.["true"];
  if (on == null || typeof on !== "object") {
    return {};
  }
  const call = (on as Record<string, any>)["workflow_call"];
  if (call == null || typeof call !== "object") {
    return {};
  }
  const inputs = call["inputs"];
  return inputs != null && typeof inputs === "object" ? inputs : {};
}
