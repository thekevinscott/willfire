import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dirs = (at: string): string[] =>
  readdirSync(at, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

/** Every `<owner>/<repo>/<pr>/` under `root`. A suite that finds none has a broken path, not zero cases. */
export function discoverCases(root: URL): { owner: string; repo: string; pr: number; dir: string }[] {
  const base = fileURLToPath(root);
  const cases = dirs(base).flatMap((owner) =>
    dirs(join(base, owner)).flatMap((repo) =>
      dirs(join(base, owner, repo)).map((pr) => ({
        owner,
        repo,
        pr: Number(pr),
        dir: join(base, owner, repo, pr),
      })),
    ),
  );
  if (cases.length === 0) {
    throw new Error(`no cases found under ${base}`);
  }
  return cases;
}
