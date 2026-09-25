import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RecordedCall } from "./replayClient.js";

export interface Fixture {
  /** Raw Actions API job objects; tests derive what they assert on. */
  dispatched: { name: string; conclusion: string | null }[];
  calls: RecordedCall[];
}

// JSON has no ArrayBuffer, so a binary result is recorded as a reference to a
// sibling file holding the bytes.
const binaryRef = (result: unknown): string | null =>
  typeof result === "object" &&
  result !== null &&
  typeof (result as { $binary?: unknown }).$binary === "string"
    ? (result as { $binary: string }).$binary
    : null;

const read = (dir: string, file: string): unknown =>
  JSON.parse(readFileSync(join(dir, file), "utf8"));

export const getFixture = (dir: string): Fixture => {
  const dispatched = read(dir, "dispatched.json") as Fixture["dispatched"];
  const calls = (read(dir, "calls.json") as RecordedCall[]).map((call) => {
    const ref = binaryRef(call.result);
    if (ref === null) return call;
    return { ...call, result: new Uint8Array(readFileSync(join(dir, ref))).buffer };
  });
  return { dispatched, calls };
};
