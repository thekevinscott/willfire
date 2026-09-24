import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { predict, type GithubClient } from "willfire";
import { discoverCases } from "../cases.js";

interface RecordedCall {
  method: string;
  params: Record<string, string | number>;
  result: unknown;
}

interface Fixture {
  dispatched: { workflow: string; name: string; conclusion: string | null }[];
  calls: RecordedCall[];
}

// Property order in a recording must not decide whether a lookup hits.
const key = (method: string, params: Record<string, string | number>): string =>
  `${method}(${JSON.stringify(params, Object.keys(params).sort())})`;

function replayClient(calls: RecordedCall[]): GithubClient {
  const byKey = new Map(calls.map((call) => [key(call.method, call.params), call.result]));
  return new Proxy({} as GithubClient, {
    get:
      (_target, method: string) =>
      (params: Record<string, string | number>): Promise<unknown> => {
        const k = key(method, params);
        if (!byKey.has(k)) {
          throw new Error(`replayClient: no recorded response for ${k}`);
        }
        return Promise.resolve(byKey.get(k));
      },
  });
}

const CASES = discoverCases(new URL("./fixtures/", import.meta.url));

test.each(CASES)("$owner/$repo#$pr predicts the dispatched check list exactly", async (c) => {
  const fixture = JSON.parse(readFileSync(join(c.dir, "fixture.json"), "utf8")) as Fixture;

  const { checkNames } = await predict(
    replayClient(fixture.calls),
    `${c.owner}/${c.repo}`,
    c.pr,
  );

  expect(checkNames).toEqual([...new Set(fixture.dispatched.map((d) => d.name))].sort());
});
