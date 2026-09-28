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
    // An array or an object is always true, the empty array included — probe
    // #383 run 36430453652 ran all three of `fromJSON('[1]')`,
    // `fromJSON('[]')` and `fromJSON('{"a":1}')`.
    case "json":
      return true;
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
