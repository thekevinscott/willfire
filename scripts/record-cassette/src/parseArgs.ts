const USAGE = 'usage: record-cassette --repo owner/name --pr N --shape "what this pin holds"';

export function parseArgs(argv: string[]): { repo: string; pr: number; shape: string } {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const repo = get("--repo");
  const pr = get("--pr");
  const shape = get("--shape");
  if (repo === undefined || pr === undefined || shape === undefined) {
    console.error(USAGE);
    process.exit(2);
  }
  return { repo, pr: Number(pr), shape };
}
