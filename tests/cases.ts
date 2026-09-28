import { existsSync, globSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrEventAction } from "willfire";

/** A case whose recording was taken under a non-default event action names it in a sibling `action.json`, a bare JSON string. Absent means the prediction's own default. */
const readAction = (dir: string): PrEventAction | undefined => {
  const path = join(dir, "action.json");
  if (!existsSync(path)) return undefined;
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof value !== "string" || value === "") {
    throw new Error(`${path} must be a JSON string naming a pull_request activity type`);
  }
  return value as PrEventAction;
};

/** Every `<owner>/<repo>/<pr>/` or `<owner>/<repo>/<pr>/<case>/` holding a fixture under `root`. A suite that finds none has a broken path, not zero cases. */
export function discoverCases(root: URL): { owner: string; repo: string; pr: number; dir: string; caseId: string | undefined; action: PrEventAction | undefined }[] {
  const base = fileURLToPath(root);
  const cases = globSync(["*/*/*/fixture.json", "*/*/*/*/fixture.json"], { cwd: base })
    .sort()
    .map((hit) => {
      const segments = hit.split(sep);
      const [owner, repo, pr] = segments;
      const caseId = segments.length === 5 ? segments[3] : undefined;
      const dir = join(base, ...segments.slice(0, -1));
      return { owner, repo, pr: Number(pr), dir, caseId, action: readAction(dir) };
    });
  if (cases.length === 0) {
    throw new Error(`no cases found under ${base}`);
  }
  return cases;
}
