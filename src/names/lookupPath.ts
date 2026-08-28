import type { YamlValue } from "../yamlValue.js";

export function lookupPath(obj: any, path: string): YamlValue | undefined {
  let cur: any = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(seg in cur)) {
      return undefined;
    }
    cur = cur[seg];
  }
  return cur;
}
