const CAP = 4096;
const EDGE = 5;

/**
 * An excerpt of a captured stream, for quoting a failure's cause. Head and tail
 * both: a tool leads with the error as often as it trails with it, so picking one
 * line is a guess that is confidently wrong on somebody's output.
 * Capped here as well as at the stream: some callers accumulate uncapped.
 */
export const quoteBlock = (s: string): string => {
  // Function-local: hoisted to module scope this is a static mutant, which the
  // mutation gate reports as unkillable.
  const fit = (t: string, cap: number): string => (t.length <= cap ? t : `${t.slice(0, cap - 3)}...`);
  const lines = s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const whole = lines.join("\n");
  if (whole.length <= CAP) {
    return whole;
  }
  const cut = lines.length - EDGE * 2;
  if (cut <= 0) {
    return fit(whole, CAP);
  }
  const marker = `... ${cut} lines elided ...`;
  const budget = Math.floor((CAP - marker.length) / 2) - 1;
  const head = fit(lines.slice(0, EDGE).join("\n"), budget);
  const tail = fit(lines.slice(-EDGE).join("\n"), budget);
  return [head, marker, tail].join("\n");
};
