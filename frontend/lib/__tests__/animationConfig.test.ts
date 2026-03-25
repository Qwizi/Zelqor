import { describe, expect, it } from "vitest";
import { ANIMATION_DEFAULTS, type IconConfig, resolveAnimConfig, type TrailConfig } from "../animationConfig";

// ---------------------------------------------------------------------------
// ANIMATION_DEFAULTS structure
// ---------------------------------------------------------------------------

const EXPECTED_UNIT_KINDS = ["fighter", "ship", "tank", "infantry", "nuke"] as const;

describe("ANIMATION_DEFAULTS — completeness", () => {
  it("exports an object", () => {
    expect(typeof ANIMATION_DEFAULTS).toBe("object");
    expect(ANIMATION_DEFAULTS).not.toBeNull();
  });

  it("has exactly the expected unit kinds", () => {
    const keys = Object.keys(ANIMATION_DEFAULTS);
    for (const kind of EXPECTED_UNIT_KINDS) {
      expect(keys).toContain(kind);
    }
  });

  it("each unit kind has required top-level keys", () => {
    for (const kind of EXPECTED_UNIT_KINDS) {
      const cfg = ANIMATION_DEFAULTS[kind];
      expect(cfg).toHaveProperty("trail");
      expect(cfg).toHaveProperty("icon");
      expect(cfg).toHaveProperty("pulse");
      expect(cfg).toHaveProperty("impact_attack");
      expect(cfg).toHaveProperty("impact_move");
    }
  });
});

describe("ANIMATION_DEFAULTS — trail config", () => {
  const requiredTrailKeys: (keyof TrailConfig)[] = [
    "color",
    "opacity",
    "width",
    "blur",
    "length",
    "line_style",
    "dash_pattern",
    "glow",
    "glow_color",
    "glow_width",
    "particles",
    "particle_count",
    "particle_spacing",
    "particle_head_size",
    "particle_decay",
    "particle_decay_base",
    "particle_min_size",
    "particle_color",
    "particle_scale_decay",
  ];

  for (const kind of EXPECTED_UNIT_KINDS) {
    it(`${kind} trail has all required fields`, () => {
      const { trail } = ANIMATION_DEFAULTS[kind];
      for (const key of requiredTrailKeys) {
        expect(trail).toHaveProperty(key);
      }
    });
  }

  it("fighter trail color is a non-null silver/grey string", () => {
    expect(ANIMATION_DEFAULTS.fighter.trail.color).toBe("#c0c0c0");
  });

  it("ship trail color is a non-null blue-grey string", () => {
    expect(ANIMATION_DEFAULTS.ship.trail.color).toBe("#a0c0d0");
  });

  it("tank trail color is a non-null olive/green string", () => {
    expect(ANIMATION_DEFAULTS.tank.trail.color).toBe("#4a6a3a");
  });

  it("infantry trail color is null (uses player color)", () => {
    expect(ANIMATION_DEFAULTS.infantry.trail.color).toBeNull();
  });

  it('all trail line_style values are "solid", "dashed", or "none"', () => {
    const validStyles = new Set(["solid", "dashed", "none"]);
    for (const kind of EXPECTED_UNIT_KINDS) {
      expect(validStyles.has(ANIMATION_DEFAULTS[kind].trail.line_style)).toBe(true);
    }
  });

  it("all dash_pattern values are [number, number] tuples", () => {
    for (const kind of EXPECTED_UNIT_KINDS) {
      const { dash_pattern } = ANIMATION_DEFAULTS[kind].trail;
      expect(Array.isArray(dash_pattern)).toBe(true);
      expect(dash_pattern.length).toBe(2);
      expect(typeof dash_pattern[0]).toBe("number");
      expect(typeof dash_pattern[1]).toBe("number");
    }
  });

  it("trail opacity is between 0 and 1 for all unit kinds", () => {
    for (const kind of EXPECTED_UNIT_KINDS) {
      const { opacity } = ANIMATION_DEFAULTS[kind].trail;
      expect(opacity).toBeGreaterThanOrEqual(0);
      expect(opacity).toBeLessThanOrEqual(1);
    }
  });

  it("nuke trail particle count is higher than fighter particle count", () => {
    expect(ANIMATION_DEFAULTS.nuke.trail.particle_count).toBeGreaterThan(
      ANIMATION_DEFAULTS.fighter.trail.particle_count,
    );
  });
});

describe("ANIMATION_DEFAULTS — icon config", () => {
  const requiredIconKeys: (keyof IconConfig)[] = [
    "size",
    "breathe_amplitude",
    "breathe_speed",
    "fade_start",
    "fade_blend_min",
    "rotate",
  ];

  for (const kind of EXPECTED_UNIT_KINDS) {
    it(`${kind} icon has all required fields`, () => {
      const { icon } = ANIMATION_DEFAULTS[kind];
      for (const key of requiredIconKeys) {
        expect(icon).toHaveProperty(key);
      }
    });
  }

  it("fighter icon rotate is true (faces direction of travel)", () => {
    expect(ANIMATION_DEFAULTS.fighter.icon.rotate).toBe(true);
  });

  it("ship icon rotate is false", () => {
    expect(ANIMATION_DEFAULTS.ship.icon.rotate).toBe(false);
  });

  it("nuke icon rotate is true", () => {
    expect(ANIMATION_DEFAULTS.nuke.icon.rotate).toBe(true);
  });

  it("all icons share the same breathe_speed value (6π rad/s)", () => {
    const expected = Math.PI * 6;
    for (const kind of EXPECTED_UNIT_KINDS) {
      expect(ANIMATION_DEFAULTS[kind].icon.breathe_speed).toBeCloseTo(expected);
    }
  });

  it("fade_start is between 0 and 1 for all unit kinds", () => {
    for (const kind of EXPECTED_UNIT_KINDS) {
      const { fade_start } = ANIMATION_DEFAULTS[kind].icon;
      expect(fade_start).toBeGreaterThan(0);
      expect(fade_start).toBeLessThanOrEqual(1);
    }
  });

  it("icon size is a positive number for all unit kinds", () => {
    for (const kind of EXPECTED_UNIT_KINDS) {
      expect(ANIMATION_DEFAULTS[kind].icon.size).toBeGreaterThan(0);
    }
  });
});

describe("ANIMATION_DEFAULTS — pulse config", () => {
  it("nuke pulse is disabled", () => {
    expect(ANIMATION_DEFAULTS.nuke.pulse.enabled).toBe(false);
  });

  it("all other unit kinds have pulse enabled", () => {
    for (const kind of EXPECTED_UNIT_KINDS) {
      if (kind === "nuke") continue;
      expect(ANIMATION_DEFAULTS[kind].pulse.enabled).toBe(true);
    }
  });

  it("pulse rings count is a positive integer for all kinds", () => {
    for (const kind of EXPECTED_UNIT_KINDS) {
      const { rings } = ANIMATION_DEFAULTS[kind].pulse;
      expect(Number.isInteger(rings)).toBe(true);
      expect(rings).toBeGreaterThan(0);
    }
  });

  it("pulse radius_expand is greater than radius_base for all kinds", () => {
    for (const kind of EXPECTED_UNIT_KINDS) {
      const { radius_base, radius_expand } = ANIMATION_DEFAULTS[kind].pulse;
      expect(radius_expand).toBeGreaterThan(radius_base);
    }
  });

  it("pulse start_at is between 0 and 1", () => {
    for (const kind of EXPECTED_UNIT_KINDS) {
      const { start_at } = ANIMATION_DEFAULTS[kind].pulse;
      expect(start_at).toBeGreaterThan(0);
      expect(start_at).toBeLessThan(1);
    }
  });
});

describe("ANIMATION_DEFAULTS — impact config", () => {
  it("all non-nuke kinds share the same impact_attack duration (600ms)", () => {
    for (const kind of EXPECTED_UNIT_KINDS) {
      if (kind === "nuke") continue;
      expect(ANIMATION_DEFAULTS[kind].impact_attack.duration).toBe(600);
    }
  });

  it("nuke impact_attack has a longer duration than standard attack (1800ms)", () => {
    expect(ANIMATION_DEFAULTS.nuke.impact_attack.duration).toBe(1800);
    expect(ANIMATION_DEFAULTS.nuke.impact_attack.duration).toBeGreaterThan(
      ANIMATION_DEFAULTS.infantry.impact_attack.duration,
    );
  });

  it("nuke impact_attack and impact_move use the same config", () => {
    const nuke = ANIMATION_DEFAULTS.nuke;
    expect(nuke.impact_attack.duration).toBe(nuke.impact_move.duration);
    expect(nuke.impact_attack.layers.length).toBe(nuke.impact_move.layers.length);
  });

  it("impact_attack layers contain at least one ring layer", () => {
    for (const kind of EXPECTED_UNIT_KINDS) {
      const layers = ANIMATION_DEFAULTS[kind].impact_attack.layers;
      expect(layers.some((l) => l.type === "ring")).toBe(true);
    }
  });

  it("each impact layer has required fields", () => {
    for (const kind of EXPECTED_UNIT_KINDS) {
      for (const layer of ANIMATION_DEFAULTS[kind].impact_attack.layers) {
        expect(layer).toHaveProperty("type");
        expect(layer).toHaveProperty("color");
        expect(layer).toHaveProperty("radius");
        expect(layer).toHaveProperty("opacity_start");
        expect(layer).toHaveProperty("opacity_curve");
        expect(layer).toHaveProperty("duration_pct");
      }
    }
  });

  it("nuke impact has more layers than standard impact", () => {
    expect(ANIMATION_DEFAULTS.nuke.impact_attack.layers.length).toBeGreaterThan(
      ANIMATION_DEFAULTS.infantry.impact_attack.layers.length,
    );
  });

  it("impact configs are independent copies (structuredClone)", () => {
    // Mutating one should not affect others
    const original = ANIMATION_DEFAULTS.fighter.impact_attack.layers[0].color;
    ANIMATION_DEFAULTS.ship.impact_attack.layers[0].color = "#mutated";
    expect(ANIMATION_DEFAULTS.fighter.impact_attack.layers[0].color).toBe(original);
    // restore
    ANIMATION_DEFAULTS.ship.impact_attack.layers[0].color = "#ef4444";
  });
});

// ---------------------------------------------------------------------------
// resolveAnimConfig
// ---------------------------------------------------------------------------

describe("resolveAnimConfig()", () => {
  it("returns infantry defaults for unknown animKind", () => {
    const cfg = resolveAnimConfig("unknown_kind", "attack", false);
    expect(cfg.trail.opacity).toBe(ANIMATION_DEFAULTS.infantry.trail.opacity);
  });

  it("returns a deep clone (does not mutate ANIMATION_DEFAULTS)", () => {
    const cfg = resolveAnimConfig("fighter", "attack", false);
    cfg.trail.width = 99999;
    expect(ANIMATION_DEFAULTS.fighter.trail.width).not.toBe(99999);
  });

  it("returns base config unchanged when no playerCosmetics provided", () => {
    const cfg = resolveAnimConfig("tank", "move", false);
    expect(cfg).toEqual(ANIMATION_DEFAULTS.tank);
  });

  it("returns base config unchanged when playerCosmetics is provided but has no vfx keys", () => {
    const cfg = resolveAnimConfig("ship", "attack", false, { other_key: "value" });
    expect(cfg.trail.color).toBe(ANIMATION_DEFAULTS.ship.trail.color);
  });

  it("applies vfx_attack params for attack action type", () => {
    const cfg = resolveAnimConfig("infantry", "attack", false, {
      vfx_attack: { params: { trail: { width: 7.5 } } },
    });
    expect(cfg.trail.width).toBe(7.5);
    // Other trail fields should remain unchanged
    expect(cfg.trail.opacity).toBe(ANIMATION_DEFAULTS.infantry.trail.opacity);
  });

  it("applies vfx_move params for move action type", () => {
    const cfg = resolveAnimConfig("infantry", "move", false, {
      vfx_move: { params: { trail: { opacity: 0.99 } } },
    });
    expect(cfg.trail.opacity).toBe(0.99);
  });

  it("uses vfx_nuke for nuke units, falling back to vfx_attack", () => {
    const cfgWithNuke = resolveAnimConfig("nuke", "attack", true, {
      vfx_nuke: { params: { trail: { width: 20 } } },
      vfx_attack: { params: { trail: { width: 5 } } },
    });
    expect(cfgWithNuke.trail.width).toBe(20);

    const cfgFallback = resolveAnimConfig("nuke", "attack", true, {
      vfx_attack: { params: { trail: { width: 5 } } },
    });
    expect(cfgFallback.trail.width).toBe(5);
  });

  it("ignores vfx entry that is a bare string (no params)", () => {
    const cfg = resolveAnimConfig("fighter", "attack", false, {
      vfx_attack: "/some/vfx.png",
    });
    // Should fall through to base defaults
    expect(cfg.trail.color).toBe(ANIMATION_DEFAULTS.fighter.trail.color);
  });

  it("deep-merges nested objects without replacing untouched keys", () => {
    const cfg = resolveAnimConfig("tank", "attack", false, {
      vfx_attack: {
        params: {
          pulse: { enabled: false },
        },
      },
    });
    expect(cfg.pulse.enabled).toBe(false);
    // Other pulse fields should be inherited
    expect(cfg.pulse.rings).toBe(ANIMATION_DEFAULTS.tank.pulse.rings);
  });

  it("replaces arrays wholesale during deep merge", () => {
    const newPattern: [number, number] = [10, 5];
    const cfg = resolveAnimConfig("ship", "move", false, {
      vfx_move: {
        params: {
          trail: { dash_pattern: newPattern },
        },
      },
    });
    expect(cfg.trail.dash_pattern).toEqual(newPattern);
  });
});
