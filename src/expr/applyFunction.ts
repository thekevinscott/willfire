import { asBool } from "./asBool.js";
import { containsCall } from "./containsCall.js";
import { formatCall } from "./formatCall.js";
import { fromJson } from "./fromJson.js";
import { UNKNOWN, type Scope, type Val } from "./val.js";

/**
 * `always()` is true by definition, `fromJSON` is what a dynamic matrix axis
 * is built out of, and `format` is what a conditional `name:` suffix is built
 * out of. The other job-status functions depend on jobs that have not run, so
 * they are unknown unless the scope settles them — as is every function not
 * modelled here.
 */
export function applyFunction(name: string, args: Val[], scope: Scope): Val {
  if (name === "always") {
    return { kind: "value", v: true };
  }
  if (
    (name === "success" || name === "failure" || name === "cancelled") &&
    args.length === 0 &&
    scope.skippedNeed === true
  ) {
    return asBool(false);
  }
  if (name === "fromjson" && args.length === 1) {
    return fromJson(args[0]);
  }
  if (name === "format") {
    return formatCall(args);
  }
  if (name === "contains" && args.length === 2) {
    return containsCall(args[0], args[1]);
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
