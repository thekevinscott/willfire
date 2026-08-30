import type { Workflow } from "../types.js";

/** The `on.workflow_call.inputs` block, tolerating the YAML 1.1 `on` -> true key. */
export function workflowCallInputs(wf: Workflow): Record<string, any> {
  const on = wf?.["on"] ?? wf?.["true"];
  const inputs = on?.["workflow_call"]?.["inputs"];
  return inputs !== null && typeof inputs === "object" ? inputs : {};
}
