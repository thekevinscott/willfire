import type { Val } from "../expr/val.js";
import type { Workflow } from "../types.js";
import type { YamlMap } from "../yamlValue.js";

/** The two triggers that carry an `inputs` context. A `pull_request` is neither. */
const INPUT_TRIGGERS = ["workflow_dispatch", "workflow_call"];

/** Only as deep as this read goes; anything else under `on:` is not modelled. */
interface OnBlock {
  [trigger: string]: { inputs?: YamlMap | null } | undefined;
}

/**
 * Every declared input bound to the empty string, which is what an absent one
 * reads as. `default:` is deliberately ignored: a default is applied by the
 * dispatch or the call, and on a `pull_request` neither happened.
 */
export function absentInputs(wf: Workflow): Record<string, Val> {
  // Tolerates the YAML 1.1 `on` -> true key, as the callee's own lookup does.
  const on = (wf["on"] ?? wf["true"]) as OnBlock | undefined;
  const out: Record<string, Val> = {};
  for (const trigger of INPUT_TRIGGERS) {
    for (const name of Object.keys(on?.[trigger]?.["inputs"] ?? {})) {
      out[name] = { kind: "value", v: "" };
    }
  }
  return out;
}
