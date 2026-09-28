import { describe, expect, it } from "vitest";
import { stateVolumes } from "./stateVolumes.js";

describe("stateVolumes", () => {
  it("derives both volume names from the key, in the willfire namespace", () => {
    expect(stateVolumes("k1")).toEqual({
      usr: "willfire-state-k1-usr",
      tmp: "willfire-state-k1-tmp",
    });
  });
});
