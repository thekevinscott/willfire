/**
 * GitHub caps a job's display name at 100 characters: anything longer is cut
 * to 97 and ellipsised. Verified against a live dispatch (dirsql PR #1013,
 * whose matrix legs overflow): every long leaf arrives as exactly 100
 * characters ending in `...`, while the full check name — reusable-call
 * prefix included — runs longer. So the cap applies to the leaf display name
 * before prefixing, which is why it lives here and not on the finished entry.
 */
export function capDisplayName(name: string): string {
  return name.length > 100 ? `${name.slice(0, 97)}...` : name;
}
