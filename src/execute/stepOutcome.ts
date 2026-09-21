import { readFile } from "node:fs/promises";
import { failureTail } from "../failureTail.js";
import { err } from "./err.js";
import { parseGithubOutput } from "./parseGithubOutput.js";
import type { Res, RunResult } from "./types.js";

/** What a step's command left behind: its outputs, or why it produced none. */
export async function stepOutcome(
  r: RunResult,
  outFile: string,
  label: string,
): Promise<Res<Record<string, string>>> {
  if (r.code !== 0) {
    const tail = failureTail(r);
    return err(`${label}: exited ${r.code}${tail === "" ? "" : `\n${tail}`}`);
  }
  const outputs = parseGithubOutput(await readFile(outFile, "utf8"));
  if (outputs === null) {
    return err(`${label}: malformed GITHUB_OUTPUT`);
  }
  return { ok: true, v: outputs };
}
