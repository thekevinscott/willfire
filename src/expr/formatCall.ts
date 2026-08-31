import { UNKNOWN, type Val } from "./val.js";

const SLOT_RE = /\{\{|\}\}|\{(\d+)\}/g;

/**
 * `format('{0} {1}', a, b)`. `{{` and `}}` are GitHub's escapes for a literal
 * brace. An index with no argument behind it is a runtime error there, so it
 * is unknown here rather than an empty slot.
 */
export function formatCall(args: Val[]): Val {
  const [spec, ...rest] = args;
  if (spec === undefined || spec.kind !== "value" || typeof spec.v !== "string") {
    return UNKNOWN;
  }
  let missing = false;
  const out = spec.v.replace(SLOT_RE, (whole, index: string | undefined) => {
    if (index === undefined) {
      return whole === "{{" ? "{" : "}";
    }
    const arg = rest[Number(index)];
    if (arg === undefined || arg.kind !== "value") {
      missing = true;
      return "";
    }
    return String(arg.v);
  });
  return missing ? UNKNOWN : { kind: "value", v: out };
}
