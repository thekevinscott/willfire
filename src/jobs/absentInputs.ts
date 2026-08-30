import type { Val } from "../expr/val.js";
import type { Workflow } from "../types.js";

/** The two triggers that carry an `inputs` context. A `pull_request` is neither. */
const INPUT_TRIGGERS = ["workflow_dispatch", "workflow_call"];

/**
 * Every declared input bound to the empty string, which is what an absent one
 * reads as. `default:` is deliberately ignored: a default is applied by the
 * dispatch or the call, and on a `pull_request` neither happened.
 */
export function absentInputs(wf: Workflow): Record<string, Val> {
  // Tolerates the YAML 1.1 `on` -> true key, as the callee's own lookup does.
  const on = wf["on"] ?? wf["true"];
  const out: Record<string, Val> = {};
  for (const trigger of INPUT_TRIGGERS) {
    for (const name of Object.keys(on?.[trigger]?.["inputs"] ?? {})) {
      out[name] = { kind: "value", v: "" };
    }
  }
  return out;
}
