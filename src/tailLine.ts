/**
 * The last non-empty line of a captured stream, for quoting a failure's cause.
 * Capped here as well as at the stream: some callers accumulate uncapped.
 */
export const tailLine = (s: string): string => {
  const trimmed = s.trim();
  return trimmed.slice(trimmed.lastIndexOf("\n") + 1).slice(-4096);
};
