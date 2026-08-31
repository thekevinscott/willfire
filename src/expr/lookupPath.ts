import type { YamlMap, YamlValue } from "../yamlValue.js";

export function lookupPath(obj: YamlValue | undefined, path: string): YamlValue | undefined {
  let cur: YamlValue | undefined = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(seg in cur)) {
      return undefined;
    }
    cur = (cur as YamlMap)[seg];
  }
  return cur;
}
