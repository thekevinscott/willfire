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
});
