/**
 * The `$GITHUB_OUTPUT` file format: `name=value` lines, or a
 * `name<<DELIMITER … DELIMITER` heredoc for multi-line values. Anything else
 * fails the parse — the runner fails the step on a malformed line, so
 * tolerating one here would invent outputs a real run never had.
 */
export function parseGithubOutput(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i++;
    if (line === "") {
      continue;
    }
    const heredoc = /^([^=<]+)<<(.+)$/.exec(line);
    if (heredoc != null) {
      const [, name, delim] = heredoc;
      const buf: string[] = [];
      for (;;) {
        if (i >= lines.length) {
          return null; // unterminated heredoc
        }
        if (lines[i] === delim) {
          i++;
          break;
        }
        buf.push(lines[i]);
        i++;
      }
      out[name] = buf.join("\n");
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      return null;
    }
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}
