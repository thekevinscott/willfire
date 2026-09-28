/**
 * Every expression an `if:` evaluates: the `${{ }}` bodies when it has any,
 * otherwise the bare value, which GitHub reads as one expression.
 */
export const ifExpressions = (raw: string): string[] => {
  const wrapped = [...raw.matchAll(/\$\{\{(.*?)\}\}/gs)].map((m) => m[1]);
  return wrapped.length > 0 ? wrapped : [raw];
};
