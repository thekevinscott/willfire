import type { Workflow } from "../types.js";

/** The `on.workflow_call.inputs` block, tolerating the YAML 1.1 `on` -> true key. */
export function workflowCallInputs(wf: Workflow): Record<string, any> {
  const on = wf?.["on"] ?? wf?.["true"];
  if (on === null || typeof on !== "object") {
    return {};
  }
  const call = (on as Record<string, any>)["workflow_call"];
  if (call === null || call === undefined) {
    return {};
  }
  const inputs = call["inputs"];
  return inputs !== null && typeof inputs === "object" ? inputs : {};
}
