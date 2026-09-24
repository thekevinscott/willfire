import type { GithubClient } from "willfire";

export interface RecordedCall {
  method: string;
  params: Record<string, string | number>;
  result: unknown;
}

// Property order in a recording must not decide whether a lookup hits.
const key = (method: string, params: Record<string, string | number>): string =>
  `${method}(${JSON.stringify(params, Object.keys(params).sort())})`;

export function replayClient(calls: RecordedCall[]): GithubClient {
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
