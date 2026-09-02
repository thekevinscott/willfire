import arg from "arg";
import { parseCallbackCommand } from "../callback/parseCallbackCommand.js";
import type { PrEventAction } from "../types.js";
import { isPrEventAction } from "./isPrEventAction.js";

const USAGE =
  "usage: predict --repo owner/name --pr N [--action opened|synchronize|reopened]" +
  ' [--callback "<command>"]... [--json]';

const SPEC = {
  "--repo": String,
  "--pr": String,
  "--action": String,
  "--json": Boolean,
  "--callback": [String] as [StringConstructor],
};

export function parseArgs(argv: string[]): {
  repo: string;
  pr: number;
  json: boolean;
  action?: PrEventAction;
  callbacks: string[];
} {
  const reject: (reason: string) => never = (reason) => {
    console.error(reason);
    console.error(USAGE);
    process.exit(2);
  };
  const read = () => {
    try {
      return arg(SPEC, { argv, permissive: false });
    } catch (error) {
      // arg throws only ArgError, and its message already names the flag at fault.
      return reject((error as Error).message);
    }
  };
  const parsed = read();
  const repo = parsed["--repo"];
  const pr = parsed["--pr"];
  if (!repo || !pr) {
    console.error(USAGE);
    process.exit(2);
  }
  // Refused, not ignored: falling back to the guess would turn a typo into a
  // wrong prediction, the failure this flag exists to remove.
  const action = parsed["--action"];
  if (action !== undefined && !isPrEventAction(action)) {
    reject(`unknown --action: ${action}`);
  }
  // Refused up front for the same reason: a command the prediction would balk
  // at later is a usage error now.
  const callbacks = parsed["--callback"] ?? [];
  for (const command of callbacks) {
    const validated = parseCallbackCommand(command);
    if (!validated.ok) {
      reject(validated.reason);
    }
  }
  return { repo, pr: Number(pr), json: parsed["--json"] ?? false, action, callbacks };
}
