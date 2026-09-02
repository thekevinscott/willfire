import { isPlainObject } from "./isPlainObject.js";

/** One recorded answer: outputs to use when `inputs` is a subset of an invocation's. */
export interface CallbackEntry {
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}

/** What a callback prints: entries per repo-qualified `owner/repo/path:job` key. */
export type CallbackMap = Record<string, CallbackEntry[]>;

export type ParsedMap = { ok: true; map: CallbackMap } | { ok: false; reason: string };

type Res<T> = { ok: true; v: T } | { ok: false; reason: string };

const err = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/**
 * Strict, because a shape error silently dropped here would surface later as a
 * wrong prediction: anything that is not exactly the documented map refuses to
 * parse, with the path to the offending piece.
 */
export function parseCallbackMap(stdout: string): ParsedMap {
  const stringMap = (v: unknown, label: string): Res<Record<string, string>> => {
    if (!isPlainObject(v)) {
      return err(`${label} is not an object`);
    }
    const bad = Object.entries(v).find(([, value]) => typeof value !== "string");
    if (bad !== undefined) {
      return err(`${label} value '${bad[0]}' is not a string`);
    }
    return { ok: true, v: { ...v } as Record<string, string> };
  };
  const callbackEntry = (v: unknown, label: string): Res<CallbackEntry> => {
    if (!isPlainObject(v)) {
      return err(`${label} is not an object`);
    }
    const extra = Object.keys(v).find((k) => k !== "inputs" && k !== "outputs");
    if (extra !== undefined) {
      return err(`${label} has an unexpected key '${extra}'`);
    }
    const inputs = stringMap(v["inputs"], `${label}.inputs`);
    if (!inputs.ok) {
      return inputs;
    }
    const outputs = stringMap(v["outputs"], `${label}.outputs`);
    if (!outputs.ok) {
      return outputs;
    }
    return { ok: true, v: { inputs: inputs.v, outputs: outputs.v } };
  };

  let root: unknown;
  try {
    root = JSON.parse(stdout);
  } catch {
    return err("stdout is not JSON");
  }
  if (!isPlainObject(root)) {
    return err("stdout is not a JSON object");
  }
  const pairs: [string, CallbackEntry[]][] = [];
  for (const [key, raw] of Object.entries(root)) {
    if (!Array.isArray(raw)) {
      return err(`'${key}' is not an array`);
    }
    const entries: CallbackEntry[] = [];
    for (let i = 0; i < raw.length; i++) {
      const entry = callbackEntry(raw[i], `'${key}'[${i}]`);
      if (!entry.ok) {
        return entry;
      }
      entries.push(entry.v);
    }
    pairs.push([key, entries]);
  }
  // fromEntries defines own properties, so a hostile key like `__proto__`
  // lands as data instead of touching the prototype.
  return { ok: true, map: Object.fromEntries(pairs) };
}
