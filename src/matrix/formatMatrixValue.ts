export function formatMatrixValue(v: unknown): string {
  if (v == null) {
    return "";
  }
  if (Array.isArray(v)) {
    return v.map(formatMatrixValue).join(", ");
  }
  if (typeof v === "object") {
    return Object.values(v).map(formatMatrixValue).join(", ");
  }
  return String(v);
}
