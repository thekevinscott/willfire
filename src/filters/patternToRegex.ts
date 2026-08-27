const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function patternToRegex(pat: string): RegExp {
  let out = "";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === "*") {
      if (pat[i + 1] === "*") {
        out += ".*";
        i++;
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
