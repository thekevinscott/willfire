import type { Val } from "../expr/val.js";
import type { Workflow } from "../types.js";

/** The two triggers that carry an `inputs` context. A `pull_request` is neither. */
const INPUT_TRIGGERS = ["workflow_dispatch", "workflow_call"];

/**
 * Every input the workflow declares, bound to the empty string.
 *
 * GitHub hands the `inputs` context only to a run that was dispatched or
 * called, so on the `pull_request` this predicts, a declared input nothing
 * supplied is absent — and absent reads as the empty string, `default:`
 * included, because a default is applied by the dispatch or the call that did
 * not happen.
 *
 * A floor, never a replacement: what a caller actually passed is layered over
 * this, so `calleeInputs` keeps the last word inside a called workflow.
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
