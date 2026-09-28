import { describe, expect, it } from "vitest";
import { renderName } from "./renderName.js";

describe("renderName", () => {
  it("substitutes matrix values", () => {
    expect(renderName("build ${{ matrix.os }}", { os: "linux" })).toEqual({
      text: "build linux",
      resolved: true,
    });
  });

  it("stays unresolved with no combination to read from", () => {
    expect(renderName("build ${{ matrix.os }}", null)).toEqual({
      text: "build ${{ matrix.os }}",
      resolved: false,
    });
  });

  it("substitutes nothing for a key the combination lacks", () => {
    // Probe PR #372 run 36431257532. The edge space survives here; trimming is
    // jobDisplayName's, because the parenthetical is appended after this.
    expect(renderName("build ${{ matrix.nope }}", { os: "linux" })).toEqual({
      text: "build ",
      resolved: true,
    });
  });

  it("stays unresolved reading the matrix with no combination at all", () => {
    // A job `if:` is evaluated before the matrix expands, so there is nothing
    // for the key to be absent from.
    expect(renderName("build ${{ matrix.nope }}", null)).toEqual({
      text: "build ${{ matrix.nope }}",
      resolved: false,
    });
  });

  it("evaluates github.event_name, the one non-matrix expression it can", () => {
    expect(renderName("on ${{ github.event_name }}", null)).toEqual({
      text: "on pull_request",
      resolved: true,
    });
  });

  it("still substitutes what it can when another expression stays unresolved", () => {
    expect(renderName("b ${{ matrix.os }} ${{ inputs.x }}", { os: "linux" })).toEqual({
      text: "b linux ${{ inputs.x }}",
      resolved: false,
    });
  });

  it("stays unresolved on any other expression", () => {
    expect(renderName("x ${{ inputs.flavour }}", { os: "linux" })).toEqual({
      text: "x ${{ inputs.flavour }}",
      resolved: false,
    });
  });

  it("resolves a conditional suffix, not just a bare path", () => {
    // The slot starts with `matrix.` but is an expression, not a path. A
    // prefix test read it as the path `build && format(...) || ''`, found
    // nothing, and left the whole name unresolved.
    expect(
      renderName("build${{ matrix.build && format(' {0}', matrix.build) || '' }}", {
        build: "release",
      }),
    ).toEqual({ text: "build release", resolved: true });
  });

  it("coalesces past a falsy axis", () => {
    expect(renderName("t ${{ matrix.label || 'default' }}", { label: "" })).toEqual({
      text: "t default",
      resolved: true,
    });
  });

  it("renders a structured axis value the way the parenthetical does", () => {
    expect(renderName("m ${{ matrix.cfg }}", { cfg: { os: "linux", arch: "x64" } })).toEqual({
      text: "m linux, x64",
      resolved: true,
    });
  });

  it("reads a nested path out of a structured axis value", () => {
    expect(renderName("m ${{ matrix.cfg.os }}", { cfg: { os: "linux" } })).toEqual({
      text: "m linux",
      resolved: true,
    });
  });

  it("decides a conditional slot that reads an axis the leg lacks", () => {
    // An absent axis is the empty string, so the `&&` is falsy and the `||`
    // leg wins. This is the shape the fleet writes for an optional axis.
    expect(
      renderName("build${{ matrix.build && format(' {0}', matrix.build) || '' }}", {
        os: "linux",
      }),
    ).toEqual({ text: "build", resolved: true });
  });
});
