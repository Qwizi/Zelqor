import { getAssetUrl, getOverrideUrl } from "./assetOverrides";

export const BUILDING_ASSET_MAP: Record<string, string> = {
  port: "/assets/buildings/svg/port.svg",
  barracks: "/assets/buildings/svg/barracks.svg",
  carrier: "/assets/buildings/svg/airport.svg",
  radar: "/assets/buildings/svg/radar.svg",
  tower: "/assets/buildings/svg/tower.svg",
  factory: "/assets/buildings/svg/factory.svg",
  // legacy fallbacks
  airport: "/assets/buildings/svg/airport.svg",
  navy_port: "/assets/buildings/svg/port.svg",
  power_plant: "/assets/buildings/svg/radar.svg",
  military_base: "/assets/buildings/svg/barracks.svg",
  ironworks: "/assets/buildings/svg/factory.svg",
  mine: "/assets/buildings/svg/factory.svg",
};

export function getBuildingAsset(slug: string | null | undefined, assetUrl?: string | null): string | null {
  if (assetUrl) return assetUrl;
  if (!slug) return null;
  // Check override by slug
  const override = getOverrideUrl(slug);
  if (override) return override;
  return BUILDING_ASSET_MAP[slug] ?? null;
}

export function getUnitAsset(kind: string | null | undefined = "default", assetUrl?: string | null): string {
  if (assetUrl) return assetUrl;
  // Check override by kind key
  const override = getOverrideUrl(kind ?? "default");
  if (override) return override;
  switch (kind) {
    case "moving":
      return "/assets/units/moving.webp";
    case "nuke_rocket":
      return "/assets/units/svg/nuke.svg";
    case "air":
    case "fighter":
      return "/assets/units/svg/fighter.svg";
    case "bomber":
      return "/assets/units/svg/bomber.svg";
    case "ship":
    case "ship_1":
      return "/assets/units/svg/ship.svg";
    case "tank":
    case "ground_unit_sphere":
      return "/assets/units/svg/tank.svg";
    case "infantry":
    case "ground_unit":
      return "/assets/units/svg/infantry.svg";
    case "commando":
      return "/assets/units/svg/commando.svg";
    case "artillery":
      return "/assets/units/svg/artillery.svg";
    case "sam":
      return "/assets/units/svg/sam.svg";
    case "submarine":
      return "/assets/units/svg/submarine.svg";
    default:
      return "/assets/units/svg/infantry.svg";
  }
}

// Slot names for building cosmetics — canonical names used in playerCosmetics.
const BUILDING_SLOT_MAP: Record<string, string> = {
  barracks: "building_barracks",
  factory: "building_factory",
  tower: "building_tower",
  port: "building_port",
  carrier: "building_carrier",
  radar: "building_radar",
};

/**
 * Resolve a building asset with player cosmetic priority.
 * Priority: playerCosmetics[building_<slug>] > global override > fallback
 *
 * The cosmetic slot key is derived from the building type using
 * BUILDING_SLOT_MAP (e.g. "port" → "building_port").  Legacy slugs that are
 * not in the slot map (airport, navy_port, …) skip the cosmetic lookup and go
 * straight to the default asset.
 */
export function getPlayerBuildingAsset(
  slug: string | null | undefined,
  playerCosmetics?: Record<string, unknown>,
  assetUrl?: string | null,
): string | null {
  if (slug && playerCosmetics) {
    const slot = BUILDING_SLOT_MAP[slug];
    if (slot) {
      const v = playerCosmetics[slot];
      if (v) {
        const url =
          typeof v === "string"
            ? v
            : typeof v === "object" && v !== null && "url" in v
              ? ((v as { url?: string | null }).url ?? null)
              : null;
        if (url) return url;
      }
    }
  }
  return getBuildingAsset(slug, assetUrl);
}

// Maps unit kind strings to their canonical cosmetic slot names.
// Aliased kinds (air, bomber, ship_1, ground_unit, …) map to the same slot as
// their canonical counterpart so cosmetics apply consistently.
const UNIT_SLOT_MAP: Record<string, string> = {
  infantry: "unit_infantry",
  ground_unit: "unit_infantry",
  tank: "unit_tank",
  ground_unit_sphere: "unit_tank",
  ship: "unit_ship",
  ship_1: "unit_ship",
  fighter: "unit_fighter",
  air: "unit_fighter",
  bomber: "unit_fighter",
  commando: "unit_infantry",
  artillery: "unit_tank",
  submarine: "unit_ship",
  sam: "unit_tank",
};

/**
 * Resolve a unit asset with player cosmetic priority.
 * Priority: playerCosmetics[unit_<kind>] > global override > fallback
 *
 * The cosmetic slot key is derived from the unit kind using UNIT_SLOT_MAP
 * (e.g. "infantry" → "unit_infantry").  Special/internal kinds (nuke_rocket,
 * moving, …) that are not in the slot map skip the cosmetic lookup.
 */
export function getPlayerUnitAsset(
  kind: string | null | undefined,
  playerCosmetics?: Record<string, unknown>,
  assetUrl?: string | null,
): string {
  if (kind && playerCosmetics) {
    const slot = UNIT_SLOT_MAP[kind];
    if (slot) {
      const v = playerCosmetics[slot];
      if (v) {
        const url =
          typeof v === "string"
            ? v
            : typeof v === "object" && v !== null && "url" in v
              ? ((v as { url?: string | null }).url ?? null)
              : null;
        if (url) return url;
      }
    }
  }
  return getUnitAsset(kind, assetUrl);
}

export function getActionAsset(
  action: "attack" | "move" | "build" | "close" | "defense" | "players",
  unitType?: string | null,
): string {
  const keyMap: Record<string, string> = {
    close: "icon_close",
    build: "icon_building",
    defense: "icon_shield",
    players: "icon_hex",
  };
  if (keyMap[action]) {
    const fallbacks: Record<string, string> = {
      close: "/assets/icons/close_w80.webp",
      build: "/assets/icons/building_icon.webp",
      defense: "/assets/visuals/shield_w100.webp",
      players: "/assets/icons/hex.webp",
    };
    return getAssetUrl(keyMap[action], fallbacks[action]);
  }

  // attack / move: unit-type based logic
  if (unitType === "fighter" || unitType === "bomber") {
    return getAssetUrl("icon_plane_tag", "/assets/units/plane_tag.png");
  }
  if (unitType === "ship" || unitType === "ship_1") {
    return action === "attack"
      ? getAssetUrl("icon_ship_attack", "/assets/units/ships/ship1_colors.png")
      : getAssetUrl("icon_ship_move", "/assets/units/ships/ship1.png");
  }

  return action === "attack"
    ? getAssetUrl("icon_attack", "/assets/icons/attack_icon.webp")
    : getAssetUrl("icon_move", "/assets/visuals/arrow_head_2.webp");
}
