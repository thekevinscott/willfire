import { evaluateValue } from "../expr/evaluateValue.js";
import { UNKNOWN, type Scope, type Val } from "../expr/val.js";
import { renderTemplate } from "../execute/renderTemplate.js";
import { prScope } from "./prScope.js";

/**
 * A `with:` value as the callee will see it, evaluated in the caller's scope.
 * A whole-expression value keeps its evaluated type; mixed text renders to a
 * string, all or nothing; anything unresolvable stays unknown.
 */
export function inputValue(raw: unknown, scope: Scope): Val {
  if (raw === null || raw === undefined) {
    return { kind: "value", v: "" };
  }
  if (typeof raw === "boolean" || typeof raw === "number") {
    return { kind: "value", v: raw };
  }
  if (typeof raw !== "string") {
    return UNKNOWN;
  }
  if (!raw.includes("${{")) {
    return { kind: "value", v: raw };
  }
  const t = raw.trim();
  // `${{a}} x ${{b}}` fails this test and takes the render path instead.
  if (t.startsWith("${{") && t.indexOf("}}") === t.length - 2) {
    return evaluateValue(t.slice(3, -2), prScope(scope));
  }
  const rendered = renderTemplate(raw, prScope(scope));
  return rendered === null ? UNKNOWN : { kind: "value", v: rendered };
}
