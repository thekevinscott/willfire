import type { Workflow } from "../types.js";
import type { YamlMap, YamlValue } from "../yamlValue.js";

/** Only as deep as this read goes; anything else under `on:` is not modelled. */
interface OnBlock {
  workflow_call?: { inputs?: YamlValue } | null;
}

/** The `on.workflow_call.inputs` block, tolerating the YAML 1.1 `on` -> true key. */
export function workflowCallInputs(wf: Workflow): YamlMap {
  const on = (wf?.["on"] ?? wf?.["true"]) as OnBlock | undefined;
  const inputs = on?.["workflow_call"]?.["inputs"];
  return inputs !== null && typeof inputs === "object" ? (inputs as YamlMap) : {};
}
