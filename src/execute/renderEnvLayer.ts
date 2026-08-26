import type { Scope } from "../expr/val.js";
import { err, type Res } from "./result.js";
import { renderTemplate } from "./renderTemplate.js";

/** An `env:` block rendered to concrete strings, every key or nothing. */
export function renderEnvLayer(layer: unknown, scope: Scope): Res<Record<string, string>> {
  if (layer == null) return { ok: true, v: {} };
  if (typeof layer !== "object" || Array.isArray(layer)) return err("env block is not a map");
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(layer as Record<string, unknown>)) {
    const rendered = renderTemplate(String(raw ?? ""), scope);
    if (rendered == null) return err(`cannot resolve env '${k}'`);
    out[k] = rendered;
  }
  return { ok: true, v: out };
}
