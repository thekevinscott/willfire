/**
 * `name=value` lines or `name<<DELIMITER` heredocs. Anything else fails the
 * parse, as the runner fails the step on a malformed line.
 */
export function parseGithubOutput(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i++;
    if (line !== "") {
      const heredoc = /^([^=<]+)<<(.+)$/.exec(line);
      if (heredoc !== null) {
        const [, name, delim] = heredoc;
        const end = lines.indexOf(delim, i);
        if (end === -1) {
          return null; // unterminated heredoc
        }
        out[name] = lines.slice(i, end).join("\n");
        i = end + 1;
      } else {
        const eq = line.indexOf("=");
        if (eq <= 0) {
          return null;
        }
        out[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }
  }
  return out;
}
