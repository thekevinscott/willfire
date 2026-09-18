import { failureTail } from "../failureTail.js";
import { spawnCollect } from "../spawnCollect.js";
import { parseCallbackMap, type CallbackMap } from "./parseCallbackMap.js";

export type CallbacksOutcome = { ok: true; map: CallbackMap } | { ok: false; reason: string };

/**
 * Run every callback once and merge what they printed. Any failure is fatal to
 * the whole prediction: a map that silently went missing would turn into
 * sandbox executions and unknowns downstream, a wrong answer wearing a
 * plausible face.
 */
export async function runCallbacks(commands: string[][]): Promise<CallbacksOutcome> {
  // The invoker's own environment minus the GitHub tokens: a callback runs
  // outside the sandbox on the invoker's authority, but a prediction must not
  // hand its repo credentials to whatever a workflow asked it to run.
  const callbackEnv = (): NodeJS.ProcessEnv => {
    const env = { ...process.env };
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    return env;
  };
  const collected: { label: string; map: CallbackMap }[] = [];
  for (const argv of commands) {
    const label = argv.join(" ");
    // stdout carries the whole map, so the tail cap that guards the other
    // streams would silently truncate it into a parse failure.
    const r = await spawnCollect(argv[0], argv.slice(1), {
      env: callbackEnv(),
      wholeStdout: true,
    });
    if ("failed" in r) {
      return { ok: false, reason: `callback '${label}' failed to start: ${r.failed}` };
    }
    if (r.code !== 0) {
      const tail = failureTail(r);
      return {
        ok: false,
        reason: `callback '${label}' exited ${r.code}${tail === "" ? "" : ` (${tail})`}`,
      };
    }
    const parsed = parseCallbackMap(r.stdout);
    if (!parsed.ok) {
      return { ok: false, reason: `callback '${label}': ${parsed.reason}` };
    }
    collected.push({ label, map: parsed.map });
  }
  const owner = new Map<string, string>();
  for (const { label, map } of collected) {
    for (const key of Object.keys(map)) {
      const prev = owner.get(key);
      if (prev !== undefined) {
        return {
          ok: false,
          reason: `'${key}' is answered by two callbacks: '${prev}' and '${label}'`,
        };
      }
      owner.set(key, label);
    }
  }
  return {
    ok: true,
    map: Object.fromEntries(collected.flatMap(({ map }) => Object.entries(map))),
  };
}
