import { UNKNOWN, type Val } from "../expr/val.js";
import { inputLiteral } from "./inputLiteral.js";
import { workflowCallInputs } from "./workflowCallInputs.js";
import type { Workflow } from "../types.js";

export function calleeInputs(withBlock: unknown, subWf: Workflow): Record<string, Val> {
  const out: Record<string, Val> = {};
  for (const [name, decl] of Object.entries(workflowCallInputs(subWf))) {
    out[name] =
      decl != null && typeof decl === "object" && "default" in decl
        ? inputLiteral((decl as Record<string, unknown>)["default"])
        : UNKNOWN;
  }
  if (withBlock != null && typeof withBlock === "object") {
    for (const [name, raw] of Object.entries(withBlock as Record<string, unknown>)) {
      out[name] = inputLiteral(raw);
    }
  }
  return out;
}
