"use client";

import { memo, useMemo, useState } from "react";
import Image from "next/image";
import { X, Lock, ChevronUp } from "lucide-react";
import type { GameRegion, GamePlayer, BuildingQueueItem } from "@/hooks/useGameSocket";
import type { BuildingType, UnitType } from "@/lib/api";
import { getUnitAsset, getPlayerBuildingAsset, getPlayerUnitAsset } from "@/lib/gameAssets";

const PERCENT_PRESETS = [25, 50, 75, 100] as const;

export interface QuickActionBarProps {
  regionId: string;
  region: GameRegion;
  players: Record<string, GamePlayer>;
  myUserId: string;
  myEnergy: number;
  unitPercent: number;
  selectedUnitType: string;
  onPercentChange: (percent: number) => void;
  onUnitTypeChange: (unitType: string) => void;
  onCancel: () => void;
  buildings: BuildingType[];
  buildingQueue: BuildingQueueItem[];
  units: UnitType[];
  onBuild: (buildingType: string) => void;
  onProduceUnit: (unitType: string) => void;
  unlockedBuildings?: string[];
  unlockedUnits?: string[];
  buildingLevels?: Record<string, number>;
}

export default memo(function QuickActionBar({
  regionId,
  region,
  players,
  myUserId,
  myEnergy,
  unitPercent,
  selectedUnitType,
  onPercentChange,
  onUnitTypeChange,
  onCancel,
  buildings,
  buildingQueue,
  units,
  onBuild,
  onProduceUnit,
  unlockedBuildings,
  unlockedUnits,
  buildingLevels,
}: QuickActionBarProps) {
  const isOwned = region.owner_id === myUserId;
  const owner = region.owner_id ? players[region.owner_id] : null;
  const ownerCosmetics = owner?.cosmetics;
  const myCosmetics = players[myUserId]?.cosmetics;
  const hasBuildingLocks = unlockedBuildings != null && unlockedBuildings.length > 0;
  const hasUnitLocks = unlockedUnits != null && unlockedUnits.length > 0;

  const unitConfigMap = useMemo(
    () => new Map(units.map((u) => [u.slug, u])),
    [units]
  );

  const buildingCounts = useMemo(() => {
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
    [buildingQueue, regionId]
  );

  const { buildOptions, producedUnits } = useMemo(() => {
    const buildOpts = [...buildings]
      .filter((b) => !b.requires_coastal || region.is_coastal)
      .filter(
        (b) =>
          (buildingCounts[b.slug] ?? 0) + (queuedBuildingCounts[b.slug] ?? 0) <
          b.max_per_region
      )
      .sort((a, b) => a.order - b.order || a.energy_cost - b.energy_cost);
    const produced = [...units]
      .filter((u) => Boolean(u.produced_by_slug))
      .filter((u) => (buildingCounts[u.produced_by_slug ?? ""] ?? 0) > 0)
      .sort((a, b) => a.order - b.order || a.production_cost - b.production_cost);
    return { buildOptions: buildOpts, producedUnits: produced };
  }, [buildings, units, region.is_coastal, buildingCounts, queuedBuildingCounts]);

  const visibleUnitTypes = useMemo(
    () =>
      Object.entries(region.units ?? {})
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1]),
    [region.units]
  );

  const hasMoveAction = isOwned && visibleUnitTypes.length > 0;
  const hasBuild = isOwned && buildOptions.length > 0;
  const hasProduce = isOwned && producedUnits.length > 0;
  const buildingCount = Object.values(buildingCounts).reduce((s, c) => s + c, 0);

  const [expanded, setExpanded] = useState(false);

  return (
    <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 w-[min(95vw,480px)]">
      <div className="military-frame rounded-2xl border border-border bg-card/95 shadow-lg backdrop-blur-xl overflow-hidden">
        <div className="military-frame-inner">

        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2">
          {owner && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-border"
              style={{ backgroundColor: owner.color }}
            />
          )}
          <span className="min-w-0 flex-1 truncate font-display text-sm sm:text-base font-semibold tracking-wide text-foreground">
            {region.name}
          </span>
          <div className="flex items-center gap-1.5 text-xs sm:text-sm tabular-nums text-muted-foreground shrink-0">
            <Image
              src={getPlayerUnitAsset(
                region.unit_type ?? "default",
                ownerCosmetics,
                unitConfigMap.get(region.unit_type ?? "")?.asset_url
              )}
              alt=""
              width={13}
              height={13}
              className="h-3 w-3 object-contain"
            />
            <span className="font-display font-semibold tabular-nums text-foreground/90">
              {isOwned ? region.unit_count : "?"}
            </span>
            {buildingCount > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="text-primary">⚡</span>
                <span className="font-display font-semibold tabular-nums text-foreground/90">{buildingCount}</span>
              </>
            )}
          </div>
          <button
            onClick={onCancel}
            aria-label="Anuluj"
            className="ml-1 rounded-full border border-border bg-muted/30 p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground shrink-0"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        {/* Action row */}
        {hasMoveAction && (
          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
            <div className="flex items-center gap-1">
              {PERCENT_PRESETS.map((preset) => {
                const active = unitPercent === preset;
                return (
                  <button
                    key={preset}
                    onClick={() => onPercentChange(preset)}
                    className={`rounded-full border px-3 py-2 text-xs sm:text-sm font-semibold tabular-nums transition-colors sm:px-2 sm:py-0.5 ${
                      active
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    {preset === 100 ? "MAX" : `${preset}%`}
                  </button>
                );
              })}
            </div>

            {visibleUnitTypes.length > 0 && (
              <>
                <div className="h-5 w-px bg-border" />
                <div className="flex items-center gap-1 overflow-x-auto">
                  {visibleUnitTypes.map(([unitType, count]) => {
                    const active = unitType === selectedUnitType;
                    return (
                      <button
                        key={unitType}
                        onClick={() => onUnitTypeChange(unitType)}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 transition-colors sm:px-2 sm:py-1 ${
                          active
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
                        }`}
                      >
                        <Image
                          src={getUnitAsset(unitType)}
                          alt={unitType}
                          width={14}
                          height={14}
                          className="h-3.5 w-3.5 object-contain"
                        />
                        <span className={`font-display text-xs sm:text-sm font-semibold tabular-nums ${active ? "text-primary" : "text-foreground/80"}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* Build / Produce rows — collapsible on mobile, always visible on desktop */}
        {(hasBuild || hasProduce) && (
          <>
            {/* Mobile-only toggle */}
            <div className="flex items-center border-t border-border sm:hidden">
              <button
                onClick={() => setExpanded((prev) => !prev)}
                className="flex w-full items-center justify-center gap-2 py-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"
              >
                <ChevronUp className={`h-3 w-3 transition-transform ${expanded ? "" : "rotate-180"}`} />
                {hasBuild && "Buduj"}{hasBuild && hasProduce && " / "}{hasProduce && "Produkuj"}
              </button>
            </div>

            {/* Build row */}
            {hasBuild && (
              <div className={`border-t border-border px-3 py-2 ${expanded ? "block" : "hidden"} sm:block`}>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                  {buildOptions.map((building) => {
                    const isBuildingLocked = hasBuildingLocks && !unlockedBuildings!.includes(building.slug);
                    const typeInstances = instancesByType[building.slug] ?? [];
                    const currentRegionLevel = typeInstances.length > 0
                      ? typeInstances[0].level
                      : region.building_levels?.[building.slug];
                    const playerMaxLevel = buildingLevels?.[building.slug];
                    const isAtMaxLevel = currentRegionLevel != null && playerMaxLevel != null && currentRegionLevel >= playerMaxLevel;
                    const isUpgrade = (currentRegionLevel ?? 0) > 0;
                    const nextLevel = isUpgrade ? (currentRegionLevel ?? 0) + 1 : 1;
                    const nextCost = building.level_stats?.[String(nextLevel)]?.energy_cost ?? building.energy_cost;
                    const asset = getPlayerBuildingAsset(building.asset_key || building.slug, ownerCosmetics, building.asset_url);
                    const canAfford = myEnergy >= nextCost;

                    return (
                      <button
                        key={building.id}
                        onClick={() => !isBuildingLocked && !isAtMaxLevel && onBuild(building.slug)}
                        disabled={!canAfford || isBuildingLocked || isAtMaxLevel === true}
                        className={`inline-flex shrink-0 flex-col items-center gap-0.5 rounded-lg border px-2.5 py-2 transition-colors sm:px-2 sm:py-1.5 ${
                          isBuildingLocked
                            ? "border-red-500/30 bg-red-950/20 opacity-50 cursor-not-allowed"
                            : isAtMaxLevel
                              ? "border-amber-500/30 bg-amber-950/10 cursor-default"
                              : canAfford
                                ? "border-green-500/30 bg-muted/20 hover:bg-green-950/20 hover:border-green-500/50"
                                : "border-red-500/20 bg-muted/20 opacity-60 cursor-not-allowed"
                        }`}
                        title={isBuildingLocked ? "Wymaga blueprintu w decku" : isAtMaxLevel ? `${building.name} — Maksymalny poziom` : canAfford ? `${building.name} (${nextCost}⚡)` : `${building.name} — Brak energii (${nextCost}⚡, masz ${myEnergy}⚡)`}
                      >
                        <div className="relative">
                          {asset && (
                            <Image src={asset} alt="" width={20} height={20} className="h-5 w-5 object-contain" />
                          )}
                          {isBuildingLocked && (
                            <Lock className="absolute -right-1 -top-1 h-2.5 w-2.5 text-muted-foreground" />
                          )}
                        </div>
                        <span className="text-[9px] font-medium text-foreground/60 leading-none">{building.name}</span>
                        {isAtMaxLevel ? (
                          <span className="text-[10px] font-medium text-yellow-300">Max</span>
                        ) : (
                          <div className="flex flex-col items-center gap-0">
                            <div className="flex items-center gap-0.5">
                              <span className="text-[10px] text-primary">⚡</span>
                              <span className={`font-display text-[10px] sm:text-xs font-semibold tabular-nums ${canAfford ? "text-green-400" : "text-red-400"}`}>
                                {nextCost}
                              </span>
                            </div>
                            {isUpgrade && <span className="text-[9px] text-amber-400">Lv{nextLevel}</span>}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Produce row */}
            {hasProduce && (
              <div className={`border-t border-border px-3 py-2 ${expanded ? "block" : "hidden"} sm:block`}>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                  {producedUnits.map((unit) => {
                    const isUnitLocked = hasUnitLocks && Boolean(unit.produced_by_slug) && !unlockedUnits!.includes(unit.slug);
                    const canAfford = myEnergy >= unit.production_cost;
                    const asset = getPlayerUnitAsset(unit.asset_key || unit.slug, myCosmetics, unit.asset_url);

                    return (
                      <button
                        key={unit.id}
                        onClick={() => !isUnitLocked && onProduceUnit(unit.slug)}
                        disabled={!canAfford || isUnitLocked}
                        className={`inline-flex shrink-0 flex-col items-center gap-0.5 rounded-lg border px-2.5 py-2 transition-colors sm:px-2 sm:py-1.5 ${
                          isUnitLocked
                            ? "border-red-500/30 bg-red-950/20 opacity-50 cursor-not-allowed"
                            : canAfford
                              ? "border-green-500/30 bg-muted/20 hover:bg-green-950/20 hover:border-green-500/50"
                              : "border-red-500/20 bg-muted/20 opacity-60 cursor-not-allowed"
                        }`}
                        title={isUnitLocked ? "Wymaga blueprintu w decku" : canAfford ? `${unit.name} (${unit.production_cost}⚡, ${unit.manpower_cost}♟)` : `${unit.name} — Brak energii (${unit.production_cost}⚡, masz ${myEnergy}⚡)`}
                      >
                        <div className="relative">
                          <Image src={asset} alt="" width={20} height={20} className="h-5 w-5 object-contain" />
                          {isUnitLocked && (
                            <Lock className="absolute -right-1 -top-1 h-2.5 w-2.5 text-muted-foreground" />
                          )}
                        </div>
                        <span className="text-[9px] font-medium text-foreground/60 leading-none">{unit.name}</span>
                        {isUnitLocked ? (
                          <Lock className="h-2.5 w-2.5 text-muted-foreground" />
                        ) : (
                          <div className="flex flex-col items-center gap-0">
                            <div className="flex items-center gap-0.5">
                              <span className="text-[10px] text-primary">⚡</span>
                              <span className={`font-display text-[10px] sm:text-xs font-semibold tabular-nums ${canAfford ? "text-green-400" : "text-red-400"}`}>
                                {unit.production_cost}
                              </span>
                            </div>
                            <span className="text-[9px] text-muted-foreground tabular-nums">
                              {unit.manpower_cost > 1 ? `${unit.manpower_cost}♟` : ""}{unit.production_time_ticks > 0 ? ` ${unit.production_time_ticks}t` : ""}
                            </span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  );
});
