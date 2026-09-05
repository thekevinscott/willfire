// Duck-typed rather than class-checked, so a caller-supplied client's errors
// (octokit's carry `status` too) read the same way. Null means no status at
// all: a network failure, or a client that does not report one.

export function errorStatus(e: unknown): number | null {
  if (typeof e === "object" && e !== null && "status" in e && typeof e.status === "number") {
    return e.status;
  }
  return null;
}
