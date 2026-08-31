import type { E2ECapture, DispatchedCheck } from "../../../tests/fixtures/pinned/capture.js";

/**
 * Assembles one capture and stamps it. Everything list-shaped is sorted here,
 * so re-recording an unchanged dispatch produces a diff only where GitHub's
 * behaviour actually moved.
 */
export function buildCapture(parts: Omit<E2ECapture, "capturedAt">): E2ECapture {
  const byName = (a: DispatchedCheck, b: DispatchedCheck) =>
    `${a.workflow} :: ${a.name}`.localeCompare(`${b.workflow} :: ${b.name}`);
  const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);
  return {
    ...parts,
    capturedAt: new Date().toISOString(),
    dispatched: [...parts.dispatched].sort(byName),
    recording: {
      api: [...parts.recording.api].sort(byKey),
      exec: [...parts.recording.exec].sort(byKey),
    },
  };
}
