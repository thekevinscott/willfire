/**
 * A tri-state evaluator for the slice of GitHub expressions that job `if:`
 * conditions actually use.
 *
 * The point is not to reimplement the expression language. It is to stop
 * returning `unknown` for conditions that are already decided. A reusable
 * workflow's jobs commonly guard on the caller's own literals:
 *
 *     if: ${{ github.event_name == 'pull_request'
 *             && (inputs.gates == '' || contains(inputs.gates, '"mutation"'))
 *             && (needs.detect.outputs.mutation_languages || ...) != '[]' }}
 *
 * The last clause needs a job that has not run yet. The middle one does not:
 * the caller passed `gates` as a literal string, and it does not contain
 * `"mutation"`, so the clause is false, so the whole `&&` is false whatever
 * `detect` reports. Deciding that is the difference between a predictable
 * check name and a hole in the prediction.
 *
 * Two ideas carry the whole file:
 *
 * 1. **Truthiness can be known when the value is not.** `A && B` with an
 *    unknown `A` and a false `B` is false either way. So the lattice has four
 *    points, not three: a concrete value, known-truthy, known-falsy, and
 *    nothing at all.
 *
 * 2. **Unrecognized is unknown, never a guess.** An unparseable condition, an
 *    unsupported function, a comparison between types we do not model — all
 *    collapse to `unknown` and leave the caller exactly where it was. This
 *    adds no tolerance and no third outcome; it converts conditions that are
 *    already decidable into the answer they already have.
 */

/**
 * A partially-known value.
 *
 * `truthy` and `falsy` exist because short-circuiting yields truthiness
 * without a value: `unknown && false` is falsy, but there is no string to
 * hand back for it. Collapsing those into `unknown` would throw away the
 * only fact worth having.
 */
export type Val =
  | { kind: "value"; v: string | number | boolean }
  /**
   * An array or an object, which only `fromJSON` produces. Kept apart from
   * `value` because nothing else in the language accepts one: comparison
   * refuses it, and its truthiness is not modelled. Matrix expansion is the
   * one consumer, and it asks for the array directly.
   */
  | { kind: "json"; v: unknown[] | Record<string, unknown> }
  | { kind: "truthy" }
  | { kind: "falsy" }
  | { kind: "unknown" };

export const UNKNOWN: Val = { kind: "unknown" };

/** What a bare path resolves against. Anything absent is unknown, not empty. */
export interface Scope {
  /**
   * The inputs the caller passed, plus declared defaults for the ones it did
   * not. A key mapped to `unknown` is deliberate: the caller supplied it, but
   * as a `${{ }}` template we cannot evaluate. That is different from absent.
   */
  inputs?: Record<string, Val>;
  /** `github.*` values that are fixed for the run being predicted. */
  github?: Record<string, string>;
  /**
   * Outputs of jobs this workflow's jobs `needs`, keyed by job id.
   *
   * `outputs` is the *complete* set for that job, which is what makes a key
   * that is absent from it mean the empty string — the same answer the runner
   * gives for an output no step wrote. Handing in a partial map is therefore a
   * lie, not a shortcut: leave the job out entirely instead, and every lookup
   * against it stays unknown.
   *
   * The values are raw strings, because that is what a step wrote to
   * `$GITHUB_OUTPUT` and what the runner substitutes. Parsing eagerly would
   * break the guards written against them — `!= '[]'` compares a string to a
   * string, and an array on the left makes it unknown. `fromJSON` is the only
   * thing that turns one into a structure, at the point the workflow asks.
   */
  needs?: Record<string, { outputs: Record<string, string> }>;
}

/**
 * GitHub's truthiness: empty string, zero, `false` and null are false, and
 * every other value is true. `'0'` and `'false'` are non-empty strings, so
 * both are true — the same trap as JavaScript, kept deliberately identical.
 */
function truthy(val: Val): boolean | null {
  switch (val.kind) {
    case "truthy":
      return true;
    case "falsy":
      return false;
    case "unknown":
      return null;
    // GitHub does cast an array or an object to a boolean, but no workflow
    // asks it to, and the answer is not worth guessing at to find out.
    case "json":
      return null;
    case "value": {
      const v = val.v;
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v !== 0;
      return v !== "";
    }
  }
}

/**
 * Wrap a decided answer as a concrete boolean value.
 *
 * Comparison, negation and the string functions all yield a real boolean, so
 * they produce a `value` — which keeps `!x == true` comparable. Only
 * short-circuiting produces the bare `truthy`/`falsy` points, because that is
 * the one case where truthiness is known and the value is not.
 */
function asBool(b: boolean | null): Val {
  return b === null ? UNKNOWN : { kind: "value", v: b };
}

// ------------------------------------------------------------------ tokenizer

type Tok =
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "null" }
  | { t: "path"; v: string }
  | { t: "op"; v: string };

const OPS = ["&&", "||", "==", "!=", "<=", ">=", "!", "<", ">", "(", ")", ","];

/**
 * Split a condition into tokens, or return null if it contains something this
 * evaluator has no token for. Returning null rather than throwing keeps the
 * "unrecognized is unknown" rule in one place at the top of `evaluate`.
 */
function tokenize(src: string): Tok[] | null {
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
        if (j >= src.length) return null; // unterminated
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
      if (lower === "true") out.push({ t: "bool", v: true });
      else if (lower === "false") out.push({ t: "bool", v: false });
      else if (lower === "null") out.push({ t: "null" });
      else out.push({ t: "path", v: w });
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

// --------------------------------------------------------------------- parser

/**
 * Recursive descent over GitHub's precedence order, loosest first:
 * `||`, then `&&`, then comparison, then `!`, then a primary.
 *
 * `&&` and `||` are value operators, not boolean ones — `a || b` yields the
 * first truthy operand, which is why `(x || y) != '[]'` parses as a
 * comparison against a coalesced value rather than a boolean.
 */
class Parser {
  private pos = 0;
  constructor(
    private readonly toks: Tok[],
    private readonly scope: Scope,
  ) {}

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }

  private eatOp(v: string): boolean {
    const t = this.peek();
    if (t != null && t.t === "op" && t.v === v) {
      this.pos++;
      return true;
    }
    return false;
  }

  done(): boolean {
    return this.pos >= this.toks.length;
  }

  or(): Val {
    let left = this.and();
    while (this.eatOp("||")) {
      const right = this.and();
      left = coalesceOr(left, right);
    }
    return left;
  }

  private and(): Val {
    let left = this.cmp();
    while (this.eatOp("&&")) {
      const right = this.cmp();
      left = coalesceAnd(left, right);
    }
    return left;
  }

  private cmp(): Val {
    const left = this.unary();
    for (const op of ["==", "!=", "<=", ">=", "<", ">"]) {
      if (this.eatOp(op)) {
        const right = this.unary();
        return compare(op, left, right);
      }
    }
    return left;
  }

  private unary(): Val {
    if (this.eatOp("!")) {
      const v = this.unary();
      return asBool(negate(truthy(v)));
    }
    return this.primary();
  }

  private primary(): Val {
    const t = this.peek();
    if (t == null) return UNKNOWN;
    if (t.t === "op" && t.v === "(") {
      this.pos++;
      const v = this.or();
      if (!this.eatOp(")")) return UNKNOWN;
      return v;
    }
    if (t.t === "str") {
      this.pos++;
      return { kind: "value", v: t.v };
    }
    if (t.t === "num") {
      this.pos++;
      return { kind: "value", v: t.v };
    }
    if (t.t === "bool") {
      this.pos++;
      return { kind: "value", v: t.v };
    }
    if (t.t === "null") {
      this.pos++;
      return { kind: "value", v: "" };
    }
    if (t.t === "path") {
      this.pos++;
      // A `(` right after a name makes it a call, not a path.
      if (this.eatOp("(")) return this.call(t.v);
      return this.lookup(t.v);
    }
    return UNKNOWN;
  }

  /**
   * A function call. Arguments are always parsed, even for functions we cannot
   * evaluate — the tokens have to be consumed either way or the rest of the
   * expression parses against the wrong position.
   */
  private call(name: string): Val {
    const args: Val[] = [];
    if (!this.eatOp(")")) {
      for (;;) {
        args.push(this.or());
        if (this.eatOp(",")) continue;
        if (this.eatOp(")")) break;
        return UNKNOWN; // malformed argument list
      }
    }
    return applyFunction(name.toLowerCase(), args);
  }

  private lookup(path: string): Val {
    const dot = path.indexOf(".");
    if (dot < 0) return UNKNOWN;
    const head = path.slice(0, dot);
    const rest = path.slice(dot + 1);
    if (head === "inputs") return this.scope.inputs?.[rest] ?? UNKNOWN;
    if (head === "github") {
      const v = this.scope.github?.[rest];
      return v === undefined ? UNKNOWN : { kind: "value", v };
    }
    if (head === "needs") {
      // Only `needs.<job>.outputs.<name>` is modelled. `needs.<job>.result`
      // is a verdict on a run that has not happened; anything else is not a
      // shape the context has.
      const parts = rest.split(".");
      if (parts.length !== 3 || parts[1] !== "outputs") return UNKNOWN;
      const job = this.scope.needs?.[parts[0]];
      if (job == null) return UNKNOWN;
      // A known job's missing output is the empty string, not a hole: the
      // caller promised the set is complete, and that is what the runner
      // substitutes for an output no step wrote.
      return { kind: "value", v: job.outputs[parts[2]] ?? "" };
    }
    // `steps.*`, `matrix.*`, `env.*`, `vars.*`, `secrets.*`: all require
    // something that has not happened yet at prediction time.
    return UNKNOWN;
  }
}

function negate(b: boolean | null): boolean | null {
  return b === null ? null : !b;
}

/**
 * `A && B`. Short-circuits from either side: a falsy left decides it, and so
 * does a falsy right, because a truthy left would then yield the falsy right.
 * Only "left unknown, right not falsy" is genuinely undecided.
 */
function coalesceAnd(left: Val, right: Val): Val {
  const l = truthy(left);
  if (l === false) return left;
  if (l === true) return right;
  return truthy(right) === false ? { kind: "falsy" } : UNKNOWN;
}

/**
 * `A || B`. The mirror image: a truthy left decides it, and so does a truthy
 * right, since a falsy left would then yield the truthy right.
 */
function coalesceOr(left: Val, right: Val): Val {
  const l = truthy(left);
  if (l === true) return left;
  if (l === false) return right;
  return truthy(right) === true ? { kind: "truthy" } : UNKNOWN;
}

/**
 * Comparison, deliberately narrow: both sides must be concrete and of the same
 * primitive type.
 *
 * GitHub coerces across types when it compares, and the corner cases are
 * genuinely surprising (`'' == 0` is true). Every comparison that matters in
 * practice is string-to-string — `inputs.gates == ''`,
 * `github.event_name == 'pull_request'` — so modelling the coercion table
 * would add risk without adding reach. Mixed types return unknown.
 */
function compare(op: string, left: Val, right: Val): Val {
  if (left.kind !== "value" || right.kind !== "value") return UNKNOWN;
  const a = left.v;
  const b = right.v;
  if (typeof a !== typeof b) return UNKNOWN;
  if (op === "==") return asBool(a === b);
  if (op === "!=") return asBool(a !== b);
  // Ordering on booleans is not modelled. GitHub coerces them to numbers, and
  // the answer is never one a workflow author meant to ask for.
  if (typeof a === "boolean" || typeof b === "boolean") return UNKNOWN;
  if (op === "<") return asBool(a < b);
  if (op === "<=") return asBool(a <= b);
  if (op === ">") return asBool(a > b);
  return asBool(a >= b);
}

/**
 * `fromJSON(s)` on a known string.
 *
 * The result is sorted into the lattice rather than dropped in whole: a scalar
 * is an ordinary value and stays comparable, `null` has a known truthiness and
 * no useful value, and only an array or an object needs the `json` point.
 * Anything unparseable is unknown — a workflow that reaches this at runtime
 * fails, and predicting a failure is not this function's job.
 */
function fromJson(arg: Val): Val {
  if (arg.kind !== "value" || typeof arg.v !== "string") return UNKNOWN;
  let parsed: unknown;
  try {
    parsed = JSON.parse(arg.v);
  } catch {
    return UNKNOWN;
  }
  if (parsed === null) return { kind: "falsy" };
  if (typeof parsed === "object") return { kind: "json", v: parsed as unknown[] };
  return { kind: "value", v: parsed as string | number | boolean };
}

/**
 * The functions worth modelling.
 *
 * `always()` is true by definition. `contains` on two known strings is the one
 * that unlocks the fleet's `gates` pattern. `fromJSON` is what a dynamic matrix
 * axis is built out of. `success()`, `failure()` and `cancelled()` depend on
 * jobs that have not run, and everything else is simply not modelled — all
 * unknown.
 */
function applyFunction(name: string, args: Val[]): Val {
  if (name === "always") return { kind: "value", v: true };
  if (name === "fromjson" && args.length === 1) return fromJson(args[0]);
  if (name === "contains" && args.length === 2) {
    const [hay, needle] = args;
    if (hay.kind !== "value" || needle.kind !== "value") return UNKNOWN;
    if (typeof hay.v !== "string" || typeof needle.v !== "string") return UNKNOWN;
    return asBool(hay.v.includes(needle.v));
  }
  if ((name === "startswith" || name === "endswith") && args.length === 2) {
    const [s, part] = args;
    if (s.kind !== "value" || part.kind !== "value") return UNKNOWN;
    if (typeof s.v !== "string" || typeof part.v !== "string") return UNKNOWN;
    return asBool(name === "startswith" ? s.v.startsWith(part.v) : s.v.endsWith(part.v));
  }
  return UNKNOWN;
}

// ---------------------------------------------------------------------- entry

/**
 * Evaluate an expression to a value, or UNKNOWN when it cannot be settled.
 *
 * The `${{ }}` wrapper is optional in `if:` and stripped when present. An
 * expression that is only *partly* wrapped (`foo ${{ bar }} baz`) is a string
 * interpolation rather than an expression, and is not modelled.
 *
 * A `if:` wants {@link evaluate}, which is this narrowed to truthiness. This
 * one is for the places that need the value itself — a matrix axis written as
 * `${{ fromJSON(...) }}` is an array, and its truthiness says nothing about
 * how many jobs it schedules.
 */
export function evaluateValue(expr: string, scope: Scope = {}): Val {
  const stripped = expr.trim().replace(/^\$\{\{(.*)\}\}$/s, "$1").trim();
  if (stripped === "") return UNKNOWN;
  if (stripped.includes("${{")) return UNKNOWN;
  const toks = tokenize(stripped);
  if (toks == null || toks.length === 0) return UNKNOWN;
  const p = new Parser(toks, scope);
  const val = p.or();
  // Trailing tokens mean the grammar did not cover this expression; whatever
  // was parsed describes only a prefix of it, so it decides nothing.
  if (!p.done()) return UNKNOWN;
  return val;
}

/** Evaluate a condition to a truthiness, or null when it cannot be settled. */
export function evaluate(cond: string, scope: Scope = {}): boolean | null {
  return truthy(evaluateValue(cond, scope));
}
