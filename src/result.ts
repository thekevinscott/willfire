/** A value, or the reason there is none. */
export type Res<T> = { ok: true; v: T } | { ok: false; reason: string };

// A declaration, not an arrow const: a module-level arrow is a static binding
// the mutation gate cannot re-bind, so its body goes untested.
export function err(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}
