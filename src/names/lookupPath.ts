export function lookupPath(obj: any, path: string): unknown {
  let cur: any = obj;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object" || !(seg in cur)) {
      return undefined;
    }
    cur = cur[seg];
  }
  return cur;
}
