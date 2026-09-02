import type { CallbackMap } from "./parseCallbackMap.js";

export type CallbackAnswer =
  | { kind: "hit"; outputs: Record<string, string> }
  | { kind: "no-match"; reason: string }
  | { kind: "ambiguous"; reason: string }
  | { kind: "absent" };

/**
 * One invocation's lookup. `absent` and `no-match` are different verdicts on
 * purpose: an absent key falls through to execution, but a key the map claims
 * and fails to answer means the resolver is out of step with the workflow —
 * surfaced loudly, never guessed around.
 */
export function matchOutputs(
  map: CallbackMap,
  key: string,
  inputs: Record<string, string>,
): CallbackAnswer {
  if (!Object.hasOwn(map, key)) {
    return { kind: "absent" };
  }
  const matches = map[key].filter((entry) =>
    Object.entries(entry.inputs).every(([k, v]) => inputs[k] === v),
  );
  if (matches.length === 1) {
    return { kind: "hit", outputs: matches[0].outputs };
  }
  const detail = `'${key}' with inputs ${JSON.stringify(inputs)}`;
  if (matches.length === 0) {
    return { kind: "no-match", reason: `no callback entry matches ${detail}` };
  }
  return { kind: "ambiguous", reason: `${matches.length} callback entries match ${detail}` };
}
