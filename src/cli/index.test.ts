import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("cli barrel", () => {
  it("exposes exactly the argument parser", () => {
    expect(Object.keys(barrel)).toEqual(["parseArgs"]);
    expect(typeof barrel.parseArgs).toBe("function");
  });
});
