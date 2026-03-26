"use client";

import { Lock } from "lucide-react";
import Image from "next/image";
import { memo, useMemo, useState } from "react";
import type { BuildingQueueItem, GameRegion } from "@/hooks/useGameSocket";
import type { BuildingType, UnitType } from "@/lib/api";
import { getActionAsset, getPlayerBuildingAsset, getPlayerUnitAsset } from "@/lib/gameAssets";

type SheetMode = null | "build" | "produce";

interface MobileBuildSheetProps {
  region: GameRegion;
  regionId: string;
  myEnergy: number;
  buildings: BuildingType[];
  buildingQueue: BuildingQueueItem[];
  units: UnitType[];
  onBuild: (buildingType: string) => void;
  onProduceUnit: (unitType: string) => void;
  /** When non-empty, buildings not in this list show a lock icon and are disabled */
  unlockedBuildings?: string[];
  /** When non-empty, units not in this list (and with produced_by_slug) show a lock icon and are disabled */
  unlockedUnits?: string[];
  /** Player's max buildable levels from their deck */
  buildingLevels?: Record<string, number>;
  myCosmetics?: Record<string, unknown>;
}

export default memo(function MobileBuildSheet({
  region,
  regionId,
  myEnergy,
  buildings,
  buildingQueue,
  units,
  onBuild,
  onProduceUnit,
  unlockedBuildings,
  unlockedUnits,
  buildingLevels,
  myCosmetics,
}: MobileBuildSheetProps) {
  const [mode, setMode] = useState<SheetMode>(null);
  const unitConfigMap = useMemo(() => new Map(units.map((u) => [u.slug, u])), [units]);
  const hasBuildingLocks = unlockedBuildings != null && unlockedBuildings.length > 0;
  const hasUnitLocks = unlockedUnits != null && unlockedUnits.length > 0;

  const buildingCounts = useMemo(() => {
    // Prefer building_instances (new engine format); fall back to legacy buildings HashMap
    if (region.building_instances && region.building_instances.length > 0) {
      const counts: Record<string, number> = {};
      for (const inst of region.building_instances) {
        counts[inst.building_type] = (counts[inst.building_type] ?? 0) + 1;
      }
      return counts;
    }
    return region.buildings ?? {};
  }, [region.building_instances, region.buildings]);

  const instancesByType = useMemo(() => {
    const map: Record<string, Array<{ building_type: string; level: number }>> = {};
    for (const inst of region.building_instances ?? []) {
      (map[inst.building_type] ??= []).push(inst);
    }
    for (const arr of Object.values(map)) arr.sort((a, b) => a.level - b.level);
    return map;
  }, [region.building_instances]);

  const queuedBuildingCounts = useMemo(
    () =>
      buildingQueue
        .filter((item) => item.region_id === regionId)
        .reduce<Record<string, number>>((acc, item) => {
          acc[item.building_type] = (acc[item.building_type] ?? 0) + 1;
          return acc;
        }, {}),
    [buildingQueue, regionId],
  );

  const buildOptions = useMemo(() => {
    return [...buildings]
      .filter((b) => !b.requires_coastal || region.is_coastal)
      .filter((b) => (buildingCounts[b.slug] ?? 0) + (queuedBuildingCounts[b.slug] ?? 0) < b.max_per_region)
      .sort((a, b) => a.order - b.order || a.energy_cost - b.energy_cost || a.name.localeCompare(b.name));
  }, [buildings, region.is_coastal, buildingCounts, queuedBuildingCounts]);

  const producedUnits = useMemo(() => {
    return [...units]
      .filter((u) => Boolean(u.produced_by_slug))
      .filter((u) => (buildingCounts[u.produced_by_slug ?? ""] ?? 0) > 0)
      .sort((a, b) => a.order - b.order || a.production_cost - b.production_cost || a.name.localeCompare(b.name));
  }, [units, buildingCounts]);

  const hasBuild = buildOptions.length > 0;
  const hasProduce = producedUnits.length > 0;
  if (!hasBuild && !hasProduce) return null;

  // ── Floating buttons (left side, mid-screen) ──
  if (mode === null) {
    return (
      <div className="fixed bottom-[220px] left-3 z-30 flex flex-col gap-2 sm:hidden">
        {hasBuild && (
          <button
            onClick={() => setMode("build")}
            title="Buduj"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-accent/20 bg-card shadow-lg transition-colors active:bg-accent/20"
          >
            <Image
              src={getActionAsset("build")}
              alt="Buduj"
              width={18}
              height={18}
              className="h-[18px] w-[18px] object-contain"
            />
          </button>
        )}
        {hasProduce && (
          <button
            onClick={() => setMode("produce")}
            title="Produkuj"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/20 bg-card shadow-lg transition-colors active:bg-primary/20"
          >
            <Image
              src={getPlayerUnitAsset(
                region.unit_type ?? "default",
                myCosmetics,
                unitConfigMap.get(region.unit_type ?? "")?.asset_url,
              )}
              alt="Produkuj"
              width={18}
              height={18}
              className="h-[18px] w-[18px] object-contain"
            />
          </button>
        )}
      </div>
    );
  }

  // ── Bottom sheet ──
  const isBuildMode = mode === "build";
  const sheetTitle = isBuildMode ? "Budowa" : "Produkcja jednostek";
  const accentBorder = isBuildMode ? "border-accent/15" : "border-primary/15";

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 sm:hidden">
      <div className="fixed inset-0 bg-background/60" onClick={() => setMode(null)} />

      <div
        className={`relative max-h-[45vh] overflow-y-auto rounded-t-[18px] border-t ${accentBorder} bg-card pb-4 shadow-lg`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between bg-card px-4 pb-1.5 pt-2.5">
          <h4 className={`flex items-center gap-2 text-sm font-medium ${isBuildMode ? "text-accent" : "text-primary"}`}>
            <Image
              src={
                isBuildMode ? getActionAsset("build") : getPlayerUnitAsset(region.unit_type ?? "default", myCosmetics)
              }
              alt=""
              width={16}
              height={16}
              className="h-4 w-4 object-contain"
            />
            {sheetTitle} · {region.name}
          </h4>
          <button
            onClick={() => setMode(null)}
            aria-label="Zamknij"
            className="rounded-full p-1.5 text-muted-foreground active:bg-secondary"
          >
            <Image src={getActionAsset("close")} alt="" width={14} height={14} className="h-3.5 w-3.5 object-contain" />
          </button>
        </div>

        <div className="px-4 space-y-1.5">
          {isBuildMode &&
            buildOptions.map((building) => {
              const isBuildingLocked = hasBuildingLocks && !unlockedBuildings?.includes(building.slug);
              // Derive the minimum level instance for this building type (weakest = first to upgrade)
              const typeInstances = instancesByType[building.slug] ?? [];
              const currentRegionLevel =
                typeInstances.length > 0 ? typeInstances[0].level : region.building_levels?.[building.slug];
              const playerMaxLevel = buildingLevels?.[building.slug];
              const canUpgrade =
                currentRegionLevel != null && playerMaxLevel != null && currentRegionLevel < playerMaxLevel;
              const isAtMaxLevel =
                currentRegionLevel != null && playerMaxLevel != null && currentRegionLevel >= playerMaxLevel;
              const hasBuilt = (buildingCounts[building.slug] ?? 0) > 0;
              const upgradeLabel = canUpgrade
                ? `Ulepsz do Lvl ${currentRegionLevel! + 1}${typeInstances.length > 1 ? ` (najslabsza: Lvl ${currentRegionLevel})` : ""}`
                : "Buduj Lvl 1";
              const displayName =
                hasBuilt && currentRegionLevel != null ? `${building.name} Lvl ${currentRegionLevel}` : building.name;
              const isUpgrade = (currentRegionLevel ?? 0) > 0;
              const nextLevel = isUpgrade ? (currentRegionLevel ?? 0) + 1 : 1;
              const nextCost = building.level_stats?.[String(nextLevel)]?.energy_cost ?? building.energy_cost;
              return (
                <button
                  key={building.id}
                  onClick={() => {
                    if (isBuildingLocked || isAtMaxLevel) return;
                    onBuild(building.slug);
                    setMode(null);
                  }}
                  disabled={myEnergy < nextCost || isBuildingLocked || isAtMaxLevel === true}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-accent/10 bg-accent/10 px-2.5 py-2 text-left transition-colors active:bg-accent/20 disabled:opacity-40"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {getPlayerBuildingAsset(building.asset_key || building.slug, myCosmetics, building.asset_url) && (
                      <Image
                        src={
                          getPlayerBuildingAsset(building.asset_key || building.slug, myCosmetics, building.asset_url)!
                        }
                        alt={building.name}
                        width={24}
                        height={24}
                        className="h-6 w-6 shrink-0 object-contain"
                      />
                    )}
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                        {isBuildingLocked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                        {displayName}
                      </span>
                      <span className="block text-label text-muted-foreground">
                        {isBuildingLocked
                          ? "Wymaga blueprintu z talii"
                          : isAtMaxLevel
                            ? "Max"
                            : canUpgrade
                              ? upgradeLabel
                              : `${(buildingCounts[building.slug] ?? 0) + (queuedBuildingCounts[building.slug] ?? 0)}/${building.max_per_region}`}
                      </span>
                    </span>
                  </span>
                  {isBuildingLocked ? (
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  ) : isAtMaxLevel ? (
                    <span className="rounded border border-yellow-300/20 bg-yellow-300/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-300">
                      Max
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="text-[13px] text-primary">⚡</span>
                      {nextCost}
                    </span>
                  )}
                </button>
              );
            })}

          {!isBuildMode &&
            producedUnits.map((unit) => {
              const isUnitLocked =
                hasUnitLocks && Boolean(unit.produced_by_slug) && !unlockedUnits?.includes(unit.slug);
              return (
                <button
                  key={unit.id}
                  onClick={() => {
                    if (isUnitLocked) return;
                    onProduceUnit(unit.slug);
                    setMode(null);
                  }}
                  disabled={myEnergy < unit.production_cost || isUnitLocked}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-primary/10 bg-primary/10 px-2.5 py-2 text-left transition-colors active:bg-primary/20 disabled:opacity-40"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Image
                      src={getPlayerUnitAsset(unit.asset_key || unit.slug, myCosmetics, unit.asset_url)}
                      alt={unit.name}
                      width={20}
                      height={20}
                      className="h-5 w-5 object-contain"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                        {isUnitLocked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                        {unit.name}
                      </span>
                      <span className="block text-label text-muted-foreground">
                        {isUnitLocked
                          ? "Wymaga blueprintu z talii"
                          : `Zaloga: ${unit.manpower_cost} · ${unit.production_time_ticks} tick`}
                      </span>
                    </span>
                  </span>
                  {isUnitLocked ? (
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="text-[13px] text-primary">⚡</span>
                      {unit.production_cost}
                    </span>
                  )}
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
});
