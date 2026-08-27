import { describe, expect, it } from "vitest";
import { imageTag } from "./imageTag.js";

describe("imageTag", () => {
  it("is a function of the dockerfile alone", () => {
    expect(imageTag("FROM x\n")).toBe(imageTag("FROM x\n"));
    expect(imageTag("FROM x\n")).not.toBe(imageTag("FROM y\n"));
    expect(imageTag("FROM x\n")).toMatch(/^willfire-sandbox:[0-9a-f]{12}$/);
  });
});
