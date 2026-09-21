import { outputSink } from "./outputSink.js";
import { stepOutcome } from "./stepOutcome.js";
import type { Res, RunCommand } from "./types.js";

/**
 * Run one step's command under an output sink and read its outputs back. The
 * sink's directory is mounted writable because the step writes there, and the
 * action root read-only because actions reach past their own directory.
 */
export async function runStepCommand(args: {
  runCommand: RunCommand;
  script: string;
  shell: "bash" | "sh";
  cwd: string;
  env: Record<string, string>;
  tree: string;
  actionRoot: string | undefined;
  label: string;
}): Promise<Res<Record<string, string>>> {
  const sink = await outputSink(args.env);
  try {
    const r = await args.runCommand({
      script: args.script,
      shell: args.shell,
      cwd: args.cwd,
      env: args.env,
      mounts: [
        { path: args.tree, writable: true },
        ...(args.actionRoot !== undefined ? [{ path: args.actionRoot, writable: false }] : []),
        { path: sink.dir, writable: true },
      ],
    });
    return await stepOutcome(r, sink.file, args.label);
  } finally {
    await sink.remove();
  }
}
