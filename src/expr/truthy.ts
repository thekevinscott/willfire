import type { Val } from "./val.js";

/**
 * GitHub's truthiness: `''`, 0, `false` and null are false. `'0'` and `'false'`
 * are non-empty strings, so both are true — the same trap as JavaScript.
 */
export function truthy(val: Val): boolean | null {
  switch (val.kind) {
    case "truthy":
      return true;
    case "falsy":
      return false;
    case "unknown":
      return null;
    // GitHub does cast these, but no workflow asks it to, so guessing buys
    // nothing.
    case "json":
      return null;
    case "value": {
      const v = val.v;
      if (typeof v === "boolean") {
        return v;
      }
      if (typeof v === "number") {
        return v !== 0;
      }
      return v !== "";
    }
  }
}
