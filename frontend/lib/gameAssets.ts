export const BUILDING_ASSET_MAP: Record<string, string> = {
  airport: "/assets/buildings/airport.png",
  hospital: "/assets/buildings/hospital.png",
  ironworks: "/assets/buildings/ironworks.png",
  military_base: "/assets/buildings/military_base.png",
  navy_port: "/assets/buildings/navy_port.png",
  power_plant: "/assets/buildings/power_plant.png",
  ratusz: "/assets/buildings/ratusz.png",
  tartak: "/assets/buildings/navy_port.png",
  barracks: "/assets/buildings/military_base.png",
  factory: "/assets/buildings/ironworks.png",
  tower: "/assets/buildings/ratusz.png",
  port: "/assets/buildings/navy_port.png",
  carrier: "/assets/buildings/airport.png",
  radar: "/assets/buildings/power_plant.png",
};

export function getBuildingAsset(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return BUILDING_ASSET_MAP[slug] ?? null;
}

export function getUnitAsset(
  kind:
    | "default"
    | "moving"
    | "air"
    | "infantry"
    | "tank"
    | "ship"
    | "fighter"
    | "ground_unit"
    | "ground_unit_sphere"
    | "ship_1"
    | "bomber" = "default"
): string {
  switch (kind) {
    case "moving":
      return "/assets/units/moving.webp";
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
  if (action === "defense") return "/assets/abilities/ab_shield.webp";
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
    ? "/assets/visuals/arrow_head.webp"
    : "/assets/visuals/arrow_head_2.webp";
}
