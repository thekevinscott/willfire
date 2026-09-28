/**
 * A mixed-type comparison casts both sides to a number: a boolean to 1 or 0, a
 * string through the same parse JavaScript's `Number` does — empty and
 * whitespace to 0, `0x1f` to 31, anything else to NaN. Measured on probe #383,
 * runs 36430453573 and 36431899972, which pin `'' == 0` true, `'  ' == 0` true,
 * `'0x1f' == 31` true, `'abc' == 0` false, `'abc' != 0` true, `'10' > 9` true
 * and `'abc'` false against `<`, `>` and `>=`.
 */
export function toNumber(v: string | number | boolean): number {
  if (typeof v === "number") {
    return v;
  }
  if (typeof v === "boolean") {
    return v ? 1 : 0;
  }
  return Number(v);
}
