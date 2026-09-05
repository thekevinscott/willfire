import { describe, expect, it } from "vitest";
import { isCheckout } from "./isCheckout.js";

describe("isCheckout", () => {
  it("matches actions/checkout at any ref", () => {
    expect(isCheckout("actions/checkout@v6")).toBe(true);
    expect(isCheckout(`actions/checkout@${"a".repeat(40)}`)).toBe(true);
  });

  it("refuses a fork, a subdirectory, and a bare name with no ref", () => {
    expect(isCheckout("someone/actions/checkout@v6")).toBe(false);
    expect(isCheckout("actions/checkout-extra@v1")).toBe(false);
    expect(isCheckout("actions/checkout")).toBe(false);
  });
});
