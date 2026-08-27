import type { Val } from "./val.js";

export function truthy(val: Val): boolean | null {
  switch (val.kind) {
    case "truthy":
      return true;
    case "falsy":
      return false;
    case "unknown":
      return null;
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
