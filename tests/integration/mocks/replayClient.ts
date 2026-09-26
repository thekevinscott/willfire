import type { GithubClient } from "willfire";

export interface RecordedCall {
  method: string;
  params: Record<string, string | number>;
  result: unknown;
}

// A call the live client rejected (a 404 for a file absent at that ref) is
// recorded as { $error: { status, message } } and replayed as a rejection, so
// willfire's own status handling runs at replay exactly as it did live.
const errorRef = (result: unknown): { status: number; message: string } | null => {
  const err = (result as { $error?: { status?: unknown; message?: unknown } } | null)?.$error;
  return typeof err?.status === "number" && typeof err.message === "string"
    ? { status: err.status, message: err.message }
    : null;
};

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
        const result = byKey.get(k);
        const err = errorRef(result);
        if (err !== null) {
          return Promise.reject(Object.assign(new Error(err.message), { status: err.status }));
        }
        return Promise.resolve(result);
      },
  });
}
