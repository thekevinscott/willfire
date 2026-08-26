import type { Scope } from "../expr/val.js";
import { renderTemplate } from "./renderTemplate.js";
import { err, type Res } from "./result.js";

/** Every declared output must land; a partial map would be a lie. */
export function compositeOutputs(
  action: any,
  uses: string,
  label: string,
  outScope: Scope,
): Res<Record<string, string>> {
  const outputs: Record<string, string> = {};
  for (const [name, decl] of Object.entries(action.outputs ?? {})) {
    const raw = (decl as Record<string, unknown> | null)?.["value"];
    if (raw == null) {
      return err(`${label}: output '${name}' of ${uses} has no value`);
    }
    const rendered = renderTemplate(String(raw), outScope);
    if (rendered == null) {
      return err(`${label}: cannot resolve output '${name}' of ${uses}`);
    }
    outputs[name] = rendered;
  }
  return { ok: true, v: outputs };
}
