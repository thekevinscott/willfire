import type { E2ECapture, DispatchedCheck } from "../../../tests/fixtures/pinned/capture.js";

/**
 * Assembles one capture. `dispatched` is sorted here, so re-recording an
 * unchanged dispatch produces a diff only where GitHub's behaviour moved.
 */
export function buildCapture(parts: E2ECapture): E2ECapture {
  const byName = (a: DispatchedCheck, b: DispatchedCheck) =>
    `${a.workflow} :: ${a.name}`.localeCompare(`${b.workflow} :: ${b.name}`);
  return { ...parts, dispatched: [...parts.dispatched].sort(byName) };
}
