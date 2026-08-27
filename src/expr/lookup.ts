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
    // Only `needs.<job>.outputs.<name>` is modelled. `needs.<job>.result`
    // is a verdict on a run that has not happened; anything else is not a
    // shape the context has.
    const parts = rest.split(".");
    if (parts.length !== 3 || parts[1] !== "outputs") {
      return UNKNOWN;
    }
    const job = scope.needs?.[parts[0]];
    if (job == null) {
      return UNKNOWN;
    }
    // A known job's missing output is the empty string, not a hole: the
    // caller promised the set is complete, and that is what the runner
    // substitutes for an output no step wrote.
    return { kind: "value", v: job.outputs[parts[2]] ?? "" };
  }
  if (head === "steps") {
    // The same shape as `needs`, for the same reason: only
    // `steps.<id>.outputs.<name>` is modelled. `steps.<id>.outcome` and
    // `.conclusion` are verdicts on how a step ran, which the executor does
    // not track — a failed step fails the whole execution instead.
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
  // `matrix.*`, `env.*`, `vars.*`, `secrets.*`: all require something that
  // has not happened yet at prediction time.
  return UNKNOWN;
}
