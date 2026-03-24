// ── Path computation functions for Pixi.js animations ────────────────────────
// Pure math — no Pixi.js dependencies. Extracted from pixiAnimations.ts.

export type AnimKind = "fighter" | "ship" | "tank" | "infantry";

/**
 * Compute a quadratic Bézier curve between `from` and `to`.
 * The control point is offset perpendicular to the chord by `offsetFactor * dist`.
 */
export function computeCurvePath(
  from: [number, number],
  to: [number, number],
  offsetFactor: number,
  n: number,
): [number, number][] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return [from, to];

  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const offset = dist * offsetFactor;
  const nx = -dy / dist;
  const ny = dx / dist;
  const cpx = mx + nx * offset;
  const cpy = my + ny * offset;

  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([u * u * from[0] + 2 * u * t * cpx + t * t * to[0], u * u * from[1] + 2 * u * t * cpy + t * t * to[1]]);
  }
  return pts;
}

/**
 * Compute a sinusoidal march path between `from` and `to`.
 * Produces a gentle wave pattern suited for infantry movement.
 */
export function computeMarchPath(from: [number, number], to: [number, number], n = 28): [number, number][] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return [from, to];

  const nx = -dy / dist;
  const ny = dx / dist;
  const wobble = Math.min(dist * 0.035, 1.4);
  const pts: [number, number][] = [];

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const wave = Math.sin(t * Math.PI * 3) * wobble * (1 - Math.abs(0.5 - t) * 1.15);
    pts.push([from[0] + dx * t + nx * wave, from[1] + dy * t + ny * wave]);
  }

  return pts;
}

/**
 * Build a smooth path through province centroid waypoints.
 * Interpolates linearly between waypoints with extra points for smoothness.
 */
export function buildWaypointPath(waypoints: [number, number][]): [number, number][] {
  if (waypoints.length < 2) return waypoints;
  const path: [number, number][] = [];
  const POINTS_PER_SEGMENT = 20;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [x0, y0] = waypoints[i];
    const [x1, y1] = waypoints[i + 1];
    for (let j = 0; j < POINTS_PER_SEGMENT; j++) {
      const t = j / POINTS_PER_SEGMENT;
      path.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }
  path.push(waypoints[waypoints.length - 1]);
  return path;
}

/**
 * Build a bomber flight path through province centroids with smooth dipping arcs.
 */
export function buildBomberFlightPath(waypoints: [number, number][]): [number, number][] {
  if (waypoints.length < 2) return waypoints;
  const path: [number, number][] = [];
  const POINTS_PER_SEGMENT = 30;
  const ALTITUDE_FRACTION = 0.12;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const [x0, y0] = waypoints[i];
    const [x1, y1] = waypoints[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nx = dist > 0.001 ? -dy / dist : 0;
    const ny = dist > 0.001 ? dx / dist : 0;
    const altitude = dist * ALTITUDE_FRACTION;

    for (let j = 0; j < POINTS_PER_SEGMENT; j++) {
      const t = j / POINTS_PER_SEGMENT;
      const alt = Math.sin(t * Math.PI) * altitude;
      path.push([x0 + dx * t + nx * alt, y0 + dy * t + ny * alt]);
    }
  }
  path.push(waypoints[waypoints.length - 1]);
  return path;
}

export function buildAnimationPath(
  kind: AnimKind,
  from: [number, number],
  to: [number, number],
  unitType?: string | null,
  actionType?: "attack" | "move",
): [number, number][] {
  if (unitType === "nuke_rocket") return computeCurvePath(from, to, 0.35, 200);
  if (unitType === "bomber") return computeCurvePath(from, to, 0.28, 60);
  if (unitType === "submarine") return computeCurvePath(from, to, 0.04, 34);
  if (unitType === "artillery") return computeCurvePath(from, to, 0.55, 40);
  if (unitType === "commando") return computeMarchPath(from, to, 26);
  if (unitType === "sam") return computeCurvePath(from, to, 0.65, 30);
  if (kind === "fighter") {
    if (actionType === "attack") return computeFighterAttackPath(from, to);
    return computeCurvePath(from, to, 0.24, 52);
  }
  if (kind === "ship") return computeCurvePath(from, to, 0.04, 34);
  if (kind === "tank") return computeCurvePath(from, to, 0.08, 26);
  return computeMarchPath(from, to, 26);
}

/**
 * Compute a fighter attack path with three phases:
 *   Phase 1 (0–40%):  curved approach toward target vicinity
 *   Phase 2 (40–80%): tight orbiting circles around the target
 *   Phase 3 (80–100%): straight dive to target
 */
export function computeFighterAttackPath(from: [number, number], to: [number, number]): [number, number][] {
  const points: [number, number][] = [];
  const totalPoints = 80;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return [from, to];

  const perpX = -dy / dist;
  const perpY = dx / dist;
  const circleRadius = Math.max(dist * 0.12, 8);
  const centerX = to[0] - dx * 0.1;
  const centerY = to[1] - dy * 0.1;

  const circleStartAngle = 0;

  for (let i = 0; i <= totalPoints; i++) {
    const t = i / totalPoints;
    let x: number, y: number;

    if (t < 0.4) {
      const st = t / 0.4;
      const entryX = centerX + Math.cos(circleStartAngle) * circleRadius;
      const entryY = centerY + Math.sin(circleStartAngle) * circleRadius;
      const midX = (from[0] + entryX) / 2 + perpX * dist * 0.15;
      const midY = (from[1] + entryY) / 2 + perpY * dist * 0.15;
      const u = 1 - st;
      x = u * u * from[0] + 2 * u * st * midX + st * st * entryX;
      y = u * u * from[1] + 2 * u * st * midY + st * st * entryY;
    } else if (t < 0.8) {
      const ct = (t - 0.4) / 0.4;
      const angle = circleStartAngle + ct * Math.PI * 4;
      x = centerX + Math.cos(angle) * circleRadius;
      y = centerY + Math.sin(angle) * circleRadius;
    } else {
      const dt = (t - 0.8) / 0.2;
      const exitAngle = circleStartAngle + Math.PI * 4;
      const exitX = centerX + Math.cos(exitAngle) * circleRadius;
      const exitY = centerY + Math.sin(exitAngle) * circleRadius;
      x = exitX + (to[0] - exitX) * dt;
      y = exitY + (to[1] - exitY) * dt;
    }

    points.push([x, y]);
  }
  return points;
}

/**
 * Apply a per-kind easing curve to a linear [0,1] progress value.
 */
export function easeAnimationProgress(kind: AnimKind, linearProgress: number): number {
  const t = Math.max(0, Math.min(1, linearProgress));
  if (kind === "fighter") return 1 - (1 - t) ** 2.2;
  if (kind === "ship") return t * t * (3 - 2 * t);
  if (kind === "tank") return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  return t * t * (3 - 2 * t);
}

/**
 * Linearly interpolate a position along a path at fractional progress [0,1].
 */
export function lerpPath(path: [number, number][], t: number): [number, number] {
  const n = path.length - 1;
  if (n <= 0) return path[0];
  const f = Math.max(0, Math.min(1, t)) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const frac = f - i;
  return [path[i][0] + (path[i + 1][0] - path[i][0]) * frac, path[i][1] + (path[i + 1][1] - path[i][1]) * frac];
}
