"use client";

import { memo, useMemo, useState } from "react";
import Image from "next/image";
import type { GameRegion, BuildingQueueItem } from "@/hooks/useGameSocket";
import type { BuildingType, UnitType } from "@/lib/api";
import { getBuildingAsset, getActionAsset, getUnitAsset } from "@/lib/gameAssets";
import { Lock } from "lucide-react";

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
  /** Current building levels in this region */
  regionBuildingLevels?: Record<string, number>;
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
  regionBuildingLevels,
}: MobileBuildSheetProps) {
  const [mode, setMode] = useState<SheetMode>(null);
  const hasBuildingLocks = unlockedBuildings != null && unlockedBuildings.length > 0;
  const hasUnitLocks = unlockedUnits != null && unlockedUnits.length > 0;

  const buildingCounts = useMemo(() => region.buildings ?? {}, [region.buildings]);

  const queuedBuildingCounts = useMemo(
    () =>
      buildingQueue
        .filter((item) => item.region_id === regionId)
        .reduce<Record<string, number>>((acc, item) => {
          acc[item.building_type] = (acc[item.building_type] ?? 0) + 1;
          return acc;
        }, {}),
    [buildingQueue, regionId]
  );

  const buildOptions = useMemo(() => {
    return [...buildings]
      .filter((b) => !b.requires_coastal || region.is_coastal)
      .filter(
        (b) =>
          (buildingCounts[b.slug] ?? 0) + (queuedBuildingCounts[b.slug] ?? 0) <
          b.max_per_region
      )
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
            className="flex h-10 w-10 items-center justify-center rounded-full border border-amber-400/20 bg-slate-950/92 shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-colors active:bg-amber-500/20"
          >
            <Image
              src={getActionAsset("build")}
              alt="Buduj"
              width={22}
              height={22}
              className="h-[22px] w-[22px] object-contain"
            />
          </button>
        )}
        {hasProduce && (
          <button
            onClick={() => setMode("produce")}
            title="Produkuj"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-cyan-400/20 bg-slate-950/92 shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-colors active:bg-cyan-500/20"
          >
            <Image
              src={getUnitAsset(region.unit_type ?? "default")}
              alt="Produkuj"
              width={22}
              height={22}
              className="h-[22px] w-[22px] object-contain"
            />
          </button>
        )}
      </div>
    );
  }

  // ── Bottom sheet ──
  const isBuildMode = mode === "build";
  const sheetTitle = isBuildMode ? "Budowa" : "Produkcja jednostek";
  const accentBorder = isBuildMode ? "border-amber-400/15" : "border-cyan-400/15";

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 sm:hidden">
      <div className="fixed inset-0 bg-black/40" onClick={() => setMode(null)} />

      <div className={`relative max-h-[55vh] overflow-y-auto rounded-t-[24px] border-t ${accentBorder} bg-slate-950/95 pb-6 shadow-[0_-16px_48px_rgba(0,0,0,0.5)] backdrop-blur-xl`}>
        <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-950/95 px-4 pb-2 pt-3 backdrop-blur-xl">
          <h4 className={`flex items-center gap-2 text-sm font-medium ${isBuildMode ? "text-amber-400" : "text-cyan-300"}`}>
            <Image
              src={isBuildMode ? getActionAsset("build") : getUnitAsset(region.unit_type ?? "default")}
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
            className="rounded-full p-1.5 text-zinc-400 active:bg-zinc-800"
          >
            <Image
              src={getActionAsset("close")}
              alt=""
              width={14}
              height={14}
              className="h-3.5 w-3.5 object-contain"
            />
          </button>
        </div>

        <div className="px-4 space-y-2">
          {isBuildMode &&
            buildOptions.map((building) => {
              const isBuildingLocked = hasBuildingLocks && !unlockedBuildings!.includes(building.slug);
              const currentRegionLevel = regionBuildingLevels?.[building.slug];
              const playerMaxLevel = buildingLevels?.[building.slug];
              const canUpgrade =
                currentRegionLevel != null &&
                playerMaxLevel != null &&
                currentRegionLevel < playerMaxLevel;
              const isAtMaxLevel =
                currentRegionLevel != null &&
                playerMaxLevel != null &&
                currentRegionLevel >= playerMaxLevel;
              const hasBuilt = (buildingCounts[building.slug] ?? 0) > 0;
              const upgradeLabel = canUpgrade ? `Ulepsz do Lvl ${currentRegionLevel! + 1}` : "Buduj Lvl 1";
              const displayName = hasBuilt && currentRegionLevel != null
                ? `${building.name} Lvl ${currentRegionLevel}`
                : building.name;
              return (
                <button
                  key={building.id}
                  onClick={() => {
                    if (isBuildingLocked || isAtMaxLevel) return;
                    onBuild(building.slug);
                    setMode(null);
                  }}
                  disabled={myEnergy < building.energy_cost || isBuildingLocked || isAtMaxLevel === true}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-amber-400/10 bg-amber-500/10 px-3 py-2.5 text-left transition-colors active:bg-amber-500/20 disabled:opacity-40"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {getBuildingAsset(building.asset_key || building.slug) && (
                      <Image
                        src={getBuildingAsset(building.asset_key || building.slug)!}
                        alt={building.name}
                        width={28}
                        height={28}
                        className="h-7 w-7 shrink-0 object-contain"
                      />
                    )}
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium text-zinc-50">
                        {isBuildingLocked && <Lock className="h-3 w-3 shrink-0 text-zinc-500" />}
                        {displayName}
                      </span>
                      <span className="block text-[11px] text-zinc-500">
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
                    <Lock className="h-4 w-4 text-zinc-600" />
                  ) : isAtMaxLevel ? (
                    <span className="rounded border border-yellow-300/20 bg-yellow-300/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-300">
                      Max
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-zinc-400">
                      <span className="text-[13px] text-cyan-400">⚡</span>
                      {building.energy_cost}
                    </span>
                  )}
                </button>
              );
            })}

          {!isBuildMode &&
            producedUnits.map((unit) => {
              const isUnitLocked = hasUnitLocks && Boolean(unit.produced_by_slug) && !unlockedUnits!.includes(unit.slug);
              return (
                <button
                  key={unit.id}
                  onClick={() => {
                    if (isUnitLocked) return;
                    onProduceUnit(unit.slug);
                    setMode(null);
                  }}
                  disabled={myEnergy < unit.production_cost || isUnitLocked}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-cyan-400/10 bg-cyan-500/10 px-3 py-2.5 text-left transition-colors active:bg-cyan-500/20 disabled:opacity-40"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Image
                      src={getUnitAsset(unit.asset_key || unit.slug)}
                      alt={unit.name}
                      width={24}
                      height={24}
                      className="h-6 w-6 object-contain"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium text-zinc-50">
                        {isUnitLocked && <Lock className="h-3 w-3 shrink-0 text-zinc-500" />}
                        {unit.name}
                      </span>
                      <span className="block text-[11px] text-zinc-500">
                        {isUnitLocked
                          ? "Wymaga blueprintu z talii"
                          : `Zaloga: ${unit.manpower_cost} · ${unit.production_time_ticks} tick`}
                      </span>
                    </span>
                  </span>
                  {isUnitLocked ? (
                    <Lock className="h-4 w-4 text-zinc-600" />
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-zinc-400">
                      <span className="text-[13px] text-cyan-400">⚡</span>
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
