import { readFileSync } from "node:fs";
import { join } from "node:path";

export const getResponse = (dir: string): string[] =>
  JSON.parse(readFileSync(join(dir, "fixture.json"), "utf8")) as string[];
