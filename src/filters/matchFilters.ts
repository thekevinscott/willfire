import { patternToRegex } from "./patternToRegex.js";

/** Order-sensitive match: last matching pattern wins; ! negates. */
export function matchFilters(value: string, patterns: string[]): boolean {
  let matched = false;
  for (const pat of patterns) {
    const neg = pat.startsWith("!");
    const p = neg ? pat.slice(1) : pat;
    if (patternToRegex(p).test(value)) matched = !neg;
  }
  return matched;
}
