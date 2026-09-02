import { parseCallbackCommand } from "./parseCallbackCommand.js";
import { runCallbacks } from "./runCallbacks.js";
import type { CallbackMap } from "./parseCallbackMap.js";

/**
 * Turn a prediction's `--callback` commands into the one map every invocation
 * consults. Any failure throws: a resolver that could not answer must abort
 * the prediction rather than degrade into the executions it was meant to
 * replace.
 */
export async function resolveCallbackMap(
  commands: readonly string[],
): Promise<CallbackMap | undefined> {
  if (commands.length === 0) {
    return undefined;
  }
  const argvs = commands.map((command) => {
    const parsed = parseCallbackCommand(command);
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }
    return parsed.argv;
  });
  const ran = await runCallbacks(argvs);
  if (!ran.ok) {
    throw new Error(ran.reason);
  }
  return ran.map;
}
