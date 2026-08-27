import type { PrEventAction } from "../types.js";

export const isPrEventAction = (v: string): v is PrEventAction =>
  v === "opened" || v === "synchronize" || v === "reopened";
