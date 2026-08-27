import { UNKNOWN, type Scope, type Val } from "./val.js";

export function lookup(scope: Scope, path: string): Val {
  const dot = path.indexOf(".");
  if (dot < 0) {
    return UNKNOWN;
  }
  const head = path.slice(0, dot);
  const rest = path.slice(dot + 1);
  if (head === "inputs") {
    return scope.inputs?.[rest] ?? UNKNOWN;
  }
  if (head === "github") {
    const v = scope.github?.[rest];
    return v === undefined ? UNKNOWN : { kind: "value", v };
  }
  if (head === "needs") {
    const parts = rest.split(".");
    if (parts.length !== 3 || parts[1] !== "outputs") {
      return UNKNOWN;
    }
    const job = scope.needs?.[parts[0]];
    if (job == null) {
      return UNKNOWN;
    }
    return { kind: "value", v: job.outputs[parts[2]] ?? "" };
  }
  if (head === "steps") {
    const parts = rest.split(".");
    if (parts.length !== 3 || parts[1] !== "outputs") {
      return UNKNOWN;
    }
    const step = scope.steps?.[parts[0]];
    if (step == null) {
      return UNKNOWN;
    }
    return { kind: "value", v: step.outputs[parts[2]] ?? "" };
  }
  return UNKNOWN;
}
