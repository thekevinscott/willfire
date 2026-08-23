/**
 * How a single matrix value is rendered inside a check name.
 *
 * Probe-verified: object values are flattened to their own values, so
 * `cfg: {os: linux, arch: x64}` renders as `linux, x64` — the check is
 * `m-object (linux, x64)`.
 */
export function formatMatrixValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(formatMatrixValue).join(", ");
  if (typeof v === "object") return Object.values(v).map(formatMatrixValue).join(", ");
  return String(v);
}
