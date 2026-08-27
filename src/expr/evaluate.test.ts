import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.js";
import type { Scope } from "./val.js";

/**
 * `evaluate` is the whole public surface, so everything below drives it rather
 * than the parser internals. The tri-state is the thing under test: `true` and
 * `false` are claims that a job's fate is settled, and `null` is the refusal to
 * claim. A test that turns a `null` into a `true` is widening what willfire
 * asserts about a repo's CI, not tidying a return value.
 */

/** The scope the fleet's `testing-conventions` callers actually produce. */
const FLEET: Scope = {
  inputs: {
    gates: {
      kind: "value",
      v: '["colocated-test", "unit-lint", "unit-coverage", "integration-lint"]',
    },
    languages: { kind: "value", v: '["typescript"]' },
    source: { kind: "value", v: "src" },
    run_e2e: { kind: "value", v: false },
    packaging_artifact: { kind: "value", v: "" },
  },
  github: { event_name: "pull_request" },
};

describe("literals and truthiness", () => {
  it.each([
    ["true", true],
    ["True", true],
    ["false", false],
    ["False", false],
    ["'x'", true],
    ["''", false],
    ["1", true],
    ["0", false],
    ["-1", true],
    ["1.5", true],
    // A non-empty string is truthy whatever it spells — the JavaScript trap,
    // kept deliberately, because GitHub has it too.
    ["'false'", true],
    ["'0'", true],
    ["null", false],
  ] as const)("reads %s as %s", (src, want) => {
    expect(evaluate(src)).toBe(want);
  });
});

describe("the ${{ }} wrapper", () => {
  it("strips a fully wrapped expression", () => {
    expect(evaluate("${{ true }}")).toBe(true);
  });

  it("strips one spanning newlines", () => {
    expect(evaluate("${{\n  true\n}}")).toBe(true);
  });

  it("refuses a partially interpolated string", () => {
    // `foo ${{ bar }}` is a template, not an expression. Evaluating the inner
    // part would answer a question nobody asked.
    expect(evaluate("'a' == 'a ${{ inputs.x }}'")).toBe(null);
  });

  it("refuses an empty condition", () => {
    expect(evaluate("   ")).toBe(null);
  });

  it("refuses an empty wrapper", () => {
    expect(evaluate("${{ }}")).toBe(null);
  });
});

describe("&& short-circuits from either side", () => {
  it("is false when the left is false, whatever the right is", () => {
    expect(evaluate("false && needs.detect.outputs.x == 'y'")).toBe(false);
  });

  it("yields the right when the left is true", () => {
    expect(evaluate("true && false")).toBe(false);
    expect(evaluate("true && true")).toBe(true);
  });

  it("is false when the right is false and the left is unknown", () => {
    // The point of the whole module: an undecided operand does not make the
    // expression undecided when the other operand settles it.
    expect(evaluate("needs.detect.outputs.x && false")).toBe(false);
  });

  it("is unknown when the left is unknown and the right does not settle it", () => {
    expect(evaluate("needs.detect.outputs.x && true")).toBe(null);
    expect(evaluate("needs.detect.outputs.x && needs.detect.outputs.y")).toBe(null);
  });
});

describe("|| short-circuits from either side", () => {
  it("is true when the left is true", () => {
    expect(evaluate("true || needs.detect.outputs.x == 'y'")).toBe(true);
  });

  it("yields the right when the left is false", () => {
    expect(evaluate("false || true")).toBe(true);
    expect(evaluate("false || false")).toBe(false);
  });

  it("is true when the right is true and the left is unknown", () => {
    expect(evaluate("needs.detect.outputs.x || true")).toBe(true);
  });

  it("is unknown when neither operand settles it", () => {
    expect(evaluate("needs.detect.outputs.x || false")).toBe(null);
    expect(evaluate("needs.detect.outputs.x || needs.detect.outputs.y")).toBe(null);
  });

  it("coalesces to a value rather than a boolean", () => {
    // `a || b` yields the first truthy operand, so a comparison against the
    // result compares the *value*, not the truthiness.
    expect(evaluate("('' || 'b') == 'b'")).toBe(true);
    expect(evaluate("('a' || 'b') == 'a'")).toBe(true);
  });
});

describe("negation", () => {
  it("flips a settled operand", () => {
    expect(evaluate("!true")).toBe(false);
    expect(evaluate("!false")).toBe(true);
  });

  it("leaves an unsettled one unsettled", () => {
    expect(evaluate("!needs.detect.outputs.x")).toBe(null);
  });

  it("binds tighter than a comparison", () => {
    expect(evaluate("!false == true")).toBe(true);
  });

  it("nests", () => {
    expect(evaluate("!!true")).toBe(true);
  });
});

describe("comparison", () => {
  it.each([
    ["'a' == 'a'", true],
    ["'a' == 'b'", false],
    ["'a' != 'b'", true],
    ["'a' != 'a'", false],
    ["1 < 2", true],
    ["2 < 1", false],
    ["1 <= 1", true],
    ["2 > 1", true],
    ["1 > 2", false],
    ["1 >= 2", false],
    ["2 >= 2", true],
    ["'a' < 'b'", true],
    ["true == true", true],
    ["true != false", true],
  ] as const)("reads %s as %s", (src, want) => {
    expect(evaluate(src)).toBe(want);
  });

  it("refuses to compare across types", () => {
    // GitHub coerces here and the corner cases are surprising (`'' == 0` is
    // true). Not modelling the table is the honest option, not a gap.
    expect(evaluate("'1' == 1")).toBe(null);
    expect(evaluate("'' == 0")).toBe(null);
    expect(evaluate("true == 'true'")).toBe(null);
  });

  it("refuses to order booleans", () => {
    expect(evaluate("true > false")).toBe(null);
    expect(evaluate("false < true")).toBe(null);
  });

  it("is unknown when either side is unknown", () => {
    expect(evaluate("needs.detect.outputs.x == 'y'")).toBe(null);
    expect(evaluate("'y' == needs.detect.outputs.x")).toBe(null);
  });

  it("cannot compare a value known only by its truthiness", () => {
    // `(unknown && false)` is known-falsy but has no value to compare.
    expect(evaluate("(needs.x && false) == ''")).toBe(null);
  });
});

describe("context lookups", () => {
  it("resolves a supplied input", () => {
    expect(evaluate("inputs.mode == 'fast'", { inputs: { mode: { kind: "value", v: "fast" } } })).toBe(
      true,
    );
  });

  it("leaves an absent input unknown rather than empty", () => {
    // Treating a missing input as `''` would silently decide guards that are
    // not decided.
    expect(evaluate("inputs.mode == ''", { inputs: {} })).toBe(null);
    expect(evaluate("inputs.mode == ''")).toBe(null);
  });

  it("honours an input that is present but unresolvable", () => {
    expect(evaluate("inputs.mode == 'fast'", { inputs: { mode: { kind: "unknown" } } })).toBe(null);
  });

  it("resolves a supplied github value", () => {
    expect(evaluate("github.event_name == 'pull_request'", FLEET)).toBe(true);
    expect(evaluate("github.event_name == 'push'", FLEET)).toBe(false);
  });

  it("leaves an unsupplied github value unknown", () => {
    expect(evaluate("github.ref == 'refs/heads/main'", FLEET)).toBe(null);
  });

  it("leaves every runtime context unknown", () => {
    for (const path of [
      "steps.scan.outputs.x",
      "matrix.language",
      "env.FOO",
      "vars.FOO",
      "secrets.FOO",
      "runner.os",
    ]) {
      expect(evaluate(`${path} == 'x'`, FLEET)).toBe(null);
    }
  });

  it("leaves a bare name with no context unknown", () => {
    expect(evaluate("something == 'x'")).toBe(null);
  });
});

// `needs.*` is the one runtime context that can be supplied: the outputs are
// computed before the jobs that read them expand. Nothing in this module works
// out what they are — they are handed in.
describe("needs outputs", () => {
  const NEEDS: Scope = {
    needs: { detect: { outputs: { coverage_languages: '["typescript"]', e2e: "true" } } },
  };

  it("resolves an output the caller supplied", () => {
    expect(evaluate("needs.detect.outputs.coverage_languages != '[]'", NEEDS)).toBe(true);
  });

  it("keeps the output a raw string", () => {
    // The runner substitutes what a step wrote, and the guards compare against
    // strings. Parsing here would make `!= '[]'` a mixed-type comparison, which
    // is unknown — turning a decidable guard undecidable.
    expect(evaluate("needs.detect.outputs.coverage_languages == '[\"typescript\"]'", NEEDS)).toBe(
      true,
    );
    expect(evaluate("needs.detect.outputs.e2e == 'true'", NEEDS)).toBe(true);
  });

  it("reads an output the supplied job does not list as the empty string", () => {
    // The caller promised the set is complete, so an absent key is an output no
    // step wrote — which the runner substitutes as `''`.
    expect(evaluate("needs.detect.outputs.missing == ''", NEEDS)).toBe(true);
  });

  it("leaves a job the caller said nothing about unknown", () => {
    expect(evaluate("needs.other.outputs.x == ''", NEEDS)).toBe(null);
    expect(evaluate("needs.detect.outputs.x == ''")).toBe(null);
  });

  it("leaves anything but an outputs lookup unknown", () => {
    // `result` is a verdict on a run that has not happened; the rest are not
    // shapes the context has.
    expect(evaluate("needs.detect.result == 'success'", NEEDS)).toBe(null);
    expect(evaluate("needs.detect.outputs.a.b == ''", NEEDS)).toBe(null);
    expect(evaluate("needs.detect == ''", NEEDS)).toBe(null);
  });

  it("coalesces two outputs the way the fleet's mutation guard does", () => {
    const scope: Scope = {
      needs: { detect: { outputs: { mutation_languages: "[]", coverage_languages: '["rust"]' } } },
    };
    const cond =
      "(needs.detect.outputs.mutation_languages || needs.detect.outputs.coverage_languages) != '[]'";
    // `'[]'` is a non-empty string, so it is truthy, so `||` yields it and the
    // comparison is false. This is the GitHub trap the evaluator keeps.
    expect(evaluate(cond, scope)).toBe(false);
  });
});

// `steps.*` mirrors `needs.*`: the executor's step walk is the one caller
// that can supply it honestly, and the completeness contract is the same.
describe("steps outputs", () => {
  const STEPS: Scope = {
    steps: {
      scan_hermetic: { outputs: {} },
      scan_published: { outputs: { static_languages: '["typescript"]' } },
    },
  };

  it("resolves an output of a step the walk recorded", () => {
    expect(evaluate("steps.scan_published.outputs.static_languages != '[]'", STEPS)).toBe(true);
  });

  it("coalesces past a skipped step the way the fleet's detect outputs do", () => {
    // A skipped step is present with no outputs, so every read against it is
    // '', which is falsy, so `||` yields the step that ran. This is the exact
    // shape of every one of detect's ~25 `outputs:` entries.
    const cond =
      "(steps.scan_hermetic.outputs.static_languages || steps.scan_published.outputs.static_languages)" +
      " == '[\"typescript\"]'";
    expect(evaluate(cond, STEPS)).toBe(true);
  });

  it("reads an output the recorded step did not write as the empty string", () => {
    expect(evaluate("steps.scan_published.outputs.missing == ''", STEPS)).toBe(true);
  });

  it("leaves a step the scope does not name unknown", () => {
    expect(evaluate("steps.other.outputs.x == ''", STEPS)).toBe(null);
    expect(evaluate("steps.scan_published.outputs.x == ''")).toBe(null);
  });

  it("leaves anything but an outputs lookup unknown", () => {
    // `outcome` and `conclusion` are verdicts the executor does not track — a
    // failed step fails the whole execution instead.
    expect(evaluate("steps.scan_published.outcome == 'success'", STEPS)).toBe(null);
    expect(evaluate("steps.scan_published.outputs.a.b == ''", STEPS)).toBe(null);
  });
});

describe("functions", () => {
  it("treats always() as true", () => {
    expect(evaluate("always()")).toBe(true);
  });

  it("evaluates contains over two known strings", () => {
    expect(evaluate("contains('abc', 'b')")).toBe(true);
    expect(evaluate("contains('abc', 'z')")).toBe(false);
  });

  it("evaluates startsWith and endsWith", () => {
    expect(evaluate("startsWith('abc', 'ab')")).toBe(true);
    expect(evaluate("startsWith('abc', 'bc')")).toBe(false);
    expect(evaluate("endsWith('abc', 'bc')")).toBe(true);
    expect(evaluate("endsWith('abc', 'ab')")).toBe(false);
  });

  it("leaves contains unknown when an argument is not a known string", () => {
    expect(evaluate("contains(needs.x.outputs.y, 'b')")).toBe(null);
    expect(evaluate("contains('abc', needs.x.outputs.y)")).toBe(null);
    expect(evaluate("contains(1, 2)")).toBe(null);
  });

  it("leaves startsWith unknown when an argument is not a known string", () => {
    expect(evaluate("startsWith(needs.x.outputs.y, 'b')")).toBe(null);
    expect(evaluate("startsWith('abc', 1)")).toBe(null);
  });

  it("leaves the job-status functions unknown", () => {
    // These depend on jobs that have not run.
    expect(evaluate("success()")).toBe(null);
    expect(evaluate("failure()")).toBe(null);
    expect(evaluate("cancelled()")).toBe(null);
  });

  it("leaves an unmodelled function unknown but still consumes its arguments", () => {
    // If the argument list were not parsed, the tokens after it would parse
    // against the wrong position and the result would be arbitrary rather
    // than unknown.
    expect(evaluate("toJSON('a') == 'b'")).toBe(null);
    expect(evaluate("format('{0}', 'a', 'b') == 'x' || true")).toBe(true);
  });

  it("leaves contains unknown at the wrong arity", () => {
    expect(evaluate("contains('abc')")).toBe(null);
  });
});

// `fromJSON` is what a dynamic matrix axis is built out of; the value side of
// it lives in evaluateValue's tests. What belongs here is how its results
// behave under truthiness and comparison.
describe("fromJSON", () => {
  const NEEDS: Scope = {
    needs: {
      detect: {
        outputs: { langs: '["typescript","rust"]', empty: "[]", flag: "true", n: "3" },
      },
    },
  };

  it("hands back a scalar as an ordinary value, so it stays comparable", () => {
    expect(evaluate("fromJSON(needs.detect.outputs.flag)", NEEDS)).toBe(true);
    expect(evaluate("fromJSON(needs.detect.outputs.n) == 3", NEEDS)).toBe(true);
    expect(evaluate("fromJSON('\"s\"') == 's'")).toBe(true);
  });

  it("reads a parsed null as falsy", () => {
    expect(evaluate("fromJSON('null')")).toBe(false);
  });

  it("does not model the truthiness of an array or an object", () => {
    // GitHub casts them, but no workflow asks it to, and the answer is not
    // worth guessing at to find out.
    expect(evaluate("fromJSON('[]')")).toBe(null);
    expect(evaluate("fromJSON('[1]')")).toBe(null);
    expect(evaluate("fromJSON('{}')")).toBe(null);
  });

  it("compares a structure by instance, so it equals nothing written beside it", () => {
    expect(evaluate("fromJSON('[1]') == '[1]'")).toBe(false);
  });
});

describe("the shapes that appear in testing-conventions", () => {
  // Every condition below is copied from
  // `thekevinscott/testing-conventions/.github/workflows/testing-conventions.yml@v0`.
  // They are the reason this evaluator exists; if one of them regresses to
  // `null`, a fleet gate loses a check name.

  it("skips mutation, because the caller's gates list decides it", () => {
    const cond =
      "github.event_name == 'pull_request' && (inputs.gates == '' || contains(inputs.gates, '\"mutation\"')) && (needs.detect.outputs.mutation_languages || needs.detect.outputs.coverage_languages) != '[]'";
    expect(evaluate(cond, FLEET)).toBe(false);
  });

  it("skips packaging on the same reasoning", () => {
    const cond =
      "(inputs.gates == '' || contains(inputs.gates, '\"packaging\"')) && (inputs.packaging_artifact != '' || needs.detect.outputs.packaging_build != '' || needs.detect.outputs.packaging_dist == 'true')";
    expect(evaluate(cond, FLEET)).toBe(false);
  });

  it("skips e2e-verify on the same reasoning", () => {
    const cond =
      "github.event_name == 'pull_request' && (inputs.gates == '' || contains(inputs.gates, '\"e2e-verify\"')) && (inputs.run_e2e || needs.detect.outputs.e2e_attestation == 'true')";
    expect(evaluate(cond, FLEET)).toBe(false);
  });

  it("leaves unit-coverage unknown, because only detect's outputs decide it", () => {
    // The gate is requested, so the only remaining clause reads an output of a
    // job that has not run. Short-circuiting cannot settle that, and guessing
    // would be a claim about which languages the repo has sources for. If
    // those outputs ever arrive in the scope, this becomes decidable there —
    // not here.
    const cond =
      "(inputs.gates == '' || contains(inputs.gates, '\"unit-coverage\"')) && needs.detect.outputs.coverage_languages != '[]'";
    expect(evaluate(cond, FLEET)).toBe(null);
  });

  it("leaves static unknown for the same reason", () => {
    const cond =
      "(inputs.gates == '' || contains(inputs.gates, '\"colocated-test\"') || contains(inputs.gates, '\"unit-lint\"') || contains(inputs.gates, '\"integration-lint\"')) && (needs.detect.outputs.static_languages || needs.detect.outputs.integration_lint_languages) != '[]'";
    expect(evaluate(cond, FLEET)).toBe(null);
  });

  it("runs a gate the caller did request once its other clauses hold", () => {
    const cond = "inputs.gates == '' || contains(inputs.gates, '\"unit-coverage\"')";
    expect(evaluate(cond, FLEET)).toBe(true);
  });

  it("treats an empty gates list as every gate requested", () => {
    const scope: Scope = { inputs: { gates: { kind: "value", v: "" } } };
    expect(evaluate("inputs.gates == '' || contains(inputs.gates, '\"mutation\"')", scope)).toBe(true);
  });
});

describe("malformed input is unknown, never a guess", () => {
  it.each([
    ["'unterminated", "an unterminated string"],
    ["true @ false", "a character with no token"],
    ["(true", "an unclosed group"],
    ["true)", "a stray closing paren"],
    ["true false", "two expressions with no operator"],
    ["true &&", "a missing right operand"],
    ["contains('a' 'b')", "a malformed argument list"],
    ["&& true", "a missing left operand"],
  ] as const)("refuses %s (%s)", (src, _why) => {
    expect(evaluate(src)).toBe(null);
  });
});

describe("tokenizer details", () => {
  it("reads a doubled quote as one literal quote", () => {
    expect(evaluate("'it''s' == 'it''s'")).toBe(true);
    expect(evaluate("contains('it''s', '''')")).toBe(true);
  });

  it("ignores whitespace of every kind", () => {
    expect(evaluate("\t true \n &&\r true ")).toBe(true);
  });

  it("accepts a call with no arguments", () => {
    expect(evaluate("always()")).toBe(true);
  });

  it("keeps dots and dashes inside one path", () => {
    expect(evaluate("needs.detect-languages.outputs.x == 'y'")).toBe(null);
  });
});

describe("index access on fromJSON results", () => {
  /** The gate putitoutthere's build job actually writes. */
  const GATE = "fromJSON(needs.plan.outputs.matrix || '[]')[0] != null";
  const planScope = (matrix: string): Scope => ({
    needs: { plan: { outputs: { matrix } } },
  });

  it("decides the fleet's did-the-plan-schedule-anything gate, both ways", () => {
    expect(evaluate(GATE, planScope('[{"kind":"npm"}]'))).toBe(true);
    expect(evaluate(GATE, planScope(""))).toBe(false);
    expect(evaluate(GATE, planScope("[]"))).toBe(false);
  });

  it("leaves the gate unknown when the plan output is unknown", () => {
    expect(evaluate(GATE)).toBe(null);
  });

  it("reads a scalar element as an ordinary comparable value", () => {
    expect(evaluate("fromJSON('[5]')[0] == 5")).toBe(true);
    expect(evaluate("fromJSON('{\"k\":\"v\"}')['k'] == 'v'")).toBe(true);
  });

  it("keeps a structured element structured, one level per bracket", () => {
    expect(evaluate("fromJSON('[[7]]')[0][0] == 7")).toBe(true);
  });

  it("reads a missing element as the empty string, the way null reads", () => {
    // GitHub yields null past the end; null coerces equal to ''.
    expect(evaluate("fromJSON('[]')[0] == ''")).toBe(true);
    expect(evaluate("fromJSON('[null]')[0] == null")).toBe(true);
    expect(evaluate("fromJSON('[]')[0]")).toBe(false);
  });

  it.each([
    ["'abc'[0]", "an index into a non-json"],
    ["fromJSON('[1]')['k']", "a string index into an array"],
    ["fromJSON('{\"k\":1}')[0]", "a number index into an object"],
    ["fromJSON('[1]')[needs.x.outputs.y]", "an index that is itself unknown"],
    ["fromJSON('[1]')[0", "an unclosed bracket"],
  ] as const)("refuses %s (%s)", (src, _why) => {
    expect(evaluate(src)).toBe(null);
  });
});

describe("comparison against a fromJSON structure", () => {
  it("decides equality by instance: a structure equals nothing written beside it", () => {
    // GitHub compares arrays and objects by instance, and two sides of one
    // comparison are never the same instance.
    expect(evaluate("fromJSON('[1]') == fromJSON('[1]')")).toBe(false);
    expect(evaluate("fromJSON('[1]') != null")).toBe(true);
    expect(evaluate("fromJSON('{}') == ''")).toBe(false);
    expect(evaluate("'' != fromJSON('{}')")).toBe(true);
  });

  it("does not order a structure", () => {
    expect(evaluate("fromJSON('[1]') < 'x'")).toBe(null);
  });
});
