/**
 * Shared game type definitions used across map renderers and the game page.
 */

export interface TroopAnimation {
  id: string;
  sourceId: string;
  targetId: string;
  color: string;
  units: number;
  unitType?: string | null;
  type: "attack" | "move";
  startTime: number;
  durationMs?: number;
  playerId?: string;
}
