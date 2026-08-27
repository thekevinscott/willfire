export type Tok =
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "null" }
  | { t: "path"; v: string }
  | { t: "op"; v: string };

const OPS = ["&&", "||", "==", "!=", "<=", ">=", "!", "<", ">", "(", ")", "[", "]", ","];

/**
 * Split a condition into tokens, or return null if it contains something this
 * evaluator has no token for. Returning null rather than throwing keeps the
 * "unrecognized is unknown" rule in one place at the top of `evaluate`.
 */
export function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    // Single-quoted string. GitHub escapes an inner quote by doubling it.
    if (c === "'") {
      let j = i + 1;
      let s = "";
      for (;;) {
        if (j >= src.length) {
          return null; // unterminated
        }
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            s += "'";
            j += 2;
            continue;
          }
          j++;
          break;
        }
        s += src[j];
        j++;
      }
      out.push({ t: "str", v: s });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op != null) {
      out.push({ t: "op", v: op });
      i += op.length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_.\-]*/.exec(src.slice(i));
    if (word != null) {
      const w = word[0];
      i += w.length;
      const lower = w.toLowerCase();
      if (lower === "true") {
        out.push({ t: "bool", v: true });
      } else if (lower === "false") {
        out.push({ t: "bool", v: false });
      } else if (lower === "null") {
        out.push({ t: "null" });
      } else {
        out.push({ t: "path", v: w });
      }
      continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num != null) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    return null; // a character we have no token for
  }
  return out;
}
