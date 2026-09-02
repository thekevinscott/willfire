import { parseCallbackCommand } from "../callback/parseCallbackCommand.js";
import type { PrEventAction } from "../types.js";
import { isPrEventAction } from "./isPrEventAction.js";

const USAGE =
  "usage: predict --repo owner/name --pr N [--action opened|synchronize|reopened]" +
  ' [--callback "<command>"]... [--json]';

export function parseArgs(argv: string[]): {
  repo: string;
  pr: number;
  json: boolean;
  action?: PrEventAction;
  callbacks: string[];
} {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const repo = get("--repo");
  const pr = get("--pr");
  if (!repo || !pr) {
    console.error(USAGE);
    process.exit(2);
  }
  // Refused, not ignored: falling back to the guess would turn a typo into a
  // wrong prediction, the failure this flag exists to remove.
  const action = get("--action");
  if (action !== undefined && !isPrEventAction(action)) {
    console.error(`unknown --action: ${action}`);
    console.error(USAGE);
    process.exit(2);
  }
  // Refused up front for the same reason: a command the prediction would balk
  // at later is a usage error now.
  const callbacks = argv.flatMap((token, i) =>
    token === "--callback" ? [argv[i + 1] ?? ""] : [],
  );
  for (const command of callbacks) {
    const parsed = parseCallbackCommand(command);
    if (!parsed.ok) {
      console.error(parsed.reason);
      console.error(USAGE);
      process.exit(2);
    }
  }
  return { repo, pr: Number(pr), json: argv.includes("--json"), action, callbacks };
}
