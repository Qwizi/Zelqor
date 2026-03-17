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
  type AnimationConfig,
  type CosmeticValue,
  type ImpactConfig,
  type PulseConfig,
} from "@/lib/animationConfig";

// ── AnimKind type ────────────────────────────────────────────────────────────

export type AnimKind = "fighter" | "ship" | "tank" | "infantry";

// ── Duration map (mirrors GameMap.tsx) ───────────────────────────────────────

const DURATION_MAP: Record<AnimKind, number> = {
  fighter: 1100,
  ship: 3200,
  tank: 2400,
  infantry: 1900,
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
 */
export function buildAnimationPath(
  kind: AnimKind,
  from: [number, number],
  to: [number, number],
  unitType?: string | null
): [number, number][] {
  if (unitType === "nuke_rocket") return computeCurvePath(from, to, 0.35, 200);
  if (kind === "fighter") return computeCurvePath(from, to, 0.24, 52);
  if (kind === "ship") return computeCurvePath(from, to, 0.04, 34);
  if (kind === "tank") return computeCurvePath(from, to, 0.08, 26);
  return computeMarchPath(from, to, 26);
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
  fighter: "/assets/units/planes/bomber_h300.webp",
  ship: "/assets/units/ships/ship1.png",
  tank: "/assets/units/ground_unit_sphere_h300.png",
  infantry: "/assets/units/ground_unit.webp",
  nuke_rocket: "/assets/units/nuke_icon.png",
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

  // Track which anim IDs have already triggered their arrival flash.
  private readonly arrived: Set<string> = new Set();

  private readonly labelStyle: TextStyle;

  constructor() {
    this.container = new Container();
    this.container.label = "PixiAnimationManager";

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
    const animKind = resolveAnimationKindSync(anim.unitType);
    const path = buildAnimationPath(
      animKind,
      sourceCentroid,
      targetCentroid,
      anim.unitType
    );
    const duration =
      anim.durationMs ??
      (isNuke ? 8000 : (DURATION_MAP[animKind] ?? DURATION_MAP.infantry));
    const config = resolveAnimConfig(
      animKind,
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
      text: String(anim.units),
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
    };

    this.anims.set(anim.id, internal);

    // Load unit sprite asynchronously
    const spriteUrl = UNIT_ICON_MAP[anim.unitType ?? ""] ?? UNIT_ICON_MAP[animKind];
    if (spriteUrl) {
      Assets.load(spriteUrl).then((texture: Texture) => {
        if (!this.anims.has(anim.id)) return; // animation already removed
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5, 0.5);
        sprite.eventMode = "none";
        sprite.visible = false;
        this.container.addChild(sprite);
        internal.iconSprite = sprite;
      }).catch(() => {});
    }
  }

  /**
   * Called every frame by the Pixi Ticker (or any rAF loop).
   *
   * @param now  Current timestamp in milliseconds (e.g. `Date.now()`).
   */
  update(now: number): void {
    this._updateAnims(now);
    this._updateImpacts(now);
    this._gc(now);
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

    this.arrived.clear();
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
      this._drawTrail(a, trailColorNum, tailIdx, headIdx, fadeOut);

      // ── Trail particles ───────────────────────────────────────────────────
      this._drawParticles(
        a,
        dotColorNum,
        progress,
        tailProgress,
        isNuke,
        fadeOut
      );

      // ── Unit icon ─────────────────────────────────────────────────────────
      const currentPoint = isNuke
        ? lerpPath(a.path, progress)
        : a.path[headIdx];
      this._drawIcon(a, currentPoint, rawLinear, progress, isNuke, fadeOut);

      // ── Pulse rings (during approach, attack only) ────────────────────────
      if (
        a.config.pulse.enabled &&
        a.actionType === "attack" &&
        progress > a.config.pulse.start_at
      ) {
        this._upsertPulseRing(a, now, progress, fadeOut);
      } else {
        this._removePulseRing(a.id);
      }

      // ── Arrival trigger ───────────────────────────────────────────────────
      if (rawLinear >= 1 && !this.arrived.has(a.id)) {
        this.arrived.add(a.id);
        this._triggerImpact(a, now);
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

    const trailSlice = a.path.slice(tailIdx, headIdx + 1);
    if (trailSlice.length < 2) return;

    const opacity = a.config.trail.opacity * fadeOut;
    const width = a.config.trail.width * (0.7 + 0.3 * fadeOut);

    // Glow layer (wider, semi-transparent, rendered beneath the main trail)
    if (a.config.trail.glow) {
      const glowColor = a.config.trail.glow_color
        ? hexToNum(a.config.trail.glow_color)
        : colorNum;
      this._strokePath(g, trailSlice, {
        color: glowColor,
        alpha: opacity * 0.5,
        width: a.config.trail.glow_width,
      });
    }

    // Main trail line
    if (a.config.trail.line_style === "dashed") {
      this._drawDashedPolyline(
        g,
        trailSlice,
        colorNum,
        opacity,
        width,
        a.config.trail.dash_pattern
      );
    } else {
      this._strokePath(g, trailSlice, { color: colorNum, alpha: opacity, width });
    }
  }

  /**
   * Draw a polyline (array of [x,y] points) as a single stroked path.
   */
  private _strokePath(
    g: Graphics,
    pts: [number, number][],
    style: { color: number; alpha: number; width: number }
  ): void {
    if (pts.length < 2) return;
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
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

    // Rotation toward direction of travel
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
      rotation = Math.atan2(
        lookAhead[0] - currentPoint[0],
        lookAhead[1] - currentPoint[1]
      );
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
