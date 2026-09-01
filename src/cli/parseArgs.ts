import type { PrEventAction } from "../types.js";
import { isPrEventAction } from "./isPrEventAction.js";

const USAGE =
  "usage: predict --repo owner/name --pr N " +
  "[--action opened|synchronize|reopened] [--json] [--no-execute]";

export function parseArgs(argv: string[]): {
  repo: string;
  pr: number;
  json: boolean;
  execute: boolean;
  action?: PrEventAction;
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
  return {
    repo,
    pr: Number(pr),
    json: argv.includes("--json"),
    execute: !argv.includes("--no-execute"),
    action,
  };
}
