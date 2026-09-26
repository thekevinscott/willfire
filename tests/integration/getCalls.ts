import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RecordedCall } from "./mocks/replayClient.js";

// JSON has no ArrayBuffer, so a binary result is recorded as a reference to a
// sibling file holding the bytes.
const binaryRef = (result: unknown): string | null =>
  typeof result === "object" &&
  result !== null &&
  typeof (result as { $binary?: unknown }).$binary === "string"
    ? (result as { $binary: string }).$binary
    : null;

export const getCalls = (dir: string): RecordedCall[] => {
  const calls = JSON.parse(readFileSync(join(dir, "calls.json"), "utf8")) as RecordedCall[];
  return calls.map((call) => {
    const ref = binaryRef(call.result);
    if (ref === null) return call;
    return { ...call, result: new Uint8Array(readFileSync(join(dir, ref))).buffer };
  });
};
