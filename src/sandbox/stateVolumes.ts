/**
 * The two named volumes carrying one job's machine state between its step
 * containers: `/usr/local` (global tool installs) and `/tmp` (HOME).
 */
export interface StateVolumes {
  usr: string;
  tmp: string;
}

export function stateVolumes(stateKey: string): StateVolumes {
  return {
    usr: `willfire-state-${stateKey}-usr`,
    tmp: `willfire-state-${stateKey}-tmp`,
  };
}
