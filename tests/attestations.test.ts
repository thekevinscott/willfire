// The e2e-verify gate (testing-conventions, upstream) checks only that a
// receipt file is present in a branch's diff -- never its exit_code. A
// receipt for a failed run passed that gate and sat on `main` for three weeks
// (issue #181, fixed in #231). This is willfire's own backstop: every
// checked-in receipt must record a passing run, checked on every `pnpm test`.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

interface Receipt {
  command: string;
  ran_at: number;
  exit_code: number;
  commit: string;
  branch: string;
}

const dir = fileURLToPath(new URL("../e2e-attestations", import.meta.url));
const files = readdirSync(dir).filter((name) => name.endsWith(".json"));

describe.each(files)("%s", (file) => {
  test("recorded exit_code 0", () => {
    const receipt = JSON.parse(readFileSync(join(dir, file), "utf8")) as Receipt;
    expect(receipt.exit_code).toBe(0);
  });
});
