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
});
