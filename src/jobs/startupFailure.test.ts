import { describe, expect, it } from "vitest";
import { startupFailure } from "./startupFailure.js";

describe("startupFailure", () => {
  it("carries the reason as its message", () => {
    expect(startupFailure("cannot fetch ./x.yml").message).toBe("cannot fetch ./x.yml");
  });

  it("tags the error so a reader can tell it from any other", () => {
    expect(startupFailure("boom").startupFailure).toBe(true);
  });
});
