import { UNKNOWN, type Val } from "./val.js";

const SLOT_RE = /\{\{|\}\}|\{(\d+)\}/g;

/**
 * `format('{0} {1}', a, b)`. `{{` and `}}` are the runner's escapes for a
 * literal brace, and it coerces a non-string first argument rather than
 * refusing it. An index with no argument behind it is a runtime error there,
 * so it is unknown here rather than an empty slot.
 */
export function formatCall(args: Val[]): Val {
  const [spec, ...rest] = args;
  if (spec === undefined || spec.kind !== "value") {
    return UNKNOWN;
  }
  const text = String(spec.v);
  const out: string[] = [];
  let at = 0;
  for (const m of text.matchAll(SLOT_RE)) {
    out.push(text.slice(at, m.index));
    at = m.index + m[0].length;
    const index = m[1];
    if (index === undefined) {
      out.push(m[0] === "{{" ? "{" : "}");
    } else {
      const arg = rest[Number(index)];
      if (arg === undefined || arg.kind !== "value") {
        return UNKNOWN;
      }
      out.push(String(arg.v));
    }
  }
  out.push(text.slice(at));
  return { kind: "value", v: out.join("") };
}
