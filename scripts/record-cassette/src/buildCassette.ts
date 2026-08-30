import type { Cassette, DispatchedCheck } from "../../../tests/fixtures/pinned/cassette.js";

/**
 * Assembles one cassette and stamps it. Everything list-shaped is sorted here,
 * so re-recording an unchanged dispatch produces a diff only where GitHub's
 * behaviour actually moved.
 */
export function buildCassette(parts: Omit<Cassette, "capturedAt">): Cassette {
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
