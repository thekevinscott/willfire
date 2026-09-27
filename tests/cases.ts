import { globSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Every `<owner>/<repo>/<pr>/` or `<owner>/<repo>/<pr>/<case>/` holding a fixture under `root`. A suite that finds none has a broken path, not zero cases. */
export function discoverCases(root: URL): { owner: string; repo: string; pr: number; dir: string; caseId: string | undefined }[] {
  const base = fileURLToPath(root);
  const cases = globSync(["*/*/*/fixture.json", "*/*/*/*/fixture.json"], { cwd: base })
    .sort()
    .map((hit) => {
      const segments = hit.split(sep);
      const [owner, repo, pr] = segments;
      const caseId = segments.length === 5 ? segments[3] : undefined;
      return { owner, repo, pr: Number(pr), dir: join(base, ...segments.slice(0, -1)), caseId };
    });
  if (cases.length === 0) {
    throw new Error(`no cases found under ${base}`);
  }
  return cases;
}
