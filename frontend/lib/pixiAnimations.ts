// ── Pixi.js Animation System ──────────────────────────────────────────────────
//
// Standalone module that manages all game unit animations in a Pixi.js
// Container. Replaces the MapLibre GL GeoJSON-based animation loop from
// GameMap.tsx. Add `manager.container` to your Pixi Viewport and call
// `manager.update(Date.now())` from your Ticker.

import { Container, Graphics, Text, TextStyle, Assets, Sprite, Texture } from "pixi.js";
import type { TroopAnimation } from "@/lib/gameTypes";
import {
  resolveAnimConfig,
  ANIMATION_DEFAULTS_KEYS,
  type AnimationConfig,
  type CosmeticValue,
  type ImpactConfig,
  type PulseConfig,
} from "@/lib/animationConfig";
import {
  ParticleManager as PixiParticleManager,
  ParticleEmitter,
  ParticlePresets,
} from "@/lib/particleSystem";

// ── Texture cache ────────────────────────────────────────────────────────────
// Deduplicate concurrent Assets.load() calls for the same URL so that 100
// animations of the same unit type share a single in-flight Promise.
const _textureCache = new Map<string, Promise<Texture>>();
function loadTextureCached(url: string): Promise<Texture> {
  let p = _textureCache.get(url);
  if (!p) {
    p = Assets.load<Texture>(url);
    _textureCache.set(url, p);
  }
  return p;
}

// ── AnimKind type ────────────────────────────────────────────────────────────

export type AnimKind = "fighter" | "ship" | "tank" | "infantry";

// ── Duration map (mirrors GameMap.tsx) ───────────────────────────────────────

const DURATION_MAP: Record<AnimKind, number> = {
  fighter: 1100,
  ship: 3200,
  tank: 2400,
  infantry: 1900,
};

const EXTRA_DURATION_MAP: Record<string, number> = {
  bomber: 6000,
  submarine: 3500,
  artillery: 2000,
  commando: 1500,
  sam: 2400,
};

// ── Internal structs ─────────────────────────────────────────────────────────

interface InternalAnim {
  id: string;
  path: [number, number][];
  color: string;
  colorNum: number;
  units: number;
  unitType?: string | null;
  actionType: "attack" | "move";
  animKind: AnimKind;
  startTime: number;
  duration: number;
  targetCentroid: [number, number];
  sourceCentroid: [number, number];
  config: AnimationConfig;
  playerId?: string;

  // Pixi display objects
  trailGfx: Graphics;
  dotsGfx: Graphics;
  iconGfx: Graphics;
  iconSprite: Sprite | null;
  labelText: Text;

  // Bomber waypoint bombing: centroids along the flight corridor
  bombingWaypoints: [number, number][];
  totalHops: number;
  /** Last hop index that was visually bombed (matches engine's last_bombed_hop). */
  lastBombedHop: number;
}

interface ImpactFlash {
  id: string;
  centroid: [number, number];
  startTime: number;
  duration: number;
  config: ImpactConfig;
  gfx: Graphics;
}

interface PulseRing {
  animId: string;
  centroid: [number, number];
  startTime: number;
  config: PulseConfig;
  gfx: Graphics;
}

interface BombDrop {
  /** World-space x position where the bomb was released. */
  x: number;
  /** World-space y position where the bomb was released. */
  y: number;
  startTime: number;
  /** Total fall duration in ms. */
  duration: number;
  startY: number;
  /** Y position after fully falling (falls ~40px downward in world space). */
  endY: number;
  /** Main bomb circle + trail. */
  gfx: Graphics;
  /** Expanding explosion circle rendered at impact point. */
  impactGfx: Graphics;
  /** Whether the impact explosion has been triggered. */
  impacted: boolean;
  impactStartTime: number;
}

// ── Colour helper ────────────────────────────────────────────────────────────

/**
 * Parse a CSS hex color string (#rrggbb or #rgb) into a Pixi numeric color
 * (0xRRGGBB). Falls back to white on parse failure.
 */
function hexToNum(hex: string | null | undefined): number {
  if (!hex) return 0xffffff;
  const clean = hex.replace("#", "");
  if (!clean) return 0xffffff;
  const expanded =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const n = parseInt(expanded, 16);
  return isNaN(n) || n > 0xffffff ? 0xffffff : n;
}

// ── Path helpers (ported from GameMap.tsx) ────────────────────────────────────

/**
 * Compute a quadratic Bézier curve between `from` and `to`.
 * The control point is offset perpendicular to the chord by `offsetFactor * dist`.
 */
export function computeCurvePath(
  from: [number, number],
  to: [number, number],
  offsetFactor: number,
  n: number
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
    pts.push([
      u * u * from[0] + 2 * u * t * cpx + t * t * to[0],
      u * u * from[1] + 2 * u * t * cpy + t * t * to[1],
    ]);
  }
  return pts;
}

/**
 * Compute a sinusoidal march path between `from` and `to`.
 * Produces a gentle wave pattern suited for infantry movement.
 */
export function computeMarchPath(
  from: [number, number],
  to: [number, number],
  n = 28
): [number, number][] {
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
    const wave =
      Math.sin(t * Math.PI * 3) * wobble * (1 - Math.abs(0.5 - t) * 1.15);
    pts.push([from[0] + dx * t + nx * wave, from[1] + dy * t + ny * wave]);
  }

  return pts;
}

/**
 * Select path shape and resolution for a given animation kind / unit type.
 * Pass `actionType` to enable fighter circling on attack animations.
 */
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
 * Between each pair of waypoints, the path rises slightly (cruise altitude) then
 * dips back down to the next centroid (bombing dive), creating a smooth wavelike
 * flight trajectory that communicates "bombing run" visually.
 */
export function buildBomberFlightPath(waypoints: [number, number][]): [number, number][] {
  if (waypoints.length < 2) return waypoints;
  const path: [number, number][] = [];
  const POINTS_PER_SEGMENT = 30;
  // Altitude offset: bomber rises perpendicular to travel direction between waypoints.
  const ALTITUDE_FRACTION = 0.12; // How high the arc goes relative to segment distance.

  for (let i = 0; i < waypoints.length - 1; i++) {
    const [x0, y0] = waypoints[i];
    const [x1, y1] = waypoints[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Perpendicular direction for altitude offset
    const nx = dist > 0.001 ? -dy / dist : 0;
    const ny = dist > 0.001 ? dx / dist : 0;
    const altitude = dist * ALTITUDE_FRACTION;

    for (let j = 0; j < POINTS_PER_SEGMENT; j++) {
      const t = j / POINTS_PER_SEGMENT;
      // Smooth altitude: sine wave — rises in the middle, touches ground at endpoints.
      const alt = Math.sin(t * Math.PI) * altitude;
      path.push([
        x0 + dx * t + nx * alt,
        y0 + dy * t + ny * alt,
      ]);
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
  actionType?: "attack" | "move"
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
export function computeFighterAttackPath(
  from: [number, number],
  to: [number, number]
): [number, number][] {
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

  // The starting angle of the circle phase matches where the approach arc ends,
  // so we compute that once and reuse it in both phase 2 and the dive start.
  // We place the approach endpoint on the circle at angle 0 (positive-x side).
  const circleStartAngle = 0;

  for (let i = 0; i <= totalPoints; i++) {
    const t = i / totalPoints;
    let x: number, y: number;

    if (t < 0.4) {
      // Phase 1: approach — smooth curve from source to circle entry point
      const st = t / 0.4;
      const entryX = centerX + Math.cos(circleStartAngle) * circleRadius;
      const entryY = centerY + Math.sin(circleStartAngle) * circleRadius;
      // Quadratic Bézier: from → (mid + perp curve) → entry
      const midX = (from[0] + entryX) / 2 + perpX * dist * 0.15;
      const midY = (from[1] + entryY) / 2 + perpY * dist * 0.15;
      const u = 1 - st;
      x = u * u * from[0] + 2 * u * st * midX + st * st * entryX;
      y = u * u * from[1] + 2 * u * st * midY + st * st * entryY;
    } else if (t < 0.8) {
      // Phase 2: 2 full orbits around the target center
      const ct = (t - 0.4) / 0.4;
      const angle = circleStartAngle + ct * Math.PI * 4;
      x = centerX + Math.cos(angle) * circleRadius;
      y = centerY + Math.sin(angle) * circleRadius;
    } else {
      // Phase 3: dive straight to target from orbit exit point
      const dt = (t - 0.8) / 0.2;
      const exitAngle = circleStartAngle + Math.PI * 4; // same as end of phase 2
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
export function easeAnimationProgress(
  kind: AnimKind,
  linearProgress: number
): number {
  const t = Math.max(0, Math.min(1, linearProgress));
  if (kind === "fighter") return 1 - Math.pow(1 - t, 2.2);
  if (kind === "ship") return t * t * (3 - 2 * t);
  if (kind === "tank")
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  // infantry / default: smooth-step
  return t * t * (3 - 2 * t);
}

/**
 * Linearly interpolate a position along a path at fractional progress [0,1].
 */
export function lerpPath(
  path: [number, number][],
  t: number
): [number, number] {
  const n = path.length - 1;
  if (n <= 0) return path[0];
  const f = Math.max(0, Math.min(1, t)) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const frac = f - i;
  return [
    path[i][0] + (path[i + 1][0] - path[i][0]) * frac,
    path[i][1] + (path[i + 1][1] - path[i][1]) * frac,
  ];
}

// ── AnimKind resolution (mirrors GameMap.tsx resolveAnimationKind) ────────────

// Unit icon sprite URLs per animation kind
const UNIT_ICON_MAP: Record<string, string> = {
  fighter: "/assets/units/svg/fighter.svg",
  bomber: "/assets/units/svg/bomber.svg",
  ship: "/assets/units/svg/ship.svg",
  tank: "/assets/units/svg/tank.svg",
  infantry: "/assets/units/svg/infantry.svg",
  nuke_rocket: "/assets/units/svg/nuke.svg",
  commando: "/assets/units/svg/commando.svg",
  artillery: "/assets/units/svg/artillery.svg",
  sam: "/assets/units/svg/sam.svg",
  submarine: "/assets/units/svg/submarine.svg",
};

// Minimal asset path constants — only needed for unit kind disambiguation.
const AIR_ASSET = "/assets/units/planes/bomber_h300.webp";
const SHIP_ASSET = "/assets/units/ships/ship1.png";
const TANK_ASSET = "/assets/units/ground_unit_sphere_h300.png";

/**
 * Synchronous unit kind resolution using asset-path heuristics and name
 * matching. Accurate enough for animation setup without an async import.
 * When gameAssets is available (client-side), `resolveAnimationKindAsync`
 * should be preferred for new animations.
 */
function resolveAnimationKindSync(unitType?: string | null): AnimKind {
  if (unitType === "nuke_rocket") return "fighter";
  if (!unitType || unitType === "default") return "infantry";
  const ut = unitType.toLowerCase();
  if (ut.includes("plane") || ut.includes("fighter") || ut.includes("bomber"))
    return "fighter";
  if (ut.includes("ship") || ut.includes("submarine") || ut.includes("naval"))
    return "ship";
  if (ut.includes("tank") || ut.includes("armor") || ut.includes("vehicle"))
    return "tank";
  return "infantry";
}

/**
 * Async unit kind resolution using the actual asset map from gameAssets.
 * Fires a background import and resolves once the module is loaded.
 * Returns a cached kind immediately via the synchronous fallback while
 * waiting for the async result.
 */
async function resolveAnimationKindAsync(
  unitType?: string | null
): Promise<AnimKind> {
  if (unitType === "nuke_rocket") return "fighter";
  try {
    const { getUnitAsset } = await import("@/lib/gameAssets");
    const asset = getUnitAsset(unitType ?? "default");
    if (asset === AIR_ASSET) return "fighter";
    if (asset === SHIP_ASSET) return "ship";
    if (asset === TANK_ASSET) return "tank";
  } catch {
    // gameAssets not available — fall through to infantry
  }
  return "infantry";
}

// ── PixiAnimationManager ─────────────────────────────────────────────────────

/**
 * Manages all active troop animations rendered via Pixi.js primitives.
 *
 * Usage:
 * ```ts
 * const manager = new PixiAnimationManager();
 * viewport.addChild(manager.container);
 *
 * app.ticker.add(() => manager.update(Date.now()));
 *
 * // On game event:
 * manager.addAnimation(troopAnim, sourceCentroid, targetCentroid, cosmetics);
 *
 * // On unmount:
 * manager.destroy();
 * ```
 */
export class PixiAnimationManager {
  /** Parent container — add this to the Pixi Viewport. */
  readonly container: Container;

  private readonly anims: Map<string, InternalAnim> = new Map();
  private readonly impacts: Map<string, ImpactFlash> = new Map();
  private readonly pulseRings: Map<string, PulseRing> = new Map();

  // Active bomb drops spawned by bomber animations
  private readonly _bombs: BombDrop[] = [];

  // Track which anim IDs have already triggered their arrival flash.
  private readonly arrived: Set<string> = new Set();

  private readonly labelStyle: TextStyle;

  /** Sprite-based particle manager for combat VFX (explosions, sparks, smoke). */
  private readonly _particles: PixiParticleManager;
  private readonly _particleContainer: Container;
  private _particleIdCounter = 0;
  private _lastUpdateTime = 0;
  private _gcFrameCounter = 0;

  constructor() {
    this.container = new Container();
    this.container.label = "PixiAnimationManager";

    // Particle VFX container sits above bomb graphics
    this._particleContainer = new Container();
    this._particleContainer.label = "ParticleVFX";
    this._particleContainer.eventMode = "none";
    this.container.addChild(this._particleContainer);
    this._particles = new PixiParticleManager();

    this.labelStyle = new TextStyle({
      fontSize: 13,
      fontFamily: "Rajdhani, sans-serif",
      fontWeight: "bold",
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 2 },
      align: "center",
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Register a new troop animation.
   *
   * @param anim            TroopAnimation from the game state.
   * @param sourceCentroid  [x, y] in Pixi world units.
   * @param targetCentroid  [x, y] in Pixi world units.
   * @param playerCosmetics Optional cosmetic overrides for the owning player.
   */
  addAnimation(
    anim: TroopAnimation,
    sourceCentroid: [number, number],
    targetCentroid: [number, number],
    playerCosmetics?: Record<string, CosmeticValue>
  ): void {
    if (this.anims.has(anim.id)) return;

    const isNuke = anim.unitType === "nuke_rocket";
    const hasBomberPath = (anim.bombingWaypoints?.length ?? 0) >= 2;
    const isBomber = anim.unitType === "bomber" && hasBomberPath;
    const isEscort = anim.unitType !== "bomber" && hasBomberPath; // fighter escort with bomber path
    const animKind = resolveAnimationKindSync(anim.unitType);
    // Bombers and their escorts fly through province centroids with dip-dive curves.
    // Other units use standard path logic.
    let path = (isBomber || isEscort)
      ? buildBomberFlightPath(anim.bombingWaypoints!)
      : anim.waypoints && anim.waypoints.length >= 2
        ? buildWaypointPath(anim.waypoints)
        : buildAnimationPath(
            animKind,
            sourceCentroid,
            targetCentroid,
            anim.unitType,
            anim.type
          );
    // Apply perpendicular offset for escorts flying beside bomber.
    if (anim.pathOffset && anim.pathOffset !== 0 && path.length >= 2) {
      const offset = anim.pathOffset;
      path = path.map((pt, i) => {
        const next = path[Math.min(i + 1, path.length - 1)];
        const prev = path[Math.max(i - 1, 0)];
        const dx = next[0] - prev[0];
        const dy = next[1] - prev[1];
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) return pt;
        // Perpendicular direction
        const nx = -dy / len;
        const ny = dx / len;
        return [pt[0] + nx * offset, pt[1] + ny * offset] as [number, number];
      });
    }

    const duration =
      anim.durationMs ??
      (isNuke ? 8000 : (EXTRA_DURATION_MAP[anim.unitType ?? ""] ?? DURATION_MAP[animKind] ?? DURATION_MAP.infantry));
    // For unit types with their own config entry (e.g. "bomber"), prefer that
    // entry over the generic animKind default so distinct configs take effect.
    const configKey =
      anim.unitType && ANIMATION_DEFAULTS_KEYS.has(anim.unitType)
        ? anim.unitType
        : animKind;
    const config = resolveAnimConfig(
      configKey,
      anim.type,
      isNuke,
      playerCosmetics
    );

    // Fire the async kind resolution in the background. The result is not
    // needed for the current animation but warms up the module cache.
    resolveAnimationKindAsync(anim.unitType).catch(() => undefined);

    const colorNum = hexToNum(anim.color);

    // Create dedicated Graphics objects per animation so each can be cleared
    // and redrawn independently every frame without affecting others.
    const trailGfx = new Graphics();
    const dotsGfx = new Graphics();
    const iconGfx = new Graphics();

    const labelText = new Text({
      text: String(anim.unitCount ?? anim.units),
      style: this.labelStyle,
      resolution: 3,
    });
    labelText.anchor.set(0.5, 0.5);

    this.container.addChild(trailGfx, dotsGfx, iconGfx, labelText);

    const internal: InternalAnim = {
      id: anim.id,
      path,
      color: anim.color,
      colorNum,
      units: anim.units,
      unitType: anim.unitType,
      actionType: anim.type,
      animKind,
      startTime: anim.startTime,
      duration,
      targetCentroid,
      sourceCentroid,
      config,
      playerId: anim.playerId,
      trailGfx,
      dotsGfx,
      iconGfx,
      iconSprite: null,
      labelText,
      bombingWaypoints: anim.bombingWaypoints ?? [],
      totalHops: anim.totalHops ?? 0,
      lastBombedHop: 0,
    };

    this.anims.set(anim.id, internal);

    // Load unit sprite asynchronously (not needed for artillery rockets)
    if (anim.unitType !== "artillery") {
      const spriteUrl = UNIT_ICON_MAP[anim.unitType ?? ""] ?? UNIT_ICON_MAP[animKind];
      if (spriteUrl) {
        loadTextureCached(spriteUrl).then((texture: Texture) => {
          if (!this.anims.has(anim.id)) return;
          const sprite = new Sprite(texture);
          sprite.anchor.set(0.5, 0.5);
          sprite.eventMode = "none";
          sprite.visible = false;
          this.container.addChild(sprite);
          internal.iconSprite = sprite;
        }).catch(() => {});
      }
    }

    // Artillery: muzzle flash + smoke at launch position
    if (anim.unitType === "artillery") {
      const [sx, sy] = sourceCentroid;
      this._particles.addEmitter(
        `art-muzzle-${this._particleIdCounter++}`,
        new ParticleEmitter(this._particleContainer, ParticlePresets.artilleryMuzzle(sx, sy))
      );
    }
  }

  /**
   * Spawn a one-shot particle effect at a world position.
   * Useful for external triggers (shield hit, province capture, etc.).
   */
  spawnParticleEffect(
    preset: "explosion" | "sparks" | "smokeTrail" | "nukeMushroom",
    x: number,
    y: number
  ): void {
    const id = `fx-${preset}-${this._particleIdCounter++}`;
    const config =
      preset === "explosion"
        ? ParticlePresets.explosion(x, y)
        : preset === "sparks"
          ? ParticlePresets.sparks(x, y)
          : preset === "smokeTrail"
            ? ParticlePresets.smokeTrail(x, y)
            : ParticlePresets.nukeMushroom(x, y);
    this._particles.addEmitter(id, new ParticleEmitter(this._particleContainer, config));
  }

  /**
   * Spawn a persistent (infinite) particle effect, like capital glow.
   * Returns the id so the caller can remove it later.
   */
  spawnPersistentEffect(
    preset: "capitalGlow" | "shieldShimmer",
    x: number,
    y: number,
    color: number
  ): string {
    const id = `persist-${preset}-${this._particleIdCounter++}`;
    const config =
      preset === "capitalGlow"
        ? ParticlePresets.capitalGlow(x, y, color)
        : ParticlePresets.shieldShimmer(x, y, color);
    this._particles.addEmitter(id, new ParticleEmitter(this._particleContainer, config));
    return id;
  }

  /** Remove a persistent particle effect by id. */
  removeParticleEffect(id: string): void {
    this._particles.removeEmitter(id);
  }

  /** Remove an animation mid-flight (e.g. SAM intercept kills a rocket). */
  removeAnimation(animId: string): void {
    const a = this.anims.get(animId);
    if (a) {
      this._removeAnimGraphics(a);
      this.anims.delete(animId);
      this._removePulseRing(animId);
    }
  }

  /**
   * Update the unit count label on an active animation (e.g. bomber losing units).
   */
  updateAnimationLabel(animId: string, newCount: number): void {
    const a = this.anims.get(animId);
    if (!a) return;
    a.units = newCount;
    a.labelText.text = String(newCount);
  }

  /**
   * Called every frame by the Pixi Ticker (or any rAF loop).
   *
   * @param now  Current timestamp in milliseconds (e.g. `Date.now()`).
   */
  update(now: number): void {
    this._updateAnims(now);
    this._updateBombs(now);
    this._updateImpacts(now);
    // Particle system uses delta-seconds
    const dt = this._lastUpdateTime > 0
      ? Math.min((now - this._lastUpdateTime) / 1000, 0.1) // cap at 100ms to avoid burst
      : 1 / 60;
    this._lastUpdateTime = now;
    this._particles.update(dt);
    // Throttle GC to every 30 frames (~500ms at 60fps) to reduce per-frame overhead
    if (++this._gcFrameCounter >= 30) {
      this._gcFrameCounter = 0;
      this._gc(now);
    }
  }

  /** Remove all display objects and free memory. */
  destroy(): void {
    for (const a of this.anims.values()) this._removeAnimGraphics(a);
    this.anims.clear();

    for (const f of this.impacts.values()) {
      f.gfx.destroy();
      this.container.removeChild(f.gfx);
    }
    this.impacts.clear();

    for (const p of this.pulseRings.values()) {
      p.gfx.destroy();
      this.container.removeChild(p.gfx);
    }
    this.pulseRings.clear();

    for (const bomb of this._bombs) {
      bomb.gfx.destroy();
      bomb.impactGfx.destroy();
      this.container.removeChild(bomb.gfx);
      this.container.removeChild(bomb.impactGfx);
    }
    this._bombs.length = 0;

    this.arrived.clear();
    this._particles.cleanup();
    this._particleContainer.destroy({ children: true });
    this.container.destroy({ children: true });
  }

  // ── Internal: animation update ─────────────────────────────────────────────

  private _updateAnims(now: number): void {
    for (const a of this.anims.values()) {
      const rawLinear = Math.min((now - a.startTime) / a.duration, 1);
      const isNuke = a.unitType === "nuke_rocket";

      // ── Progress / easing ────────────────────────────────────────────────
      const progress = isNuke
        ? rawLinear < 0.5
          ? 2 * rawLinear * rawLinear
          : 1 - Math.pow(-2 * rawLinear + 2, 2) / 2
        : easeAnimationProgress(a.animKind, rawLinear);

      // ── Fade-out ─────────────────────────────────────────────────────────
      const fadeOut = isNuke
        ? rawLinear >= 1
          ? 0
          : 1
        : rawLinear > a.config.icon.fade_start
          ? Math.pow(
              1 -
                (rawLinear - a.config.icon.fade_start) /
                  (1 - a.config.icon.fade_start),
              2
            )
          : 1;

      // ── Trail colors ──────────────────────────────────────────────────────
      const trailColor = a.config.trail.color ?? a.color;
      const trailColorNum = hexToNum(trailColor);
      const dotColor = a.config.trail.particle_color ?? trailColor;
      const dotColorNum = hexToNum(dotColor);

      // ── Trail indices ─────────────────────────────────────────────────────
      const pathLen = a.path.length;
      const headIdx = Math.min(
        Math.floor(progress * (pathLen - 1)),
        pathLen - 1
      );
      const trailLength = a.config.trail.length;
      const tailProgress = Math.max(0, progress - trailLength);
      const tailIdx = Math.max(0, Math.floor(tailProgress * (pathLen - 1)));

      // ── Trail line ────────────────────────────────────────────────────────
      if (a.unitType === "artillery" || a.unitType === "sam") {
        // Artillery/SAM rocket: fiery smoke trail
        this._drawArtilleryTrail(a, tailIdx, headIdx, fadeOut);
      } else {
        this._drawTrail(a, trailColorNum, tailIdx, headIdx, fadeOut);
      }

      // ── Trail particles ───────────────────────────────────────────────────
      if (a.unitType !== "artillery" && a.unitType !== "sam") {
        this._drawParticles(
          a,
          dotColorNum,
          progress,
          tailProgress,
          isNuke,
          fadeOut
        );
      }

      // ── Unit icon ─────────────────────────────────────────────────────────
      const isArtillery = a.unitType === "artillery";
      const isSamRocket = a.unitType === "sam";
      const currentPoint = isNuke
        ? lerpPath(a.path, progress)
        : (isArtillery || isSamRocket)
          ? lerpPath(a.path, progress)
          : a.path[headIdx];

      if (isArtillery || isSamRocket) {
        // Artillery/SAM rockets: projectile with fiery trail, no unit icon/label
        this._drawArtilleryRocket(a, currentPoint, progress, rawLinear, fadeOut);
      } else {
        this._drawIcon(a, currentPoint, rawLinear, progress, isNuke, fadeOut);
      }

      // ── Pulse rings (during approach, attack only) ────────────────────────
      if (
        !isArtillery && !isSamRocket &&
        a.config.pulse.enabled &&
        a.actionType === "attack" &&
        progress > a.config.pulse.start_at
      ) {
        this._upsertPulseRing(a, now, progress, fadeOut);
      } else if (!isArtillery && !isSamRocket) {
        this._removePulseRing(a.id);
      }

      // ── Arrival trigger ───────────────────────────────────────────────────
      if (rawLinear >= 1 && !this.arrived.has(a.id)) {
        this.arrived.add(a.id);
        if (isSamRocket) {
          // SAM rocket: no impact effect — explosion handled by sam-intercept-visual event
        } else if (isArtillery) {
          // Cinematic artillery impact — fireball, debris, smoke column, shockwave
          const [tx, ty] = a.targetCentroid;
          const pc = this._particleContainer;
          const id = () => `art-${this._particleIdCounter++}`;
          // 1. Main fireball explosion (large burst)
          this._particles.addEmitter(id(), new ParticleEmitter(pc, ParticlePresets.artilleryImpact(tx, ty)));
          // 2. Ground debris flying outward
          this._particles.addEmitter(id(), new ParticleEmitter(pc, ParticlePresets.artilleryDebris(tx, ty)));
          // 3. Rising smoke column (lingers for ~3s)
          this._particles.addEmitter(id(), new ParticleEmitter(pc, ParticlePresets.artillerySmoke(tx, ty)));
          // 4. Expanding shockwave ring drawn as Graphics
          this._spawnArtilleryShockwave(tx, ty, now);
        } else {
          this._triggerImpact(a, now);
        }
        // Bomber: big salvo on target province at arrival.
        if (a.unitType === "bomber" && a.bombingWaypoints.length > 0) {
          const target = a.bombingWaypoints[a.bombingWaypoints.length - 1];
          this._spawnBombingSalvo(target[0], target[1], now, true);
        }
        // Nuke: dramatic mushroom cloud particle effect
        if (a.unitType === "nuke_rocket") {
          const [nx, ny] = a.targetCentroid;
          const nukeId = `nuke-${this._particleIdCounter++}`;
          this._particles.addEmitter(
            nukeId,
            new ParticleEmitter(this._particleContainer, ParticlePresets.nukeMushroom(nx, ny))
          );
        }
      }

      // ── Bomber waypoint bombing ─────────────────────────────────────────
      // Bombs are now spawned reactively from engine path_damage events
      // (dispatched via "path-damage-bomb" custom event → GameCanvas handler
      // → spawnBombingSalvoAt). This ensures bombs only fall on provinces
      // that actually take damage (skips own provinces & empty ones).
    }
  }

  // ── Artillery rocket rendering ───────────────────────────────────────────

  /**
   * Draw a cinematic rocket projectile for artillery bombardment.
   * Large rocket with exhaust flame, engine glow, wobble, and smoke.
   */
  private _drawArtilleryRocket(
    a: InternalAnim,
    pos: [number, number],
    progress: number,
    rawLinear: number,
    fadeOut: number
  ): void {
    const g = a.iconGfx;
    g.clear();
    if (a.iconSprite) a.iconSprite.visible = false;

    if (rawLinear >= 1) {
      a.labelText.visible = false;
      return;
    }

    // Show manpower label next to rocket (so enemy sees incoming force)
    if (a.units > 0) {
      a.labelText.visible = true;
      a.labelText.position.set(pos[0] + 12, pos[1] - 12);
      a.labelText.alpha = fadeOut * 0.9;
    } else {
      a.labelText.visible = false;
    }

    // Direction for rotation + slight wobble for realism
    const lookAhead = lerpPath(a.path, Math.min(1, progress + 0.015));
    const dx = lookAhead[0] - pos[0];
    const dy = lookAhead[1] - pos[1];
    const baseRotation = Math.atan2(dx, -dy);
    // Wobble: subtle oscillation that decreases as rocket stabilizes
    const wobble = Math.sin(rawLinear * 40) * 0.06 * (1 - rawLinear);
    const rotation = baseRotation + wobble;

    g.position.set(pos[0], pos[1]);
    g.rotation = rotation;

    const now = Date.now();
    const flicker = 0.85 + Math.sin(now * 0.03) * 0.15; // engine flame flicker

    // ── Exhaust flame (large, layered) ──────────────────────────
    // Outer flame envelope (big, dim orange)
    const flameLen = 14 + Math.sin(now * 0.025) * 3;
    g.moveTo(-3.5, 8)
      .lineTo(0, 8 + flameLen)
      .lineTo(3.5, 8)
      .closePath()
      .fill({ color: 0xff4400, alpha: fadeOut * 0.35 * flicker });

    // Inner flame (bright yellow-white)
    const innerLen = 9 + Math.sin(now * 0.04) * 2;
    g.moveTo(-2, 8)
      .lineTo(0, 8 + innerLen)
      .lineTo(2, 8)
      .closePath()
      .fill({ color: 0xffdd44, alpha: fadeOut * 0.7 * flicker });

    // Hot core
    g.circle(0, 9, 2.5)
      .fill({ color: 0xffffff, alpha: fadeOut * 0.6 * flicker });

    // Engine glow halo
    g.circle(0, 10, 8)
      .fill({ color: 0xff6600, alpha: fadeOut * 0.15 * flicker });

    // ── Rocket body ─────────────────────────────────────────────
    const rocketLen = 16;
    const rocketW = 4;

    // Body (dark metal with gradient feel)
    g.moveTo(0, -rocketLen * 0.55) // nose tip
      .lineTo(-rocketW * 0.6, -rocketLen * 0.25) // nose taper
      .lineTo(-rocketW, rocketLen * 0.15) // body left
      .lineTo(-rocketW, rocketLen * 0.45) // body bottom left
      .lineTo(rocketW, rocketLen * 0.45) // body bottom right
      .lineTo(rocketW, rocketLen * 0.15) // body right
      .lineTo(rocketW * 0.6, -rocketLen * 0.25) // nose taper
      .closePath()
      .fill({ color: 0x778899, alpha: fadeOut * 0.95 })
      .stroke({ color: 0x556677, alpha: fadeOut * 0.5, width: 0.8 });

    // Warhead (red nose cone)
    g.moveTo(0, -rocketLen * 0.55)
      .lineTo(-rocketW * 0.5, -rocketLen * 0.2)
      .lineTo(rocketW * 0.5, -rocketLen * 0.2)
      .closePath()
      .fill({ color: 0xcc2200, alpha: fadeOut * 0.9 });

    // Nose tip glow
    g.circle(0, -rocketLen * 0.5, 2)
      .fill({ color: 0xff4400, alpha: fadeOut * 0.8 });

    // ── Fins (larger, angled) ───────────────────────────────────
    // Left fin
    g.moveTo(-rocketW, rocketLen * 0.25)
      .lineTo(-rocketW - 5, rocketLen * 0.5)
      .lineTo(-rocketW - 2, rocketLen * 0.5)
      .lineTo(-rocketW, rocketLen * 0.4)
      .closePath()
      .fill({ color: 0x993322, alpha: fadeOut * 0.8 });
    // Right fin
    g.moveTo(rocketW, rocketLen * 0.25)
      .lineTo(rocketW + 5, rocketLen * 0.5)
      .lineTo(rocketW + 2, rocketLen * 0.5)
      .lineTo(rocketW, rocketLen * 0.4)
      .closePath()
      .fill({ color: 0x993322, alpha: fadeOut * 0.8 });

    // ── Body stripe (military marking) ──────────────────────────
    g.rect(-rocketW + 0.5, rocketLen * 0.0, (rocketW - 0.5) * 2, 2)
      .fill({ color: 0x445566, alpha: fadeOut * 0.4 });
  }

  /**
   * Cinematic rocket exhaust trail — thick layered smoke with fire core.
   */
  private _drawArtilleryTrail(
    a: InternalAnim,
    tailIdx: number,
    headIdx: number,
    fadeOut: number
  ): void {
    const g = a.trailGfx;
    g.clear();
    if (headIdx - tailIdx < 1) return;

    // Layer 1: Wide dim smoke envelope
    this._strokePath(g, a.path, {
      color: 0x555555,
      alpha: fadeOut * 0.15,
      width: 10,
    }, tailIdx, headIdx);

    // Layer 2: Orange heat glow
    this._strokePath(g, a.path, {
      color: 0xff6600,
      alpha: fadeOut * 0.2,
      width: 6,
    }, tailIdx, headIdx);

    // Layer 3: Bright fire core
    this._strokePath(g, a.path, {
      color: 0xffaa33,
      alpha: fadeOut * 0.45,
      width: 3,
    }, tailIdx, headIdx);

    // Layer 4: White-hot inner core
    this._strokePath(g, a.path, {
      color: 0xffffcc,
      alpha: fadeOut * 0.6,
      width: 1.2,
    }, tailIdx, headIdx);

    // Smoke puffs — expanding, darkening clouds along the trail
    const dotsGfx = a.dotsGfx;
    dotsGfx.clear();
    for (let i = tailIdx; i <= headIdx; i += 3) {
      const pt = a.path[i];
      if (!pt) continue;
      const t = (i - tailIdx) / Math.max(1, headIdx - tailIdx); // 0=tail(old), 1=head(new)
      const age = 1 - t; // 1=old, 0=new

      // Smoke: starts small and bright near rocket, grows and fades behind
      const smokeRadius = 1.5 + age * 7;
      const smokeAlpha = (1 - age * 0.7) * 0.25 * fadeOut;
      // Color shifts: near rocket=light gray, far=dark
      const gray = Math.round(100 - age * 60);
      const smokeColor = (gray << 16) | (gray << 8) | gray;
      dotsGfx.circle(pt[0], pt[1], smokeRadius)
        .fill({ color: smokeColor, alpha: smokeAlpha });

      // Occasional ember sparks near the rocket head
      if (t > 0.7 && i % 6 === 0) {
        dotsGfx.circle(pt[0] + (Math.random() - 0.5) * 6, pt[1] + (Math.random() - 0.5) * 6, 1)
          .fill({ color: 0xffcc00, alpha: fadeOut * 0.6 });
      }
    }
  }

  // ── Trail line ────────────────────────────────────────────────────────────

  private _drawTrail(
    a: InternalAnim,
    colorNum: number,
    tailIdx: number,
    headIdx: number,
    fadeOut: number
  ): void {
    const g = a.trailGfx;
    g.clear();

    if (a.config.trail.line_style === "none") return;
    if (headIdx - tailIdx < 1) return;

    const opacity = a.config.trail.opacity * fadeOut;
    const width = a.config.trail.width * (0.7 + 0.3 * fadeOut);

    // Glow layer (wider, semi-transparent, rendered beneath the main trail)
    if (a.config.trail.glow) {
      const glowColor = a.config.trail.glow_color
        ? hexToNum(a.config.trail.glow_color)
        : colorNum;
      this._strokePath(g, a.path, {
        color: glowColor,
        alpha: opacity * 0.5,
        width: a.config.trail.glow_width,
      }, tailIdx, headIdx);
    }

    // Main trail line
    if (a.config.trail.line_style === "dashed") {
      const trailSlice = a.path.slice(tailIdx, headIdx + 1);
      this._drawDashedPolyline(
        g,
        trailSlice,
        colorNum,
        opacity,
        width,
        a.config.trail.dash_pattern
      );
    } else {
      this._strokePath(g, a.path, { color: colorNum, alpha: opacity, width }, tailIdx, headIdx);
    }

    // Ship wake: V-shaped lines diverging behind the head position.
    if (a.unitType === "ship" || a.unitType === "submarine") {
      const headPos = a.path[headIdx];
      if (headPos && headIdx > 0) {
        const prevPos = a.path[Math.max(0, headIdx - 3)];
        const dx = headPos[0] - prevPos[0];
        const dy = headPos[1] - prevPos[1];
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0.5) {
          const nx = -dy / len; // perpendicular
          const ny = dx / len;
          const wakeLen = 15;
          const wakeSpread = 8;
          const backX = headPos[0] - (dx / len) * wakeLen;
          const backY = headPos[1] - (dy / len) * wakeLen;
          g.moveTo(headPos[0], headPos[1])
            .lineTo(backX + nx * wakeSpread, backY + ny * wakeSpread);
          g.moveTo(headPos[0], headPos[1])
            .lineTo(backX - nx * wakeSpread, backY - ny * wakeSpread);
          g.stroke({ color: 0xffffff, width: 1, alpha: fadeOut * 0.25 });
        }
      }
    }
  }

  /**
   * Draw a polyline (array of [x,y] points) as a single stroked path.
   * Accepts optional startIdx/endIdx to avoid creating a slice copy.
   */
  private _strokePath(
    g: Graphics,
    pts: [number, number][],
    style: { color: number; alpha: number; width: number },
    startIdx = 0,
    endIdx = pts.length - 1
  ): void {
    if (endIdx - startIdx < 1) return;
    g.moveTo(pts[startIdx][0], pts[startIdx][1]);
    for (let i = startIdx + 1; i <= endIdx; i++) {
      g.lineTo(pts[i][0], pts[i][1]);
    }
    g.stroke({ color: style.color, alpha: style.alpha, width: style.width });
  }

  private _drawDashedPolyline(
    g: Graphics,
    pts: [number, number][],
    colorNum: number,
    alpha: number,
    width: number,
    dashPattern: [number, number]
  ): void {
    const [dashLen, gapLen] = dashPattern;
    const cycleLen = dashLen + gapLen;

    // Walk along the polyline, toggling draw/skip at each dash boundary.
    let segOffset = 0; // position within the current dash/gap cycle
    let drawing = true;

    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const segDist = Math.sqrt(dx * dx + dy * dy);
      if (segDist < 0.0001) continue;

      let walked = 0;

      while (walked < segDist) {
        const phaseLen = drawing ? dashLen : gapLen;
        const phaseConsumed = segOffset % cycleLen;
        const phaseUsed = drawing
          ? phaseConsumed
          : phaseConsumed - (phaseConsumed >= dashLen ? dashLen : 0);
        const remaining = phaseLen - (phaseUsed < 0 ? 0 : phaseUsed);
        const step = Math.min(remaining, segDist - walked);

        if (drawing) {
          const tx0 = x0 + (dx * walked) / segDist;
          const ty0 = y0 + (dy * walked) / segDist;
          const tx1 = x0 + (dx * (walked + step)) / segDist;
          const ty1 = y0 + (dy * (walked + step)) / segDist;
          g.moveTo(tx0, ty0);
          g.lineTo(tx1, ty1);
        }

        walked += step;
        segOffset += step;

        if (segOffset >= cycleLen) {
          segOffset -= cycleLen;
          drawing = true;
        } else if (drawing && segOffset >= dashLen) {
          drawing = false;
        }
      }
    }

    g.stroke({ color: colorNum, alpha, width });
  }

  // ── Trail particles ────────────────────────────────────────────────────────

  private _drawParticles(
    a: InternalAnim,
    dotColorNum: number,
    progress: number,
    tailProgress: number,
    isNuke: boolean,
    fadeOut: number
  ): void {
    const g = a.dotsGfx;
    g.clear();

    if (a.config.trail.particles === "none") return;

    const count = a.config.trail.particle_count;
    const spacing = a.config.trail.particle_spacing;
    const pathLen = a.path.length;

    for (let i = 0; i < count; i++) {
      const dp = progress - i * spacing;
      if (dp < 0 || dp > 1) continue;
      if (dp < tailProgress) continue;

      const dotPos = isNuke
        ? lerpPath(a.path, dp)
        : a.path[Math.min(Math.floor(dp * (pathLen - 1)), pathLen - 1)];

      const dotFade = 1 - i / count;
      const dotScale =
        1 - (i / count) * a.config.trail.particle_scale_decay;
      const radius =
        (i === 0
          ? a.config.trail.particle_head_size
          : Math.max(
              a.config.trail.particle_min_size,
              a.config.trail.particle_decay_base -
                i * a.config.trail.particle_decay
            )) * dotScale;

      const alpha = dotFade * dotFade * fadeOut;

      g.circle(dotPos[0], dotPos[1], radius).fill({
        color: dotColorNum,
        alpha,
      });
    }
  }

  // ── Unit icon ──────────────────────────────────────────────────────────────

  private _drawIcon(
    a: InternalAnim,
    currentPoint: [number, number],
    rawLinear: number,
    progress: number,
    isNuke: boolean,
    fadeOut: number
  ): void {
    const g = a.iconGfx;
    g.clear();

    const iconRadius = 14;

    // Breathing scale oscillation
    const breathe =
      1 +
      Math.sin(rawLinear * a.config.icon.breathe_speed) *
        a.config.icon.breathe_amplitude;

    // Nuke multi-stage scale (grow → cruise → shrink on approach)
    const nukeScale = isNuke
      ? rawLinear < 0.3
        ? 0.15 + 0.55 * (rawLinear / 0.3)
        : rawLinear > 0.75
          ? 0.7 - 0.4 * ((rawLinear - 0.75) / 0.25)
          : 0.7
      : 0;

    const finalScale = isNuke
      ? nukeScale
      : a.config.icon.size *
        breathe *
        (a.config.icon.fade_blend_min +
          (1 - a.config.icon.fade_blend_min) * fadeOut);

    const alpha = Math.min(1, isNuke ? 1 : fadeOut * 1.3);

    if (alpha <= 0 || finalScale <= 0) {
      a.labelText.visible = false;
      if (a.iconSprite) a.iconSprite.visible = false;
      return;
    }

    // *3 compensates for the icon.size fraction values (0.2–0.42 range)
    const scaledRadius = iconRadius * finalScale * 3;

    // Bomber shadow: dark oval below the icon to suggest altitude.
    // Drawn at local coordinates — g.position is set to currentPoint below.
    if (a.unitType === "bomber" && alpha > 0.05) {
      g.ellipse(0, 20, scaledRadius * 1.6, scaledRadius * 0.5)
        .fill({ color: 0x000000, alpha: alpha * 0.18 });
    }

    // Rotation toward direction of travel.
    // The SVG sprites (bomber, fighter, etc.) have their nose pointing UP
    // (negative Y in SVG/screen space). In Pixi.js, rotation=0 means the
    // sprite points EAST (positive X). Screen Y increases downward.
    //
    // For a north-facing sprite to point in direction (dx, dy):
    //   rotation = atan2(dx, -dy)
    //
    // Verification:
    //   moving right  (dx=1,dy=0): atan2(1, 0)  =  π/2  → 90° CW from north = east ✓
    //   moving down   (dx=0,dy=1): atan2(0,-1)  = -π/2  → 90° CCW = south (sprite flips down) ✓
    //   moving up     (dx=0,dy=-1): atan2(0, 1) =  0    → north ✓
    //   moving left   (dx=-1,dy=0): atan2(-1,0) = -π/2  → west ✓
    //
    // The old formula atan2(dx, dy) was wrong: moving south (dy>0) would yield
    // rotation=0 (nose pointing north) instead of rotating to face south.
    let rotation = 0;
    if (a.config.icon.rotate) {
      const pathLen = a.path.length;
      const headIdx = Math.min(
        Math.floor(progress * (pathLen - 1)),
        pathLen - 1
      );
      const lookAhead = isNuke
        ? lerpPath(a.path, Math.min(1, progress + 0.005))
        : a.path[Math.min(headIdx + 1, pathLen - 1)];
      const dx = lookAhead[0] - currentPoint[0];
      const dy = lookAhead[1] - currentPoint[1];
      rotation = Math.atan2(dx, -dy);
    }

    if (a.iconSprite) {
      // Use loaded sprite texture instead of plain circle
      const sprite = a.iconSprite;
      sprite.visible = true;
      sprite.width = scaledRadius * 2;
      sprite.height = scaledRadius * 2;
      sprite.position.set(currentPoint[0], currentPoint[1]);
      sprite.rotation = rotation;
      sprite.alpha = alpha;
      // Small colored circle behind sprite for player color
      g.circle(0, 0, scaledRadius)
        .fill({ color: a.colorNum, alpha: alpha * 0.3 })
        .stroke({ color: a.colorNum, alpha: alpha * 0.6, width: 1.5 });
    } else {
      // Fallback: colored circle while sprite loads
      g.circle(0, 0, scaledRadius)
        .fill({ color: a.colorNum, alpha })
        .stroke({ color: 0x000000, alpha: alpha * 0.6, width: 1.5 });
    }

    g.position.set(currentPoint[0], currentPoint[1]);
    g.rotation = a.iconSprite ? 0 : rotation;

    // Unit count label positioned just above the icon
    const label = a.labelText;
    label.visible = true;
    label.alpha = alpha;
    label.scale.set(finalScale * 3);
    label.position.set(currentPoint[0], currentPoint[1] - scaledRadius - 4);
  }

  // ── Pulse rings ────────────────────────────────────────────────────────────

  private _upsertPulseRing(
    a: InternalAnim,
    now: number,
    progress: number,
    fadeOut: number
  ): void {
    const key = a.id;
    if (!this.pulseRings.has(key)) {
      const gfx = new Graphics();
      this.container.addChild(gfx);
      this.pulseRings.set(key, {
        animId: a.id,
        centroid: a.targetCentroid,
        startTime: now,
        config: a.config.pulse,
        gfx,
      });
    }

    const ring = this.pulseRings.get(key)!;
    const pulseCfg = ring.config;
    const g = ring.gfx;
    g.clear();

    const pulseColorNum = hexToNum(pulseCfg.color);

    for (let r = 0; r < pulseCfg.rings; r++) {
      const phase =
        ((progress - pulseCfg.start_at) * 4 + r / pulseCfg.rings) % 1;
      const ringFade = 1 - phase;
      const radius = pulseCfg.radius_base + phase * pulseCfg.radius_expand;
      const alpha = ringFade * ringFade * pulseCfg.opacity * fadeOut;

      g.circle(ring.centroid[0], ring.centroid[1], radius).stroke({
        color: pulseColorNum,
        alpha,
        width: 2.5,
      });
    }
  }

  private _removePulseRing(animId: string): void {
    const ring = this.pulseRings.get(animId);
    if (!ring) return;
    ring.gfx.destroy();
    this.container.removeChild(ring.gfx);
    this.pulseRings.delete(animId);
  }

  // ── Bomb drops (bomber unit) ───────────────────────────────────────────────

  /**
   * Spawn a bomb-drop + explosion at the given world-space coordinates.
   * Called externally when path_damage / bomber_strike events arrive from
   * the engine, so the visual effect confirms the real tick damage.
   */
  spawnBombAt(x: number, y: number): void {
    this._spawnBomb(x, y, Date.now());
  }

  /**
   * Public method to spawn a bomb salvo at a world position.
   * Called from GameCanvas when a path_damage event arrives from the engine.
   */
  spawnBombingSalvoAt(cx: number, cy: number, isFinal: boolean): void {
    this._spawnBombingSalvo(cx, cy, Date.now(), isFinal);
  }

  /**
   * Spawn a salvo of bombs spread around a province centroid.
   * `isFinal` = true for the target province (bigger salvo + shockwave).
   */
  private _spawnBombingSalvo(
    cx: number,
    cy: number,
    now: number,
    isFinal: boolean
  ): void {
    const count = isFinal ? 5 : 2;
    const spread = isFinal ? 22 : 14;
    for (let i = 0; i < count; i++) {
      const ox = (Math.random() - 0.5) * spread;
      const oy = (Math.random() - 0.5) * spread * 0.7;
      const delay = i * 100;
      if (delay === 0) {
        this._spawnBomb(cx + ox, cy + oy, now);
      } else {
        this._spawnBomb(cx + ox, cy + oy, now + delay);
      }
    }
    // Emit sound event so page.tsx can play synchronized audio.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("bomber-salvo", { detail: { isFinal } }));
    }
    // Final strike: add a shockwave ring + big particle explosion at province center.
    if (isFinal) {
      this._spawnShockwave(cx, cy, now + count * 100);
      // Large smoke+fire particle burst for the final bombing target
      const smokeId = `bomb-smoke-${this._particleIdCounter++}`;
      this._particles.addEmitter(
        smokeId,
        new ParticleEmitter(this._particleContainer, ParticlePresets.smokeTrail(cx, cy))
      );
    }
  }

  /**
   * Expanding shockwave ring at the final bombing target.
   */
  private _spawnShockwave(x: number, y: number, now: number): void {
    const gfx = new Graphics();
    this.container.addChild(gfx);
    // Reuse BombDrop struct for the shockwave — abuse impactGfx for the ring.
    const impactGfx = new Graphics();
    this.container.addChild(impactGfx);
    this._bombs.push({
      x,
      y,
      startTime: now,
      duration: 100, // "fall" is instant
      startY: y,
      endY: y,
      gfx,
      impactGfx,
      impacted: false,
      impactStartTime: 0,
    });
  }

  /**
   * Artillery impact shockwave — larger and more dramatic than bomber shockwave.
   * White flash + expanding orange ring + ground crater circle.
   */
  private _spawnArtilleryShockwave(x: number, y: number, now: number): void {
    const gfx = new Graphics();
    this.container.addChild(gfx);
    const impactGfx = new Graphics();
    this.container.addChild(impactGfx);
    // Reuse BombDrop struct: instant "fall" → immediately triggers impact rendering.
    this._bombs.push({
      x,
      y,
      startTime: now,
      duration: 50, // near-instant fall
      startY: y,
      endY: y,
      gfx,
      impactGfx,
      impacted: false,
      impactStartTime: 0,
    });
  }

  private _spawnBomb(x: number, y: number, now: number): void {
    const gfx = new Graphics();
    const impactGfx = new Graphics();
    this.container.addChild(gfx);
    this.container.addChild(impactGfx);

    this._bombs.push({
      x,
      y,
      startTime: now,
      duration: 800,
      startY: y,
      endY: y + 40,
      gfx,
      impactGfx,
      impacted: false,
      impactStartTime: 0,
    });
  }

  private _updateBombs(now: number): void {
    for (let i = this._bombs.length - 1; i >= 0; i--) {
      const bomb = this._bombs[i];
      const elapsed = now - bomb.startTime;
      const rawProgress = elapsed / bomb.duration;

      // Gravity-accelerated fall (eased quadratic)
      const fallProgress = Math.min(rawProgress, 1);
      const easedFall = fallProgress * fallProgress;
      const currentY = bomb.startY + (bomb.endY - bomb.startY) * easedFall;

      // Draw bomb body and trail
      const g = bomb.gfx;
      g.clear();

      if (rawProgress < 1) {
        // Trail: 4 fading dots above the bomb
        for (let t = 3; t >= 1; t--) {
          const trailFrac = (t / 4) * 0.5;
          const trailY = bomb.startY + (bomb.endY - bomb.startY) * Math.max(0, easedFall - trailFrac);
          const trailAlpha = (1 - t / 4) * 0.55 * (1 - fallProgress * 0.5);
          const trailRadius = Math.max(0.5, 2 - t * 0.4);
          g.circle(bomb.x, trailY, trailRadius).fill({ color: 0x555555, alpha: trailAlpha });
        }

        // Bomb body: dark gray circle
        g.circle(bomb.x, currentY, 3).fill({ color: 0x222222, alpha: 0.95 });
        g.circle(bomb.x, currentY, 3).stroke({ color: 0x888888, alpha: 0.6, width: 1 });
      }

      // Trigger impact when fall completes
      if (!bomb.impacted && rawProgress >= 1) {
        bomb.impacted = true;
        bomb.impactStartTime = now;
        // Spawn particle explosion at bomb impact point
        const bombExplId = `bomb-expl-${this._particleIdCounter++}`;
        this._particles.addEmitter(
          bombExplId,
          new ParticleEmitter(this._particleContainer, ParticlePresets.explosion(bomb.x, bomb.endY))
        );
      }

      // Draw expanding explosion at impact point
      if (bomb.impacted) {
        const impactElapsed = now - bomb.impactStartTime;
        const impactDuration = 600;
        const ip = impactElapsed / impactDuration;
        const ig = bomb.impactGfx;
        ig.clear();

        if (ip < 1) {
          // Layer 1: outer shockwave ring — fast expanding, fading
          const shockRadius = 8 + ip * 32;
          const shockAlpha = Math.pow(1 - ip, 2) * 0.7;
          ig.circle(bomb.x, bomb.endY, shockRadius).stroke({ color: 0xf97316, alpha: shockAlpha, width: 2 });

          // Layer 2: second ring (slightly delayed) for depth
          if (ip > 0.1) {
            const ip2 = (ip - 0.1) / 0.9;
            const ring2Radius = 5 + ip2 * 24;
            const ring2Alpha = Math.pow(1 - ip2, 2) * 0.5;
            ig.circle(bomb.x, bomb.endY, ring2Radius).stroke({ color: 0xff6b35, alpha: ring2Alpha, width: 1.5 });
          }

          // Layer 3: fireball core — bright yellow→orange→red transition
          if (ip < 0.5) {
            const coreP = ip / 0.5;
            const coreRadius = 4 + coreP * 10;
            const coreAlpha = Math.pow(1 - coreP, 1.5) * 0.9;
            // Yellow core
            ig.circle(bomb.x, bomb.endY, coreRadius * 0.6).fill({ color: 0xfbbf24, alpha: coreAlpha });
            // Orange fill
            ig.circle(bomb.x, bomb.endY, coreRadius).fill({ color: 0xef4444, alpha: coreAlpha * 0.6 });
          }

          // Layer 4: white-hot flash (first 15%)
          if (ip < 0.15) {
            const flashP = ip / 0.15;
            const flashRadius = 3 + flashP * 8;
            ig.circle(bomb.x, bomb.endY, flashRadius).fill({ color: 0xffffff, alpha: (1 - flashP) * 0.8 });
          }

          // Layer 5: smoke — dark gray circles that expand and fade slowly
          if (ip > 0.2) {
            const smokeP = (ip - 0.2) / 0.8;
            const smokeRadius = 6 + smokeP * 18;
            const smokeAlpha = Math.pow(1 - smokeP, 1.2) * 0.25;
            ig.circle(bomb.x, bomb.endY - smokeP * 10, smokeRadius).fill({ color: 0x333333, alpha: smokeAlpha });
          }

          // Layer 6: 6 debris particles radiating outward (more than before)
          const debrisCount = 6;
          for (let d = 0; d < debrisCount; d++) {
            const angle = (d / debrisCount) * Math.PI * 2 + 0.3; // slight offset
            const pDist = ip * 22;
            const px = bomb.x + Math.cos(angle) * pDist;
            const py = bomb.endY + Math.sin(angle) * pDist - ip * 5; // slight upward drift
            const pAlpha = Math.pow(1 - ip, 2.5) * 0.7;
            const pRadius = 1.2 + (1 - ip) * 1.0;
            ig.circle(px, py, pRadius).fill({ color: 0xff8c00, alpha: pAlpha });
          }
        } else if (impactElapsed > impactDuration + 200) {
          // Fully complete — remove this bomb
          bomb.gfx.destroy();
          bomb.impactGfx.destroy();
          this.container.removeChild(bomb.gfx);
          this.container.removeChild(bomb.impactGfx);
          this._bombs.splice(i, 1);
        }
      } else if (rawProgress > 3.0) {
        // Safety cleanup for bombs that never impacted (shouldn't happen)
        bomb.gfx.destroy();
        bomb.impactGfx.destroy();
        this.container.removeChild(bomb.gfx);
        this.container.removeChild(bomb.impactGfx);
        this._bombs.splice(i, 1);
      }
    }
  }

  // ── Impact flash ───────────────────────────────────────────────────────────

  private _triggerImpact(a: InternalAnim, now: number): void {
    const isAttack = a.actionType === "attack";
    const impactCfg = isAttack
      ? a.config.impact_attack
      : a.config.impact_move;

    const gfx = new Graphics();
    this.container.addChild(gfx);

    this.impacts.set(a.id, {
      id: a.id,
      centroid: a.targetCentroid,
      startTime: now,
      duration: impactCfg.duration,
      config: impactCfg,
      gfx,
    });

    // ── Particle VFX on arrival — adapted per unit type ─────────────────────
    const [tx, ty] = a.targetCentroid;
    const id = () => `impact-${this._particleIdCounter++}`;
    const pc = this._particleContainer;

    if (!isAttack) {
      // Move arrival: tiny dust puff
      const cfg = ParticlePresets.dust({ x: tx, y: ty, w: 1, h: 1 });
      cfg.emitterLifetime = 0.3;
      cfg.maxParticles = 8;
      cfg.particlesPerWave = 8;
      this._particles.addEmitter(id(), new ParticleEmitter(pc, cfg));
    } else if (a.unitType === "tank") {
      // Tank: medium sparks + dust cloud
      this._particles.addEmitter(id(), new ParticleEmitter(pc, ParticlePresets.sparks(tx, ty)));
      const dustCfg = ParticlePresets.dust({ x: tx, y: ty, w: 1, h: 1 });
      dustCfg.emitterLifetime = 0.4;
      dustCfg.maxParticles = 15;
      dustCfg.particlesPerWave = 15;
      this._particles.addEmitter(id(), new ParticleEmitter(pc, dustCfg));
    } else if (a.unitType === "ship" || a.unitType === "submarine") {
      // Naval: water splash
      const cfg = ParticlePresets.sparks(tx, ty);
      cfg.behaviors = cfg.behaviors.map((b) =>
        b.type === "color"
          ? { type: "color" as const, config: { start: "#88ccff", end: "#4488cc" } }
          : b
      );
      cfg.maxParticles = 20;
      this._particles.addEmitter(id(), new ParticleEmitter(pc, cfg));
    } else if (a.unitType === "nuke_rocket") {
      // Nuke handled separately in arrival trigger (mushroom cloud)
    } else {
      // Infantry, commando, fighter, etc: small dust + clash (NO explosion)
      const dustCfg = ParticlePresets.dust({ x: tx, y: ty, w: 1, h: 1 });
      dustCfg.emitterLifetime = 0.2;
      dustCfg.maxParticles = 10;
      dustCfg.particlesPerWave = 10;
      this._particles.addEmitter(id(), new ParticleEmitter(pc, dustCfg));
    }
  }

  // ── Impact flash update ────────────────────────────────────────────────────

  private _updateImpacts(now: number): void {
    for (const flash of this.impacts.values()) {
      const flashProgress = (now - flash.startTime) / flash.config.duration;
      if (flashProgress >= 1) continue; // will be removed by _gc

      const g = flash.gfx;
      g.clear();

      for (const layer of flash.config.layers) {
        if (flashProgress > layer.duration_pct) continue;
        const layerProgress = flashProgress / layer.duration_pct;
        const fade = Math.pow(1 - layerProgress, layer.opacity_curve);
        const radius =
          layer.radius[0] +
          layerProgress * (layer.radius[1] - layer.radius[0]);
        const colorNum = hexToNum(layer.color);
        const alpha = fade * layer.opacity_start;

        if (layer.type === "fill") {
          g.circle(
            flash.centroid[0],
            flash.centroid[1],
            radius
          ).fill({ color: colorNum, alpha });
        } else {
          g.circle(
            flash.centroid[0],
            flash.centroid[1],
            radius
          ).stroke({ color: colorNum, alpha, width: 2.5 });
        }
      }
    }
  }

  // ── Garbage collection ────────────────────────────────────────────────────

  private _gc(now: number): void {
    // Remove completed animations
    for (const [id, a] of this.anims) {
      const elapsed = now - a.startTime;
      // Keep graphics alive for a brief linger window after completion so the
      // final frame is fully visible before the impact flash takes over.
      const MAX_LINGER = 200;
      if (elapsed >= a.duration + MAX_LINGER) {
        this._removeAnimGraphics(a);
        this.anims.delete(id);
        this._removePulseRing(id);
      }
    }

    // Remove completed impact flashes
    for (const [id, flash] of this.impacts) {
      if (now - flash.startTime >= flash.duration) {
        flash.gfx.destroy();
        this.container.removeChild(flash.gfx);
        this.impacts.delete(id);
      }
    }

    // Remove orphaned pulse rings whose owning animation is gone
    for (const [animId, ring] of this.pulseRings) {
      if (!this.anims.has(animId)) {
        ring.gfx.destroy();
        this.container.removeChild(ring.gfx);
        this.pulseRings.delete(animId);
      }
    }

    // Bound the arrived set to prevent unbounded memory growth
    if (this.arrived.size > 500) {
      this.arrived.clear();
    }

    // Bound active bomb array — safety cap (each bomber flight spawns at most 5)
    if (this._bombs.length > 50) {
      // Too many active bombs; remove the oldest half
      const toRemove = this._bombs.splice(0, 25);
      for (const bomb of toRemove) {
        bomb.gfx.destroy();
        bomb.impactGfx.destroy();
        this.container.removeChild(bomb.gfx);
        this.container.removeChild(bomb.impactGfx);
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _removeAnimGraphics(a: InternalAnim): void {
    a.trailGfx.destroy();
    a.dotsGfx.destroy();
    a.iconGfx.destroy();
    a.labelText.destroy();
    this.container.removeChild(
      a.trailGfx,
      a.dotsGfx,
      a.iconGfx,
      a.labelText
    );
    if (a.iconSprite) {
      this.container.removeChild(a.iconSprite);
      a.iconSprite.destroy();
      a.iconSprite = null;
    }
  }
}
