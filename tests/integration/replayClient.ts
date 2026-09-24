import type { GithubClient } from "../../src/index.js";

export interface RecordedCall {
  method: string;
  params: Record<string, string | number>;
  result: unknown;
}

// Property order in a recording must not decide whether a lookup hits.
const key = (method: string, params: Record<string, string | number>): string =>
  `${method}(${JSON.stringify(params, Object.keys(params).sort())})`;

/**
 * A `GithubClient` that answers only from `calls`. Every other boundary
 * willfire crosses is substituted separately; this one covers the API.
 *
 * An unrecorded call throws rather than returning a stub, so a code path that
 * reaches for an endpoint nobody recorded fails by name instead of silently
 * reading an empty answer.
 */
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
