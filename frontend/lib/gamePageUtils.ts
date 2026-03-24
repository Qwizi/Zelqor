import type { UnitType } from "@/lib/api";

export const BOOST_EFFECT_LABELS: Record<string, string> = {
  unit_bonus: "Mobilizacja (+jednostki)",
  defense_bonus: "Fortyfikacja (+obrona)",
  energy_bonus: "Ekonomia (+energia)",
  attack_bonus: "Blitzkrieg (+atak)",
};

export function getUnitRules(units: UnitType[], unitSlug: string | null | undefined) {
  return (
    units.find((unit) => unit.slug === unitSlug) ?? {
      id: "default",
      name: "Infantry",
      slug: "infantry",
      asset_key: "ground_unit",
      description: "",
      icon: "",
      attack: 1,
      defense: 1,
      speed: 1,
      attack_range: 1,
      sea_range: 0,
      sea_hop_distance_km: 0,
      movement_type: "land",
      manpower_cost: 1,
      combat_target: "ground",
      ticks_per_hop: 0,
      air_speed_ticks_per_hop: 0,
    }
  );
}

export function getAnimationPower(unitsConfig: UnitType[], unitType: string | null | undefined, carrierCount: number) {
  const rules = getUnitRules(unitsConfig, unitType);
  const scale = Math.max(1, rules.manpower_cost || 1);
  return carrierCount * scale;
}

export function getAvailableUnits(
  units: Record<string, number> | undefined,
  unitType: string,
  unitConfigBySlug: Record<string, { manpower_cost?: number }>,
): number {
  const raw = units?.[unitType] ?? 0;
  if (unitType !== "infantry") return raw;
  // Subtract infantry reserved as crew for embarked units (tanks, etc.)
  const reserved = Object.entries(units ?? {})
    .filter(([type]) => type !== "infantry")
    .reduce((sum, [type, count]) => {
      const scale = Math.max(1, unitConfigBySlug[type]?.manpower_cost ?? 1);
      return sum + count * scale;
    }, 0);
  return Math.max(0, raw - reserved);
}

export function intOrZero(value: unknown) {
  return typeof value === "number" ? value : Number(value || 0) || 0;
}

export type ReachabilityEntry = {
  moveTargets: Set<string>;
  attackTargets: Set<string>;
  moveDistanceByTarget: Map<string, number>;
  attackDistanceByTarget: Map<string, number>;
};
