import { describe, expect, it } from "vitest";
import { quoteBlock } from "./quoteBlock.js";

// The transcript `pnpm exec anything` wrote to stdout, with stderr empty, in a
// directory with no package.json above it (issue #170, captured 2026-09-02).
const exe =
  "/home/duncan/work/.pnpm-store/v11/links/@pnpm/exe/11.11.0" +
  "/70df7b19032aa294b2b3b575aca9bc896ee03469684c945d81f2218b8672cc96/node_modules/@pnpm/exe";
const frame = (fn: string, at: string): string => `    at ${fn} (file://${exe}/dist/pnpm.mjs:${at})`;
const failed = `Command failed with exit code 1: '${exe}/pnpm' install`;
const pnpmStdout = [
  "[ERR_PNPM_NO_PKG_MANIFEST] No package.json found in /tmp/willfire-repro-169-empty",
  `[ERROR] ${failed}`,
  "",
  `pnpm: ${failed}`,
  frame("getFinalError", "36343:14"),
  frame("makeError", "38650:21"),
  frame("getSyncResult", "40494:10"),
  frame("spawnSubprocessSync", "40454:14"),
  frame("execaCoreSync", "40384:23"),
  frame("callBoundExeca", "42912:23"),
  frame("boundExeca", "42889:49"),
  frame("sync", "43048:10"),
  frame("runPnpmCli", "247808:5"),
  frame("runDepsStatusCheck", "249560:7"),
].join("\n");

const padded = (n: number, width: number): string[] =>
  Array.from({ length: n }, (_, i) => `${i}`.padEnd(width, "x"));

describe("quoteBlock", () => {
  it("quotes every line of a stream that fits the cap", () => {
    expect(quoteBlock("first\nsecond\nthird")).toBe("first\nsecond\nthird");
  });

  it("drops blank lines", () => {
    expect(quoteBlock("only\n\n  \n")).toBe("only");
  });

  it("strips each line's indentation", () => {
    expect(quoteBlock("  just this  \n    at frame ")).toBe("just this\nat frame");
  });

  it("yields the empty string for a stream with nothing in it", () => {
    expect(quoteBlock("   \n\n")).toBe("");
  });

  it("quotes a stream sitting exactly on the cap whole", () => {
    const whole = [...padded(10, 371), "z".repeat(376)].join("\n");
    expect(whole).toHaveLength(4096);
    expect(quoteBlock(whole)).toBe(whole);
  });

  it("truncates a stream too few lines to elide", () => {
    const out = quoteBlock(`head\n${"y".repeat(5000)}END`);
    expect(out.length).toBe(4096);
    expect(out.startsWith("head\nyyy")).toBe(true);
    expect(out.endsWith("...")).toBe(true);
  });

  it("truncates rather than claiming it elided nothing", () => {
    const out = quoteBlock(padded(10, 500).join("\n"));
    expect(out.length).toBe(4096);
    expect(out).not.toContain("elided");
    expect(out.endsWith("...")).toBe(true);
  });

  it("keeps both ends, eliding the middle", () => {
    const lines = padded(20, 300);
    const out = quoteBlock(lines.join("\n")).split("\n");
    expect(out.slice(0, 5)).toEqual(lines.slice(0, 5));
    expect(out[5]).toBe("... 10 lines elided ...");
    expect(out.slice(6)).toEqual(lines.slice(-5));
  });

  it("keeps an end that fills its share of the cap exactly", () => {
    // Five lines joining to 2036 characters: the whole per-end share, given the
    // 22-character marker two newlines away from the other 2036.
    const head = ["a", "b", "c", "d", "e".repeat(2028)];
    const tail = padded(5, 100);
    const out = quoteBlock([...head, ...padded(5, 900), ...tail].join("\n")).split("\n");
    expect(out.slice(0, 5)).toEqual(head);
    expect(out[5]).toBe("... 5 lines elided ...");
    expect(out.slice(6)).toEqual(tail);
  });

  it("splits the cap between the ends when both overflow it", () => {
    const out = quoteBlock(padded(12, 1000).join("\n"));
    expect(out.length).toBe(4096);
    expect(out).toContain("... 2 lines elided ...");
    expect(out.startsWith("0xxx")).toBe(true);
    expect(out.endsWith("...")).toBe(true);
  });

  it("leads with the cause on real pnpm output rather than a stack frame", () => {
    const out = quoteBlock(pnpmStdout).split("\n");
    expect(out).toHaveLength(13);
    expect(out[0]).toBe(
      "[ERR_PNPM_NO_PKG_MANIFEST] No package.json found in /tmp/willfire-repro-169-empty",
    );
    expect(out.at(-1)).toBe(frame("runDepsStatusCheck", "249560:7").trim());
  });
});
