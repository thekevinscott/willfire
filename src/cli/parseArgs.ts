import { parseGrant } from "../execute/parseGrant.js";
import type { ExecutionGrant } from "../execute/types.js";
import type { PrEventAction } from "../types.js";

const USAGE =
  "usage: predict --repo owner/name --pr N [--action opened|synchronize|reopened]" +
  " [--execute owner/repo:job1,job2]... [--json]";

const isPrEventAction = (v: string): v is PrEventAction =>
  v === "opened" || v === "synchronize" || v === "reopened";

export function parseArgs(argv: string[]): {
  repo: string;
  pr: number;
  json: boolean;
  action?: PrEventAction;
  execute: ExecutionGrant[];
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
  // An unrecognised action is refused rather than ignored. Silently falling
  // back to the guess would turn a typo into a wrong prediction, which is the
  // failure this flag exists to remove.
  const action = get("--action");
  if (action !== undefined && !isPrEventAction(action)) {
    console.error(`unknown --action: ${action}`);
    console.error(USAGE);
    process.exit(2);
  }
  // Repeatable, one grant per flag. A malformed grant is refused for the same
  // reason a bad --action is: silently dropping it would predict without the
  // execution the caller thought they asked for.
  const execute: ExecutionGrant[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--execute") {
      continue;
    }
    const spec = argv[i + 1];
    const grant = spec == null ? null : parseGrant(spec);
    if (grant == null) {
      console.error(`bad --execute: ${spec}`);
      console.error(USAGE);
      process.exit(2);
    }
    execute.push(grant);
  }
  return { repo, pr: Number(pr), json: argv.includes("--json"), action, execute };
}
