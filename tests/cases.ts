import { globSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Every `<owner>/<repo>/<pr>/` holding a fixture under `root`. A suite that finds none has a broken path, not zero cases. */
export function discoverCases(root: URL): { owner: string; repo: string; pr: number; dir: string }[] {
  const base = fileURLToPath(root);
  const cases = globSync("*/*/*/fixture.json", { cwd: base })
    .sort()
    .map((hit) => {
      const [owner, repo, pr] = hit.split(sep);
      return { owner, repo, pr: Number(pr), dir: join(base, owner, repo, pr) };
    });
  if (cases.length === 0) {
    throw new Error(`no cases found under ${base}`);
  }
  return cases;
}
