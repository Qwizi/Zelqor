import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock assetOverrides — controls getOverrideUrl and getAssetUrl
// ---------------------------------------------------------------------------

const mockGetOverrideUrl = vi.fn((_key: string): string | null => null);
const mockGetAssetUrl = vi.fn((_key: string, fallback: string): string => fallback);

vi.mock("@/lib/assetOverrides", () => ({
  getOverrideUrl: (...args: unknown[]) => mockGetOverrideUrl(...(args as [string])),
  getAssetUrl: (...args: unknown[]) => mockGetAssetUrl(...(args as [string, string])),
}));

import {
  BUILDING_ASSET_MAP,
  getActionAsset,
  getBuildingAsset,
  getPlayerBuildingAsset,
  getPlayerUnitAsset,
  getUnitAsset,
} from "../gameAssets";

// ---------------------------------------------------------------------------
// BUILDING_ASSET_MAP structure
// ---------------------------------------------------------------------------

describe("BUILDING_ASSET_MAP", () => {
  beforeEach(() => {
    mockGetOverrideUrl.mockReturnValue(null);
    mockGetAssetUrl.mockImplementation((_key, fallback) => fallback);
  });

  it("contains all primary building slugs", () => {
    const primarySlugs = ["port", "barracks", "carrier", "radar", "tower", "factory"];
    for (const slug of primarySlugs) {
      expect(BUILDING_ASSET_MAP).toHaveProperty(slug);
    }
  });

  it("contains all legacy fallback slugs", () => {
    const legacySlugs = ["airport", "navy_port", "power_plant", "military_base", "ironworks", "mine"];
    for (const slug of legacySlugs) {
      expect(BUILDING_ASSET_MAP).toHaveProperty(slug);
    }
  });

  it("all values are non-empty strings starting with /assets/", () => {
    for (const [, url] of Object.entries(BUILDING_ASSET_MAP)) {
      expect(typeof url).toBe("string");
      expect(url.startsWith("/assets/")).toBe(true);
    }
  });

  it("carrier and airport share the same asset URL (same file)", () => {
    expect(BUILDING_ASSET_MAP.carrier).toBe(BUILDING_ASSET_MAP.airport);
  });

  it("port and navy_port share the same asset URL", () => {
    expect(BUILDING_ASSET_MAP.port).toBe(BUILDING_ASSET_MAP.navy_port);
  });
});

// ---------------------------------------------------------------------------
// getBuildingAsset
// ---------------------------------------------------------------------------

describe("getBuildingAsset()", () => {
  beforeEach(() => {
    mockGetOverrideUrl.mockReturnValue(null);
    mockGetAssetUrl.mockImplementation((_key, fallback) => fallback);
  });

  it("returns the provided assetUrl directly when non-null", () => {
    const customUrl = "/custom/building.png";
    expect(getBuildingAsset("barracks", customUrl)).toBe(customUrl);
  });

  it("returns null when slug is null and no assetUrl provided", () => {
    expect(getBuildingAsset(null)).toBeNull();
  });

  it("returns null when slug is undefined and no assetUrl provided", () => {
    expect(getBuildingAsset(undefined)).toBeNull();
  });

  it("returns mapped URL for a known slug", () => {
    const url = getBuildingAsset("barracks");
    expect(url).toBe(BUILDING_ASSET_MAP.barracks);
  });

  it("returns null for an unknown slug with no override", () => {
    expect(getBuildingAsset("nonexistent_building")).toBeNull();
  });

  it("returns the override URL when getOverrideUrl returns a value", () => {
    mockGetOverrideUrl.mockReturnValue("/override/barracks.png");
    expect(getBuildingAsset("barracks")).toBe("/override/barracks.png");
  });

  it("returns assetUrl even when an override exists (assetUrl takes priority)", () => {
    mockGetOverrideUrl.mockReturnValue("/override/barracks.png");
    expect(getBuildingAsset("barracks", "/explicit.png")).toBe("/explicit.png");
  });
});

// ---------------------------------------------------------------------------
// getUnitAsset
// ---------------------------------------------------------------------------

describe("getUnitAsset()", () => {
  beforeEach(() => {
    mockGetOverrideUrl.mockReturnValue(null);
    mockGetAssetUrl.mockImplementation((_key, fallback) => fallback);
  });

  it("returns assetUrl directly when provided", () => {
    expect(getUnitAsset("tank", "/custom/tank.png")).toBe("/custom/tank.png");
  });

  it("returns infantry svg asset for default/unknown kind", () => {
    expect(getUnitAsset()).toContain("infantry");
    expect(getUnitAsset("unknown_kind")).toContain("infantry");
  });

  it('returns moving asset for "moving" kind', () => {
    expect(getUnitAsset("moving")).toBe("/assets/units/moving.webp");
  });

  it('returns nuke svg icon for "nuke_rocket" kind', () => {
    expect(getUnitAsset("nuke_rocket")).toContain("nuke");
  });

  it('returns fighter svg asset for "fighter" kind', () => {
    expect(getUnitAsset("fighter")).toContain("fighter");
  });

  it('returns bomber svg asset for "bomber" kind (different from fighter)', () => {
    expect(getUnitAsset("bomber")).toContain("bomber");
  });

  it('returns fighter svg asset for "air" kind (same as fighter)', () => {
    expect(getUnitAsset("air")).toBe(getUnitAsset("fighter"));
  });

  it('returns ship asset for "ship" kind', () => {
    expect(getUnitAsset("ship")).toContain("ship");
  });

  it('returns ship asset for "ship_1" kind (same as ship)', () => {
    expect(getUnitAsset("ship_1")).toBe(getUnitAsset("ship"));
  });

  it('returns tank svg asset for "tank" and "ground_unit_sphere" kinds', () => {
    expect(getUnitAsset("tank")).toContain("tank");
    expect(getUnitAsset("ground_unit_sphere")).toBe(getUnitAsset("tank"));
  });

  it('returns infantry svg asset for "infantry" kind', () => {
    expect(getUnitAsset("infantry")).toContain("infantry");
  });

  it("returns override when getOverrideUrl returns a value", () => {
    mockGetOverrideUrl.mockReturnValue("/override/unit.png");
    expect(getUnitAsset("infantry")).toBe("/override/unit.png");
  });
});

// ---------------------------------------------------------------------------
// getPlayerBuildingAsset
// ---------------------------------------------------------------------------

describe("getPlayerBuildingAsset()", () => {
  beforeEach(() => {
    mockGetOverrideUrl.mockReturnValue(null);
    mockGetAssetUrl.mockImplementation((_key, fallback) => fallback);
  });

  it("returns string cosmetic URL when playerCosmetics has entry for the slot key", () => {
    // Cosmetic slot for "barracks" is "building_barracks"
    const cosmetics = { building_barracks: "/cosmetic/barracks.png" };
    expect(getPlayerBuildingAsset("barracks", cosmetics)).toBe("/cosmetic/barracks.png");
  });

  it('returns object cosmetic url when playerCosmetics entry is { url: "..." }', () => {
    const cosmetics = { building_barracks: { url: "/cosmetic/barracks_obj.png" } };
    expect(getPlayerBuildingAsset("barracks", cosmetics)).toBe("/cosmetic/barracks_obj.png");
  });

  it("falls through to getBuildingAsset when playerCosmetics has no entry for slot", () => {
    const cosmetics = { other: "/cosmetic/other.png" };
    expect(getPlayerBuildingAsset("barracks", cosmetics)).toBe(BUILDING_ASSET_MAP.barracks);
  });

  it("falls through to getBuildingAsset when playerCosmetics is undefined", () => {
    expect(getPlayerBuildingAsset("barracks", undefined)).toBe(BUILDING_ASSET_MAP.barracks);
  });

  it("returns null for unknown slug with no cosmetics", () => {
    expect(getPlayerBuildingAsset("ghost_slug")).toBeNull();
  });

  it("cosmetic takes priority over assetUrl when cosmetic slot is set", () => {
    // Cosmetic slot key is checked before falling through to getBuildingAsset(assetUrl)
    const cosmetics = { building_barracks: "/cosmetic/barracks.png" };
    // cosmetic wins because it is checked before assetUrl delegation
    expect(getPlayerBuildingAsset("barracks", cosmetics, "/explicit.png")).toBe("/cosmetic/barracks.png");
  });
});

// ---------------------------------------------------------------------------
// getPlayerUnitAsset
// ---------------------------------------------------------------------------

describe("getPlayerUnitAsset()", () => {
  beforeEach(() => {
    mockGetOverrideUrl.mockReturnValue(null);
    mockGetAssetUrl.mockImplementation((_key, fallback) => fallback);
  });

  it("returns string cosmetic URL for the resolved kind via slot key", () => {
    // Cosmetic slot for "tank" is "unit_tank"
    const cosmetics = { unit_tank: "/cosmetic/tank.png" };
    expect(getPlayerUnitAsset("tank", cosmetics)).toBe("/cosmetic/tank.png");
  });

  it("falls back to getUnitAsset when no cosmetic entry for kind", () => {
    expect(getPlayerUnitAsset("infantry", {})).toBe(getUnitAsset("infantry"));
  });

  it("falls back to getUnitAsset when kind is null", () => {
    // kind=null has no slot in UNIT_SLOT_MAP, falls through to getUnitAsset(null)
    expect(getPlayerUnitAsset(null, {})).toBe(getUnitAsset(null));
  });
});

// ---------------------------------------------------------------------------
// getActionAsset
// ---------------------------------------------------------------------------

describe("getActionAsset()", () => {
  beforeEach(() => {
    mockGetOverrideUrl.mockReturnValue(null);
    // Return fallback directly for assertion clarity
    mockGetAssetUrl.mockImplementation((_key, fallback) => fallback);
  });

  it('returns close icon asset for "close" action', () => {
    const url = getActionAsset("close");
    expect(url).toContain("close");
  });

  it('returns build icon asset for "build" action', () => {
    const url = getActionAsset("build");
    expect(url).toContain("building");
  });

  it('returns defense icon asset for "defense" action', () => {
    const url = getActionAsset("defense");
    expect(url).toContain("shield");
  });

  it('returns players icon asset for "players" action', () => {
    const url = getActionAsset("players");
    expect(url).toContain("hex");
  });

  it('returns plane tag for "attack" with fighter unit type', () => {
    const url = getActionAsset("attack", "fighter");
    expect(url).toContain("plane");
  });

  it('returns plane tag for "move" with bomber unit type', () => {
    const url = getActionAsset("move", "bomber");
    expect(url).toContain("plane");
  });

  it('returns ship attack asset for "attack" with ship unit type', () => {
    const url = getActionAsset("attack", "ship");
    expect(url).toContain("ship");
  });

  it('returns ship move asset for "move" with ship unit type', () => {
    const url = getActionAsset("move", "ship");
    expect(url).toContain("ship");
  });

  it('returns generic attack icon for "attack" with ground unit', () => {
    const url = getActionAsset("attack", "infantry");
    expect(url).toContain("attack");
  });

  it('returns generic move icon for "move" with ground unit', () => {
    const url = getActionAsset("move", "infantry");
    expect(url).toContain("arrow");
  });

  it('returns generic attack icon for "attack" with no unit type', () => {
    const url = getActionAsset("attack");
    expect(url).toContain("attack");
  });

  it('returns generic attack icon for "attack" with "air" unit type (not fighter/bomber)', () => {
    const url = getActionAsset("attack", "air");
    expect(url).toContain("attack");
  });

  it('returns ship_1 move asset for "move" with "ship_1" unit type', () => {
    const url = getActionAsset("move", "ship_1");
    expect(url).toContain("ship");
  });

  it('returns ship_1 attack asset for "attack" with "ship_1" unit type', () => {
    const url = getActionAsset("attack", "ship_1");
    expect(url).toContain("ship");
  });
});

// ---------------------------------------------------------------------------
// getPlayerUnitAsset — additional edge cases
// ---------------------------------------------------------------------------

describe("getPlayerUnitAsset() — additional", () => {
  beforeEach(() => {
    mockGetOverrideUrl.mockReturnValue(null);
    mockGetAssetUrl.mockImplementation((_key, fallback) => fallback);
  });

  it('returns object cosmetic url when playerCosmetics entry is { url: "..." }', () => {
    const cosmetics = { unit_tank: { url: "/cosmetic/tank_obj.png" } };
    expect(getPlayerUnitAsset("tank", cosmetics)).toBe("/cosmetic/tank_obj.png");
  });

  it("falls back to getUnitAsset when cosmetic object has null url", () => {
    const cosmetics = { unit_tank: { url: null } };
    expect(getPlayerUnitAsset("tank", cosmetics)).toBe(getUnitAsset("tank"));
  });

  it("falls back to getUnitAsset when cosmetic object has no url key", () => {
    const cosmetics = { unit_tank: { other: "value" } };
    expect(getPlayerUnitAsset("tank", cosmetics)).toBe(getUnitAsset("tank"));
  });

  it("cosmetic slot mapped for 'ground_unit' (alias for infantry)", () => {
    const cosmetics = { unit_infantry: "/cosmetic/infantry.png" };
    expect(getPlayerUnitAsset("ground_unit", cosmetics)).toBe("/cosmetic/infantry.png");
  });

  it("cosmetic slot mapped for 'ground_unit_sphere' (alias for tank)", () => {
    const cosmetics = { unit_tank: "/cosmetic/tank_alias.png" };
    expect(getPlayerUnitAsset("ground_unit_sphere", cosmetics)).toBe("/cosmetic/tank_alias.png");
  });

  it("cosmetic slot mapped for 'air' (alias for fighter)", () => {
    const cosmetics = { unit_fighter: "/cosmetic/air.png" };
    expect(getPlayerUnitAsset("air", cosmetics)).toBe("/cosmetic/air.png");
  });

  it("cosmetic slot mapped for 'ship_1' (alias for ship)", () => {
    const cosmetics = { unit_ship: "/cosmetic/ship1.png" };
    expect(getPlayerUnitAsset("ship_1", cosmetics)).toBe("/cosmetic/ship1.png");
  });

  it("cosmetic slot mapped for 'bomber' (alias for fighter slot)", () => {
    const cosmetics = { unit_fighter: "/cosmetic/bomber_skin.png" };
    expect(getPlayerUnitAsset("bomber", cosmetics)).toBe("/cosmetic/bomber_skin.png");
  });

  it("cosmetic slot mapped for 'commando' (alias for infantry slot)", () => {
    const cosmetics = { unit_infantry: "/cosmetic/commando.png" };
    expect(getPlayerUnitAsset("commando", cosmetics)).toBe("/cosmetic/commando.png");
  });

  it("cosmetic slot mapped for 'artillery' (alias for tank slot)", () => {
    const cosmetics = { unit_tank: "/cosmetic/artillery.png" };
    expect(getPlayerUnitAsset("artillery", cosmetics)).toBe("/cosmetic/artillery.png");
  });

  it("cosmetic slot mapped for 'submarine' (alias for ship slot)", () => {
    const cosmetics = { unit_ship: "/cosmetic/sub.png" };
    expect(getPlayerUnitAsset("submarine", cosmetics)).toBe("/cosmetic/sub.png");
  });

  it("cosmetic slot mapped for 'sam' (alias for tank slot)", () => {
    const cosmetics = { unit_tank: "/cosmetic/sam.png" };
    expect(getPlayerUnitAsset("sam", cosmetics)).toBe("/cosmetic/sam.png");
  });

  it("falls back for special units without slot (nuke_rocket)", () => {
    const cosmetics = { unit_infantry: "/cosmetic/nuke.png" };
    // nuke_rocket is not in UNIT_SLOT_MAP → falls through to getUnitAsset
    expect(getPlayerUnitAsset("nuke_rocket", cosmetics)).toBe(getUnitAsset("nuke_rocket"));
  });

  it("falls back for special units without slot (moving)", () => {
    const cosmetics = { unit_infantry: "/cosmetic/moving.png" };
    expect(getPlayerUnitAsset("moving", cosmetics)).toBe(getUnitAsset("moving"));
  });

  it("returns assetUrl when provided even with cosmetics", () => {
    const cosmetics = { unit_tank: "/cosmetic/tank.png" };
    // assetUrl is passed to getUnitAsset as fallback — cosmetic wins unless assetUrl is checked first
    // Actually getPlayerUnitAsset checks slot FIRST, then assetUrl is passed to getUnitAsset
    // If cosmetic slot match: return cosmetic. Otherwise: return getUnitAsset(kind, assetUrl)
    const result = getPlayerUnitAsset("tank", cosmetics, "/explicit.png");
    // cosmetic takes priority
    expect(result).toBe("/cosmetic/tank.png");
  });

  it("uses assetUrl when no cosmetic slot matches", () => {
    const cosmetics = {};
    expect(getPlayerUnitAsset("tank", cosmetics, "/explicit-tank.png")).toBe("/explicit-tank.png");
  });
});

// ---------------------------------------------------------------------------
// getPlayerBuildingAsset — additional edge cases
// ---------------------------------------------------------------------------

describe("getPlayerBuildingAsset() — additional", () => {
  beforeEach(() => {
    mockGetOverrideUrl.mockReturnValue(null);
    mockGetAssetUrl.mockImplementation((_key, fallback) => fallback);
  });

  it("falls through for legacy slug with no slot in BUILDING_SLOT_MAP", () => {
    // "airport" is legacy and not in BUILDING_SLOT_MAP
    const cosmetics = { building_carrier: "/cosmetic/carrier.png" };
    // airport has no slot → falls through to getBuildingAsset("airport")
    expect(getPlayerBuildingAsset("airport", cosmetics)).toBe("/assets/buildings/svg/airport.svg");
  });

  it("cosmetic object with null url falls through to getBuildingAsset", () => {
    const cosmetics = { building_barracks: { url: null } };
    expect(getPlayerBuildingAsset("barracks", cosmetics)).toBe(BUILDING_ASSET_MAP.barracks);
  });

  it("all building types in BUILDING_SLOT_MAP resolve cosmetics correctly", () => {
    const slotMap: Record<string, string> = {
      barracks: "building_barracks",
      factory: "building_factory",
      tower: "building_tower",
      port: "building_port",
      carrier: "building_carrier",
      radar: "building_radar",
    };
    for (const [slug, slot] of Object.entries(slotMap)) {
      const cosmetics = { [slot]: `/cosmetic/${slug}.png` };
      expect(getPlayerBuildingAsset(slug, cosmetics)).toBe(`/cosmetic/${slug}.png`);
    }
  });

  it("returns null for null slug with cosmetics provided", () => {
    expect(getPlayerBuildingAsset(null, { building_barracks: "/some.png" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getUnitAsset — additional edge cases
// ---------------------------------------------------------------------------

describe("getUnitAsset() — additional", () => {
  beforeEach(() => {
    mockGetOverrideUrl.mockReturnValue(null);
    mockGetAssetUrl.mockImplementation((_key, fallback) => fallback);
  });

  it('returns commando svg for "commando" kind', () => {
    expect(getUnitAsset("commando")).toContain("commando");
  });

  it('returns artillery svg for "artillery" kind', () => {
    expect(getUnitAsset("artillery")).toContain("artillery");
  });

  it('returns sam svg for "sam" kind', () => {
    expect(getUnitAsset("sam")).toContain("sam");
  });

  it('returns submarine svg for "submarine" kind', () => {
    expect(getUnitAsset("submarine")).toContain("submarine");
  });

  it("returns infantry fallback for null kind", () => {
    expect(getUnitAsset(null)).toContain("infantry");
  });

  it("returns infantry fallback for empty string kind", () => {
    expect(getUnitAsset("")).toContain("infantry");
  });
});
