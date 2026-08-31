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

  it("stays unresolved when the combination lacks the key", () => {
    expect(renderName("build ${{ matrix.nope }}", { os: "linux" })).toEqual({
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

  it("stays unresolved when a conditional slot reads an axis the leg lacks", () => {
    // An absent axis is unknown, not empty, so the whole slot is undecided.
    expect(
      renderName("build${{ matrix.build && format(' {0}', matrix.build) || '' }}", {
        os: "linux",
      }),
    ).toEqual({
      text: "build${{ matrix.build && format(' {0}', matrix.build) || '' }}",
      resolved: false,
    });
  });
});
