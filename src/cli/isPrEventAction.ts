import { PR_EVENT_ACTIONS, type PrEventAction } from "../types.js";

export const isPrEventAction = (v: string): v is PrEventAction =>
  (PR_EVENT_ACTIONS as readonly string[]).includes(v);
