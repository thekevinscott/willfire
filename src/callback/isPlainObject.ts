/** An object literal in JSON terms: not null, not an array. */
export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
