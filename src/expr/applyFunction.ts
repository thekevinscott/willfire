import { asBool } from "./asBool.js";
import { fromJson } from "./fromJson.js";
import { UNKNOWN, type Val } from "./val.js";

/**
 * `always()` is true by definition and `fromJSON` is what a dynamic matrix axis
 * is built out of. The job-status functions depend on jobs that have not run,
 * so they are unknown — as is every function not modelled here.
 */
export function applyFunction(name: string, args: Val[]): Val {
  if (name === "always") {
    return { kind: "value", v: true };
  }
  if (name === "fromjson" && args.length === 1) {
    return fromJson(args[0]);
  }
  if (name === "contains" && args.length === 2) {
    const [hay, needle] = args;
    if (hay.kind !== "value" || needle.kind !== "value") {
      return UNKNOWN;
    }
    if (typeof hay.v !== "string" || typeof needle.v !== "string") {
      return UNKNOWN;
    }
    return asBool(hay.v.includes(needle.v));
  }
  if ((name === "startswith" || name === "endswith") && args.length === 2) {
    const [s, part] = args;
    if (s.kind !== "value" || part.kind !== "value") {
      return UNKNOWN;
    }
    if (typeof s.v !== "string" || typeof part.v !== "string") {
      return UNKNOWN;
    }
    return asBool(name === "startswith" ? s.v.startsWith(part.v) : s.v.endsWith(part.v));
  }
  return UNKNOWN;
}
