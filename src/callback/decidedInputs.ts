import type { Scope } from "../expr/val.js";

/**
 * The invocation's settled inputs, as the strings a callback map matches on.
 * An undecided input is left out rather than guessed at, so an entry that
 * conditions on it can never match.
 */
export const decidedInputs = (scope: Scope): Record<string, string> =>
  Object.fromEntries(
    Object.entries(scope.inputs ?? {}).flatMap(([key, val]): [string, string][] =>
      val.kind === "value" ? [[key, String(val.v)]] : [],
    ),
  );
