import type { Val } from "./val.js";

/**
 * GitHub's truthiness: empty string, zero, `false` and null are false, and
 * every other value is true. `'0'` and `'false'` are non-empty strings, so
 * both are true — the same trap as JavaScript, kept deliberately identical.
 */
export function truthy(val: Val): boolean | null {
  switch (val.kind) {
    case "truthy":
      return true;
    case "falsy":
      return false;
    case "unknown":
      return null;
    // GitHub does cast an array or an object to a boolean, but no workflow
    // asks it to, and the answer is not worth guessing at to find out.
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
