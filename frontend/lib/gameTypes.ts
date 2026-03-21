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
  /**
   * Bomber flight: ordered province centroids [x,y] along the bombing corridor.
   * Each centroid is a bombing point — the bomber drops bombs as it passes over.
   */
  bombingWaypoints?: [number, number][];
  /** Total province hops for the bombing run (= flight_path.length). */
  totalHops?: number;
  /** Perpendicular offset in pixels from the path (for escorts flying beside bomber). */
  pathOffset?: number;
}

export interface PlannedMove {
  id: string;
  sourceId: string;
  targetId: string;
  unitType: string;
  unitCount: number;
  actionType: "attack" | "move" | "bombard";
  /** Timestamp when this move was planned — expires after PLAN_EXPIRY_MS. */
  createdAt: number;
}

/** Max planned moves in the queue. */
export const MAX_PLANNED_MOVES = 6;
/** Planned moves expire after this many seconds. */
export const PLAN_EXPIRY_S = 30;
