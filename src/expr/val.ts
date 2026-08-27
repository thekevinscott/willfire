export type Val =
  | { kind: "value"; v: string | number | boolean }
  | { kind: "json"; v: unknown[] | Record<string, unknown> }
  | { kind: "truthy" }
  | { kind: "falsy" }
  | { kind: "unknown" };

export const UNKNOWN: Val = { kind: "unknown" };

export interface Scope {
  inputs?: Record<string, Val>;
  github?: Record<string, string>;
  needs?: Record<string, { outputs: Record<string, string> }>;
  steps?: Record<string, { outputs: Record<string, string> }>;
}
