export const BUILDING_ASSET_MAP: Record<string, string> = {
  port: "/assets/buildings/v2/navyport_w300.webp",
  barracks: "/assets/buildings/v2/barracks1_w300.webp",
  carrier: "/assets/buildings/v2/airport_w300.webp",
  radar: "/assets/buildings/v2/powerplant1_w300.webp",
  tower: "/assets/buildings/v2/sentry_w300.webp",
  factory: "/assets/buildings/v2/ironworks_w300.webp",
  // legacy fallbacks
  airport: "/assets/buildings/v2/airport_w300.webp",
  navy_port: "/assets/buildings/v2/navyport_w300.webp",
  power_plant: "/assets/buildings/v2/powerplant1_w300.webp",
  military_base: "/assets/buildings/v2/militarybase_w300.webp",
  ironworks: "/assets/buildings/v2/ironworks_w300.webp",
  mine: "/assets/buildings/v2/mine_w300.webp",
};

export function getBuildingAsset(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return BUILDING_ASSET_MAP[slug] ?? null;
}

export function getUnitAsset(kind: string | null | undefined = "default"): string {
  switch (kind) {
    case "moving":
      return "/assets/units/moving.webp";
    case "nuke_rocket":
      return "/assets/units/nuke_icon.png";
    case "air":
    case "fighter":
    case "bomber":
      return "/assets/units/planes/bomber_h300.webp";
    case "ship":
    case "ship_1":
      return "/assets/units/ships/ship1.png";
    case "tank":
    case "ground_unit_sphere":
      return "/assets/units/ground_unit_sphere_h300.png";
    case "infantry":
    case "ground_unit":
      return "/assets/units/ground_unit.webp";
    default:
      return "/assets/units/ground_unit_sphere_h300.png";
  }
}

export function getActionAsset(
  action: "attack" | "move" | "build" | "close" | "defense" | "players",
  unitType?: string | null
): string {
  if (action === "close") return "/assets/icons/close_w80.webp";
  if (action === "build") return "/assets/icons/building_icon.webp";
  if (action === "defense") return "/assets/visuals/shield_w100.webp";
  if (action === "players") return "/assets/icons/hex.webp";

  if (unitType === "fighter" || unitType === "bomber") {
    return "/assets/units/plane_tag.png";
  }
  if (unitType === "ship" || unitType === "ship_1") {
    return action === "attack"
      ? "/assets/units/ships/ship1_colors.png"
      : "/assets/units/ships/ship1.png";
  }

  return action === "attack"
    ? "/assets/icons/attack_icon.webp"
    : "/assets/visuals/arrow_head_2.webp";
}
