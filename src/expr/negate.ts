export function negate(b: boolean | null): boolean | null {
  return b === null ? null : !b;
}
