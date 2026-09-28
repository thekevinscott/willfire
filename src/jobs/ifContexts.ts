import { tokenize } from "../expr/tokenize.js";

/**
 * The leading context name of every named value an expression reads.
 *
 * An expression this tokenizer cannot read contributes nothing rather than a
 * guess: GitHub's grammar is wider than ours, so failing to read a condition
 * is not evidence about which contexts it names.
 */
export const ifContexts = (expr: string): string[] => {
  const toks = tokenize(expr);
  if (toks === null) {
    return [];
  }
  return toks.flatMap((t) => (t.t === "path" ? [t.v.split(".")[0].toLowerCase()] : []));
};
