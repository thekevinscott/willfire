/**
 * GitHub cuts a display name over 100 characters to 97 plus `...`. Verified on
 * dirsql PR #1013: the cap applies to the leaf name before any reusable-call
 * prefixing, so it lives here, not on the entry.
 */
export function capDisplayName(name: string): string {
  return name.length > 100 ? `${name.slice(0, 97)}...` : name;
}
