/**
 * Shared game type definitions used across map renderers and the game page.
 */

export interface TroopAnimation {
  id: string;
  sourceId: string;
  targetId: string;
  color: string;
  units: number;
  /** Actual unit count to display (e.g. "4 bombers"). Falls back to units if not set. */
  unitCount?: number;
  unitType?: string | null;
  type: "attack" | "move";
  startTime: number;
  durationMs?: number;
  playerId?: string;
  /** Multi-point path as [x,y] waypoints. If set, animation follows this path instead of straight line. */
  waypoints?: [number, number][];
}
