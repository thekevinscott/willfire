import { UNKNOWN, type Scope, type Val } from "../expr/val.js";
import { inputValue } from "./inputValue.js";
import { workflowCallInputs } from "./workflowCallInputs.js";
import type { Workflow } from "../types.js";
import type { YamlValue } from "../yamlValue.js";

/**
 * What `inputs.*` resolves to inside a called workflow: what the caller passed,
 * over the defaults the callee declares.
 *
 * A declared input the caller omits falls back to its `default`. A declared
 * input with no default and no caller value is unknown rather than empty — the
 * workflow would be invalid if it were required, and guessing empty would
 * silently decide guards that are not decided.
 */
export function calleeInputs(
  withBlock: YamlValue | undefined,
  subWf: Workflow,
  scope: Scope,
): Record<string, Val> {
  const out: Record<string, Val> = {};
  for (const [name, decl] of Object.entries(workflowCallInputs(subWf))) {
    out[name] =
      decl !== null && typeof decl === "object" && "default" in decl
        ? // Defaults live in the callee, out of the caller's context's reach.
          inputValue(decl["default"], {})
        : UNKNOWN;
  }
  if (withBlock !== null && typeof withBlock === "object") {
    for (const [name, raw] of Object.entries<YamlValue | undefined>(withBlock)) {
      out[name] = inputValue(raw, scope);
    }
  }
  return out;
}
