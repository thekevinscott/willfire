import { ifContexts } from "./ifContexts.js";
import { ifExpressions } from "./ifExpressions.js";
import type { YamlValue } from "../yamlValue.js";

/** The first of `refused` this `if:` reads, or null. */
export const rejectedIn = (cond: YamlValue | undefined, refused: string[]): string | null => {
  for (const expr of ifExpressions(String(cond))) {
    for (const ctx of ifContexts(expr)) {
      if (refused.includes(ctx)) {
        return ctx;
      }
    }
  }
  return null;
};
