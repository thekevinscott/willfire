import { spawn } from "node:child_process";
import { parseCallbackMap, type CallbackMap } from "./parseCallbackMap.js";

export type CallbacksOutcome = { ok: true; map: CallbackMap } | { ok: false; reason: string };

type Exit = { code: number; stdout: string; stderr: string } | { failed: string };

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
  const runOne = (argv: string[]): Promise<Exit> =>
    new Promise((resolve) => {
      const child = spawn(argv[0], argv.slice(1), {
        env: callbackEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => {
        stdout += String(d);
      });
      child.stderr.on("data", (d: Buffer) => {
        // Capped unconditionally: only the tail is ever quoted, and slice is
        // a no-op below the cap.
        stderr = (stderr + String(d)).slice(-4096);
      });
      child.on("error", (e: Error) => resolve({ failed: e.message }));
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });

  const collected: { label: string; map: CallbackMap }[] = [];
  for (const argv of commands) {
    const label = argv.join(" ");
    const r = await runOne(argv);
    if ("failed" in r) {
      return { ok: false, reason: `callback '${label}' failed to start: ${r.failed}` };
    }
    if (r.code !== 0) {
      const trimmed = r.stderr.trim();
      const tail = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
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
