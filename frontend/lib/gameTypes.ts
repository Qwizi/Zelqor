/**
 * Shared game type definitions used across map renderers and the game page.
 */

/**
 * Action Point (AP) costs matching Rust engine defaults.
 * Each action type costs a fixed number of AP.
 */
/**
 * Action Point (AP) costs matching Rust engine defaults.
 * Attack cost is the MAX — actual cost scales with % of units sent:
 *   ≤25% → 1 AP, ≤50% → 2 AP, ≤75% → 3 AP, 100% → 4 AP
 */
export const AP_COSTS = {
  attack: 4,
  move: 1,
  build: 1,
  produce: 0,
  ability: 3,
} as const;

export type ActionType = keyof typeof AP_COSTS;

/** Maximum AP a player can hold at once. */
export const AP_MAX = 15;

/** Calculate dynamic AP cost for attack based on % of units sent. */
export function getAttackApCost(unitPercent: number, maxCost = AP_COSTS.attack): number {
  if (maxCost <= 1) return maxCost;
  if (unitPercent <= 25) return 1;
  if (unitPercent <= 50) return Math.max(2, Math.floor(maxCost / 2));
  if (unitPercent <= 75) return Math.max(3, Math.floor(maxCost * 3 / 4));
  return maxCost;
}

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

// ─── Diplomacy types ──────────────────────────────────────────────────────────

export interface War {
  player_a: string;
  player_b: string;
  started_tick: number;
  aggressor_id: string;
  provinces_changed: ProvinceChange[];
}

export interface ProvinceChange {
  region_id: string;
  from_player_id: string;
  to_player_id: string;
  tick: number;
}

export interface Pact {
  id: string;
  pact_type: string;
  player_a: string;
  player_b: string;
  created_tick: number;
  expires_tick: number | null;
}

export interface DiplomacyProposal {
  id: string;
  proposal_type: string; // "nap" | "peace"
  from_player_id: string;
  to_player_id: string;
  created_tick: number;
  conditions: PeaceConditions | null;
  status: string; // "pending" | "accepted" | "rejected" | "expired"
  rejected_tick: number | null;
  expires_tick: number | null;
}

export interface PeaceConditions {
  condition_type: string; // "status_quo" | "return_provinces"
  provinces_to_return: string[];
}

export interface DiplomacyState {
  wars: War[];
  pacts: Pact[];
  proposals: DiplomacyProposal[];
}
