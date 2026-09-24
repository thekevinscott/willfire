import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RecordedCall } from "./replayClient.js";

export interface Fixture {
  dispatched: { workflow: string; name: string; conclusion: string | null }[];
  calls: RecordedCall[];
}

export const getFixture = (dir: string): Fixture =>
  JSON.parse(readFileSync(join(dir, "fixture.json"), "utf8")) as Fixture;
