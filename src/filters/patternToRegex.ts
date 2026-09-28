// GitHub filter pattern glob. Grammar per docs: * (any chars except /),
// ** (any chars), **/ (zero or more directories), ? (zero or one of preceding
// char), + (one or more of preceding char), [ranges], leading ! negates.

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function patternToRegex(pat: string): RegExp {
  let out = "";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === "*") {
      if (pat[i + 1] === "*") {
        if (pat[i + 2] === "/") {
          // `**/` is zero or more directories, so the separator is optional:
          // `**/*.txt` fires for a top-level file (probe run 36429114415).
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i++;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?" || c === "+") {
      out += c;
    } else if (c === "[") {
      const j = pat.indexOf("]", i + 1);
      out += pat.slice(i, j + 1);
      i = j;
    } else if (c === "\\") {
      i++;
      out += escapeRegex(pat[i]);
    } else {
      out += escapeRegex(c);
    }
  }
  return new RegExp(`^${out}$`);
}
