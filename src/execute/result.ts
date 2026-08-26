export type Res<T> = { ok: true; v: T } | { ok: false; reason: string };

export const err = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
