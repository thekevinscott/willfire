const USAGE = "usage: capture-e2e --repo owner/name --pr N";

export function parseArgs(argv: string[]): { repo: string; pr: number } {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const repo = get("--repo");
  const pr = get("--pr");
  if (repo === undefined || pr === undefined) {
    console.error(USAGE);
    process.exit(2);
  }
  return { repo, pr: Number(pr) };
}
