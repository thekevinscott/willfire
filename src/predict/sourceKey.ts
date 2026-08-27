import type { SourceRef } from "../types.js";

export const sourceKey = (s: SourceRef) => `${s.owner}/${s.repo}@${s.ref}`;
