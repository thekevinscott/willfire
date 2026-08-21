import type { SourceRef } from "../types.js";

/** Identity of a source as written, before resolution. */
export const sourceKey = (s: SourceRef) => `${s.owner}/${s.repo}@${s.ref}`;
