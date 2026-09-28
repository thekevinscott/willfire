import { readFile } from "node:fs/promises";
import { err } from "./err.js";
import { parseGithubOutput } from "./parseGithubOutput.js";
import { stepOutcome } from "./stepOutcome.js";
import { stepSinks } from "./stepSinks.js";
import type { Res, RunCommand } from "./types.js";

/**
 * Run one step's command under its sinks and read them back. The sink
 * directory is mounted writable because the step writes there, and the action
 * root read-only because actions reach past their own directory.
 */
export async function runStepCommand(args: {
  runCommand: RunCommand;
  script: string;
  shell: "bash" | "sh";
  cwd: string;
  env: Record<string, string>;
  tree: string;
  actionRoot: string | undefined;
  stateKey: string;
  jobEnv: Record<string, string>;
  label: string;
}): Promise<Res<Record<string, string>>> {
  const sinks = await stepSinks(args.env);
  try {
    const r = await args.runCommand({
      script: args.script,
      shell: args.shell,
      cwd: args.cwd,
      env: args.env,
      mounts: [
        { path: args.tree, writable: true },
        ...(args.actionRoot !== undefined ? [{ path: args.actionRoot, writable: false }] : []),
        { path: sinks.dir, writable: true },
      ],
      stateKey: args.stateKey,
    });
    const out = await stepOutcome(r, sinks.outputFile, args.label);
    if (!out.ok) {
      return out;
    }
    // Same line format as $GITHUB_OUTPUT; the runner fails a malformed line.
    const added = parseGithubOutput(await readFile(sinks.envFile, "utf8"));
    if (added === null) {
      return err(`${args.label}: malformed GITHUB_ENV`);
    }
    Object.assign(args.jobEnv, added);
    return out;
  } finally {
    await sinks.remove();
  }
}
