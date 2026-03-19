// ── Animation Configuration ───────────────────────────────────────────────────
//
// Single source of truth for all unit animation parameters. Extracted from
// GameMap.tsx so that per-player cosmetic overrides can deep-merge cleanly over
// the defaults without touching rendering code.

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface TrailConfig {
  /** Hex color for the trail line. null = use player color. */
  color: string | null;
  opacity: number;
  width: number;
  /** MapLibre line-blur amount. */
  blur: number;
  /** Fraction of the full path that is visible as a trailing line [0, 1]. */
  length: number;
  line_style: "solid" | "dashed" | "none";
  /** Pixel pattern for dashed lines, e.g. [4, 3]. */
  dash_pattern: [number, number];
  /** Whether to render an additional blurred glow beneath the trail line. */
  glow: boolean;
  /** Glow color. null = trail color with reduced alpha. */
  glow_color: string | null;
  glow_width: number;
  particles: "circle" | "none";
  particle_count: number;
  /** Longitudinal spacing between particles as a fraction of path length. */
  particle_spacing: number;
  /** Radius of the leading (head) particle in pixels. */
  particle_head_size: number;
  /**
   * Size reduction applied per dot step from head toward tail.
   * Applied as: size = particle_decay_base - (dotIndex * particle_decay)
   */
  particle_decay: number;
  /** Starting radius for non-head trail dots before decay is applied. */
  particle_decay_base: number;
  particle_min_size: number;
  /** Dot color override. null = trail color. */
  particle_color: string | null;
  /**
   * Additional scale-down factor toward the tail [0, 1].
   * 0 = no extra shrink, 1 = last dot collapses to zero.
   * Reserved for future fine-tuning; not currently used in the renderer.
   */
  particle_scale_decay: number;
}

export interface IconConfig {
  /** Fraction of the map icon target size used as icon-size in MapLibre. */
  size: number;
  /** Amplitude of the breathing (hover) scale oscillation. */
  breathe_amplitude: number;
  /** Angular speed of the breathing animation (radians / second). */
  breathe_speed: number;
  /** Progress fraction at which the icon starts fading out near the target. */
  fade_start: number;
  /**
   * Minimum opacity the icon blends to when it reaches the target.
   * Values below 1 allow the icon to remain partially visible at arrival.
   */
  fade_blend_min: number;
  /** Whether the icon sprite rotates to face the direction of travel. */
  rotate: boolean;
}

export interface PulseConfig {
  /** When false the defend-pulse rings are not rendered for this unit kind. */
  enabled: boolean;
  /** Stroke color of the expanding rings. */
  color: string;
  /** Number of concentric rings rendered simultaneously. */
  rings: number;
  /** Starting radius (pixels) of the smallest ring. */
  radius_base: number;
  /** Maximum radius (pixels) the outermost ring reaches. */
  radius_expand: number;
  /**
   * Fractional progress along the path at which pulse rings begin to appear.
   * Rings only render while the unit is in its approach phase (progress >= start_at).
   */
  start_at: number;
  opacity: number;
}

export interface ImpactLayerConfig {
  type: "ring" | "fill";
  color: string;
  /** [start_radius, end_radius] in pixels. */
  radius: [number, number];
  /** Initial opacity of this layer. */
  opacity_start: number;
  /**
   * Exponent of the fade-out curve. Higher values make the layer vanish faster
   * toward the end of its lifetime. Formula: opacity = opacity_start * (1 - t)^exponent
   */
  opacity_curve: number;
  /**
   * Fraction of the total impact duration this layer is active [0, 1].
   * After (duration * duration_pct) ms the layer is fully transparent.
   */
  duration_pct: number;
}

export interface ImpactConfig {
  /** Total flash duration in milliseconds. */
  duration: number;
  /** Ordered list of visual layers painted from bottom to top. */
  layers: ImpactLayerConfig[];
}

export interface AnimationConfig {
  trail: TrailConfig;
  icon: IconConfig;
  pulse: PulseConfig;
  /** Flash rendered at the target centroid when the unit arrives as an attack. */
  impact_attack: ImpactConfig;
  /** Flash rendered at the target centroid when the unit arrives as a move. */
  impact_move: ImpactConfig;
}

// ── Shared impact configs ─────────────────────────────────────────────────────
//
// All non-nuke unit kinds share the same impact flashes.  They are defined once
// here and referenced by value in ANIMATION_DEFAULTS so that structuredClone in
// the resolver always produces independent copies.

const SHARED_IMPACT_ATTACK: ImpactConfig = {
  duration: 600,
  layers: [
    {
      type: "ring",
      color: "#ef4444",
      radius: [6, 58],
      opacity_start: 0.9,
      opacity_curve: 1.5,
      duration_pct: 1.0,
    },
    {
      type: "fill",
      color: "#fca5a5",
      radius: [4, 16],
      opacity_start: 0.8,
      opacity_curve: 2.0,
      duration_pct: 0.4,
    },
  ],
};

const SHARED_IMPACT_MOVE: ImpactConfig = {
  duration: 600,
  layers: [
    {
      type: "ring",
      color: "#22d3ee",
      radius: [6, 58],
      opacity_start: 0.9,
      opacity_curve: 1.5,
      duration_pct: 1.0,
    },
    {
      type: "fill",
      color: "#a5f3fc",
      radius: [4, 16],
      opacity_start: 0.8,
      opacity_curve: 2.0,
      duration_pct: 0.4,
    },
  ],
};

const NUKE_IMPACT_ATTACK: ImpactConfig = {
  duration: 1800,
  layers: [
    {
      type: "ring",
      color: "#ff6b00",
      radius: [10, 150],
      opacity_start: 0.7,
      opacity_curve: 1.2,
      duration_pct: 1.0,
    },
    {
      type: "fill",
      color: "#ef4444",
      radius: [8, 71],
      opacity_start: 0.85,
      opacity_curve: 1.5,
      duration_pct: 0.7,
    },
    {
      type: "fill",
      color: "#fbbf24",
      radius: [6, 46],
      opacity_start: 0.95,
      opacity_curve: 1.0,
      duration_pct: 0.5,
    },
    {
      type: "fill",
      color: "#ffffff",
      radius: [4, 22],
      opacity_start: 1.0,
      opacity_curve: 2.0,
      duration_pct: 0.25,
    },
  ],
};

// Shared breathe / fade values — identical for all unit kinds.
const SHARED_BREATHE_SPEED = Math.PI * 6; // 6π rad/s ≈ 3 full oscillations/s

const SHARED_ICON_BASE: Pick<
  IconConfig,
  "breathe_amplitude" | "breathe_speed" | "fade_start" | "fade_blend_min"
> = {
  breathe_amplitude: 0.06,
  breathe_speed: SHARED_BREATHE_SPEED,
  fade_start: 0.75,
  fade_blend_min: 0.6,
};

// ── ANIMATION_DEFAULTS ────────────────────────────────────────────────────────

/**
 * Default animation parameters for each unit kind.
 * Keys: "fighter" | "ship" | "tank" | "infantry" | "nuke"
 *
 * NOTE: The nuke unit has special multi-stage icon scaling that is kept
 * hardcoded in GameMap.tsx.  The `icon` section here is a stub that will be
 * bypassed by the renderer for nuke units.
 */
export const ANIMATION_DEFAULTS: Record<string, AnimationConfig> = {
  fighter: {
    trail: {
      color: "#f59e0b",
      opacity: 0.85,
      width: 4.5,
      blur: 1.2,
      length: 0.18,
      line_style: "solid",
      dash_pattern: [4, 3],
      glow: false,
      glow_color: null,
      glow_width: 8,
      particles: "circle",
      particle_count: 4,
      particle_spacing: 0.055,
      particle_head_size: 6,
      particle_decay: 0.35,
      particle_decay_base: 4.5,
      particle_min_size: 2.2,
      particle_color: null,
      particle_scale_decay: 0,
    },
    icon: {
      size: 0.3,
      rotate: true,
      ...SHARED_ICON_BASE,
    },
    pulse: {
      enabled: true,
      color: "#fbbf24",
      rings: 3,
      radius_base: 8,
      radius_expand: 44,
      start_at: 0.58,
      opacity: 0.75,
    },
    impact_attack: structuredClone(SHARED_IMPACT_ATTACK),
    impact_move: structuredClone(SHARED_IMPACT_MOVE),
  },

  ship: {
    trail: {
      color: "#38bdf8",
      opacity: 0.5,
      width: 3.2,
      blur: 0.2,
      length: 0.22,
      line_style: "solid",
      dash_pattern: [4, 3],
      glow: false,
      glow_color: null,
      glow_width: 8,
      particles: "circle",
      particle_count: 5,
      particle_spacing: 0.055,
      particle_head_size: 5.5,
      particle_decay: 0.35,
      particle_decay_base: 4.5,
      particle_min_size: 2.2,
      particle_color: null,
      particle_scale_decay: 0,
    },
    icon: {
      size: 0.28,
      rotate: false,
      ...SHARED_ICON_BASE,
    },
    pulse: {
      enabled: true,
      color: "#38bdf8",
      rings: 3,
      radius_base: 8,
      radius_expand: 44,
      start_at: 0.58,
      opacity: 0.75,
    },
    impact_attack: structuredClone(SHARED_IMPACT_ATTACK),
    impact_move: structuredClone(SHARED_IMPACT_MOVE),
  },

  tank: {
    trail: {
      color: null, // player color
      opacity: 0.48,
      width: 3.4,
      blur: 0.15,
      length: 0.3,
      line_style: "solid",
      dash_pattern: [4, 3],
      glow: false,
      glow_color: null,
      glow_width: 8,
      particles: "circle",
      particle_count: 6,
      particle_spacing: 0.055,
      particle_head_size: 7,
      particle_decay: 0.35,
      particle_decay_base: 4.5,
      particle_min_size: 2.2,
      particle_color: null,
      particle_scale_decay: 0,
    },
    icon: {
      size: 0.28,
      rotate: false,
      ...SHARED_ICON_BASE,
    },
    pulse: {
      enabled: true,
      color: "#ef4444",
      rings: 3,
      radius_base: 8,
      radius_expand: 44,
      start_at: 0.58,
      opacity: 0.75,
    },
    impact_attack: structuredClone(SHARED_IMPACT_ATTACK),
    impact_move: structuredClone(SHARED_IMPACT_MOVE),
  },

  infantry: {
    trail: {
      color: null, // player color
      opacity: 0.35,
      width: 2.4,
      blur: 0.15,
      length: 0.3,
      line_style: "solid",
      dash_pattern: [4, 3],
      glow: false,
      glow_color: null,
      glow_width: 8,
      particles: "circle",
      // NUM_TRAIL_DOTS(8) + 2 = 10
      particle_count: 10,
      particle_spacing: 0.055,
      particle_head_size: 5.5,
      particle_decay: 0.22,
      particle_decay_base: 3.8,
      particle_min_size: 2.2,
      particle_color: null,
      particle_scale_decay: 0,
    },
    icon: {
      size: 0.2,
      rotate: false,
      ...SHARED_ICON_BASE,
    },
    pulse: {
      enabled: true,
      color: "#ef4444",
      rings: 3,
      radius_base: 8,
      radius_expand: 44,
      start_at: 0.58,
      opacity: 0.75,
    },
    impact_attack: structuredClone(SHARED_IMPACT_ATTACK),
    impact_move: structuredClone(SHARED_IMPACT_MOVE),
  },

  bomber: {
    trail: {
      color: "#78716c",
      opacity: 0.7,
      width: 6,
      blur: 1.5,
      length: 0.5,
      line_style: "solid",
      dash_pattern: [4, 3],
      glow: true,
      glow_color: "#44403c",
      glow_width: 12,
      particles: "circle",
      particle_count: 6,
      particle_spacing: 0.04,
      particle_head_size: 5,
      particle_decay: 0.35,
      particle_decay_base: 4.5,
      particle_min_size: 2.2,
      particle_color: null,
      particle_scale_decay: 0.82,
    },
    icon: {
      size: 0.55,
      rotate: true,
      breathe_amplitude: 0.04,
      breathe_speed: Math.PI * 4,
      fade_start: 0.92,
      fade_blend_min: 0.6,
    },
    pulse: {
      enabled: true,
      color: "#f97316",
      rings: 3,
      radius_base: 8,
      radius_expand: 44,
      start_at: 0.58,
      opacity: 0.75,
    },
    impact_attack: {
      duration: 1200,
      layers: [
        {
          type: "ring",
          color: "#f97316",
          radius: [10, 40],
          opacity_start: 0.9,
          opacity_curve: 2.5,
          duration_pct: 1.0,
        },
        {
          type: "fill",
          color: "#ef4444",
          radius: [6, 30],
          opacity_start: 0.6,
          opacity_curve: 2.0,
          duration_pct: 0.8,
        },
        {
          type: "fill",
          color: "#fbbf24",
          radius: [4, 18],
          opacity_start: 0.8,
          opacity_curve: 1.5,
          duration_pct: 0.6,
        },
      ],
    },
    impact_move: {
      duration: 400,
      layers: [
        {
          type: "ring",
          color: "#78716c",
          radius: [6, 18],
          opacity_start: 0.5,
          opacity_curve: 2.0,
          duration_pct: 1.0,
        },
      ],
    },
  },

  nuke: {
    trail: {
      color: null, // player color
      opacity: 0.35,
      width: 6,
      blur: 0.15,
      length: 0.12,
      line_style: "solid",
      dash_pattern: [4, 3],
      glow: false,
      glow_color: null,
      glow_width: 8,
      particles: "circle",
      particle_count: 12,
      particle_spacing: 0.008,
      particle_head_size: 5.5,
      particle_decay: 0.35,
      particle_decay_base: 4.5,
      particle_min_size: 2.2,
      particle_color: null,
      particle_scale_decay: 0,
    },
    // NOTE: The nuke icon uses multi-stage scaling driven directly by GameMap.tsx.
    // The values below are stubs and will not be used by the renderer.
    icon: {
      size: 0.28,
      rotate: true,
      ...SHARED_ICON_BASE,
    },
    pulse: {
      enabled: false,
      color: "#ef4444",
      rings: 3,
      radius_base: 8,
      radius_expand: 44,
      start_at: 0.58,
      opacity: 0.75,
    },
    impact_attack: structuredClone(NUKE_IMPACT_ATTACK),
    impact_move: structuredClone(NUKE_IMPACT_ATTACK),
  },
};

/**
 * Set of unit type strings (and kind names) that have an explicit entry in
 * `ANIMATION_DEFAULTS`. Consumers can use this to prefer a unit-type-specific
 * config over the generic animKind fallback.
 */
export const ANIMATION_DEFAULTS_KEYS: Set<string> = new Set(
  Object.keys(ANIMATION_DEFAULTS)
);

// ── Cosmetic slot helpers ─────────────────────────────────────────────────────
//
// Helpers for cosmetic slots that are not part of the per-unit animation
// pipeline but are used in other parts of the game UI (overlays, HUD, etc.).

/**
 * Returns the `vfx_elimination` cosmetic value for the given player cosmetics.
 * Call this when a player eliminates another player to obtain the VFX asset
 * that should be triggered for the eliminating player.
 *
 * Usage (placeholder — VFX rendering not yet implemented):
 *   const vfx = getEliminationVfx(eliminatingPlayer?.cosmetics);
 *   if (vfx) { /* trigger elimination VFX overlay * / }
 */
export function getEliminationVfx(
  playerCosmetics?: Record<string, unknown>
): CosmeticValue | undefined {
  return playerCosmetics?.vfx_elimination as CosmeticValue | undefined;
}

/**
 * Returns the `vfx_victory` cosmetic value for the given player cosmetics.
 * Call this when the local player wins a match to obtain the VFX asset
 * that should be triggered for the victory screen.
 *
 * Usage (placeholder — VFX rendering not yet implemented):
 *   const vfx = getVictoryVfx(myPlayer?.cosmetics);
 *   if (vfx) { /* trigger victory VFX overlay * / }
 */
export function getVictoryVfx(
  playerCosmetics?: Record<string, unknown>
): CosmeticValue | undefined {
  return playerCosmetics?.vfx_victory as CosmeticValue | undefined;
}

// TODO: sound_attack cosmetic - play custom attack sound effect when the player
//   sends an attack. Resolve via playerCosmetics?.sound_attack and pass the URL
//   to the audio subsystem instead of the default attack sound.
// TODO: music_theme cosmetic - play custom background music loop for the player.
//   Resolve via playerCosmetics?.music_theme and swap the active track in
//   useAudio when the match starts and the cosmetic is present.

// ── Deep-merge helper ─────────────────────────────────────────────────────────

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Recursively merge `override` into `base` and return the result.
 * Rules:
 * - Arrays in `override` replace the corresponding array in `base` entirely.
 * - Plain objects are merged recursively (keys missing in `override` keep their
 *   `base` value).
 * - All other primitives from `override` take precedence over `base`.
 * - Neither `base` nor `override` are mutated.
 */
function deepMerge<T>(base: T, override: Partial<T>): T {
  const baseObj = base as PlainObject;
  const overrideObj = override as PlainObject;
  const result: PlainObject = { ...baseObj };

  for (const key of Object.keys(overrideObj)) {
    const overrideVal = overrideObj[key];
    const baseVal = baseObj[key];

    if (overrideVal === undefined) {
      // Key present in override but explicitly undefined — keep base value.
      continue;
    }

    if (Array.isArray(overrideVal)) {
      // Arrays are replaced wholesale.
      result[key] = overrideVal;
    } else if (isPlainObject(overrideVal) && isPlainObject(baseVal)) {
      result[key] = deepMerge(baseVal, overrideVal);
    } else {
      result[key] = overrideVal;
    }
  }

  return result as T;
}

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * A cosmetic entry is either a bare URL string (no animation params) or an
 * object that may carry a `params` bag with partial AnimationConfig overrides.
 */
export type CosmeticValue =
  | string
  | { url?: string | null; params?: Partial<AnimationConfig> };

/**
 * Resolve the final AnimationConfig for a given unit kind + player cosmetics.
 *
 * VFX slot selection (evaluated in order, first match wins):
 *   - If `vfxSlotOverride` is provided:  `playerCosmetics[vfxSlotOverride]`
 *   - Nuke units:  `vfx_nuke` → fallback `vfx_attack`
 *   - Capture:     `vfx_capture`
 *   - Defend:      `vfx_defend`
 *   - Attack:      `vfx_attack`
 *   - Move:        `vfx_move`
 *
 * Player cosmetic params are deep-merged over the kind defaults.
 * Unknown `animKind` values fall back to the "infantry" defaults.
 */
export function resolveAnimConfig(
  animKind: string,
  actionType: "attack" | "move" | "capture" | "defend",
  isNuke: boolean,
  playerCosmetics?: Record<string, CosmeticValue>,
  vfxSlotOverride?: string
): AnimationConfig {
  const base = structuredClone(
    ANIMATION_DEFAULTS[animKind] ?? ANIMATION_DEFAULTS.infantry
  );

  if (!playerCosmetics) return base;

  let vfxEntry: CosmeticValue | undefined;
  if (vfxSlotOverride) {
    vfxEntry = playerCosmetics[vfxSlotOverride];
  } else if (isNuke) {
    vfxEntry = playerCosmetics["vfx_nuke"] ?? playerCosmetics["vfx_attack"];
  } else if (actionType === "capture") {
    vfxEntry = playerCosmetics["vfx_capture"];
  } else if (actionType === "defend") {
    vfxEntry = playerCosmetics["vfx_defend"];
  } else {
    vfxEntry =
      playerCosmetics[actionType === "attack" ? "vfx_attack" : "vfx_move"];
  }

  if (!vfxEntry || typeof vfxEntry === "string") return base;

  const params = vfxEntry.params;
  if (!params) return base;

  return deepMerge(base, params as Partial<AnimationConfig>);
}
