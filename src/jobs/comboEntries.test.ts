import { describe, expect, it } from "vitest";
import { comboEntries } from "./comboEntries.js";

describe("comboEntries", () => {
  it("names one entry per combination and threads status and reason through", () => {
    const combos = [
      { values: { os: "linux" }, displayKeys: ["os"] },
      { values: { os: "mac" }, displayKeys: ["os"] },
    ];
    expect(comboEntries("a", {}, combos, "", true, "run", "")).toEqual([
      { job: "a (linux)", checkName: "a (linux)", status: "run", reason: "" },
      { job: "a (mac)", checkName: "a (mac)", status: "run", reason: "" },
    ]);
  });

  it("uses the bare name for the no-matrix combination", () => {
    expect(comboEntries("a", {}, [null], "", true, "unknown", "why")).toEqual([
      { job: "a", checkName: "a", status: "unknown", reason: "why" },
    ]);
  });

  it("applies the caller's prefix, and an unresolved prefix nulls the check name", () => {
    expect(comboEntries("a", {}, [null], "call / ", false, "run", "")).toEqual([
      { job: "call / a", checkName: null, status: "run", reason: "" },
    ]);
  });

  it("nulls the check name when the display name itself is unresolved", () => {
    const entries = comboEntries("a", { name: "b ${{ matrix.nope }}" }, [null], "", true, "run", "");
    expect(entries).toEqual([
      { job: "b ${{ matrix.nope }}", checkName: null, status: "run", reason: "" },
    ]);
  });
});
