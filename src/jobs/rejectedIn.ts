import { ifContexts } from "./ifContexts.js";
import { ifExpressions } from "./ifExpressions.js";
import type { YamlValue } from "../yamlValue.js";

/**
 * Contexts GitHub refuses to read inside an `if:`, by where the `if:` sits.
 * Reading one fails the whole file at startup. Measured on willfire#409 (head
 * `f3c21dc`): `secrets` in a job `if:` wrapped (run 36433479173) and bare
 * (36433480515), `secrets` in a step `if:` (36433481828), and `env` in a job
 * `if:` (36433483413) each produced only a zero-job `push` failure run and no
 * `pull_request` run at all.
 */
const REJECTED: Record<"job" | "step", readonly string[]> = {
  job: ["secrets", "env"],
  step: ["secrets"],
};

/** The refused context this `if:` reads at this position, or null. */
export const rejectedIn = (cond: YamlValue | undefined, at: "job" | "step"): string | null => {
  if (cond === null || cond === undefined) {
    return null;
  }
  for (const expr of ifExpressions(String(cond))) {
    for (const ctx of ifContexts(expr)) {
      if (REJECTED[at].includes(ctx)) {
        return ctx;
      }
    }
  }
  return null;
};
