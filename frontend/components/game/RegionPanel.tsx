"use client";

import { memo, useMemo, useState } from "react";
import Image from "next/image";
import type { GameRegion, GamePlayer, BuildingQueueItem } from "@/hooks/useGameSocket";
import type { BuildingType, UnitType } from "@/lib/api";
import { getActionAsset, getPlayerBuildingAsset, getPlayerUnitAsset } from "@/lib/gameAssets";
import { Badge } from "@/components/ui/badge";
import { Lock, X, Hammer, Swords as SwordsIcon, Info, Timer, AlertTriangle } from "lucide-react";

interface RegionPanelProps {
  regionId: string;
  region: GameRegion;
  players: Record<string, GamePlayer>;
  myUserId: string;
  myEnergy: number;
  currentTick?: number;
  buildings: BuildingType[];
  buildingQueue: BuildingQueueItem[];
  units: UnitType[];
  onBuild: (buildingType: string) => void;
  onProduceUnit: (unitType: string) => void;
  onClose: () => void;
  unlockedBuildings?: string[];
  unlockedUnits?: string[];
  buildingLevels?: Record<string, number>;
}

type TabId = "info" | "build" | "produce";

export default memo(function RegionPanel({
  regionId,
  region,
  players,
  myUserId,
  myEnergy,
  currentTick = 0,
  buildings,
  buildingQueue,
  units,
  onBuild,
  onProduceUnit,
  onClose,
  unlockedBuildings,
  unlockedUnits,
  buildingLevels,
}: RegionPanelProps) {
  const hasBuildingLocks = unlockedBuildings != null && unlockedBuildings.length > 0;
  const hasUnitLocks = unlockedUnits != null && unlockedUnits.length > 0;
  const isOwned = region.owner_id === myUserId;
  const owner = region.owner_id ? players[region.owner_id] : null;
  const ownerCosmetics = owner?.cosmetics;
  const myCosmetics = players[myUserId]?.cosmetics;

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

  const unitConfigMap = useMemo(
    () => new Map(units.map((unit) => [unit.slug, unit])),
    [units]
  );
  const getUnitConfig = (slug: string) => unitConfigMap.get(slug) ?? null;

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

  const { buildOptions, producedUnits, displayedBuildings } = useMemo(() => {
    const buildOpts = [...buildings]
      .filter((building) => !building.requires_coastal || region.is_coastal)
      .filter(
        (building) =>
          (buildingCounts[building.slug] ?? 0) + (queuedBuildingCounts[building.slug] ?? 0) <
          building.max_per_region
      )
      .sort((a, b) => a.order - b.order || a.energy_cost - b.energy_cost || a.name.localeCompare(b.name));
    const produced = [...units]
      .filter((unit) => Boolean(unit.produced_by_slug))
      .filter((unit) => (buildingCounts[unit.produced_by_slug ?? ""] ?? 0) > 0)
      .sort((a, b) => a.order - b.order || a.production_cost - b.production_cost || a.name.localeCompare(b.name));
    const displayed = [...buildings]
      .filter((building) => (buildingCounts[building.slug] ?? 0) > 0)
      .sort((a, b) => a.order - b.order);
    return { buildOptions: buildOpts, producedUnits: produced, displayedBuildings: displayed };
  }, [buildings, units, region.is_coastal, buildingCounts, queuedBuildingCounts]);

  const { unitBreakdown, reservedInfantry } = useMemo(() => {
    const breakdown = Object.entries(region.units ?? {})
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
    const reserved = breakdown.reduce((total, [type, count]) => {
      if (type === "infantry") return total;
      const manpowerCost = Math.max(1, unitConfigMap.get(type)?.manpower_cost ?? 1);
      return total + count * manpowerCost;
    }, 0);
    return { unitBreakdown: breakdown, reservedInfantry: reserved };
  }, [region.units, unitConfigMap]);

  const hasBuild = isOwned && buildOptions.length > 0;
  const hasProduce = isOwned && producedUnits.length > 0;

  // Cooldown indicators (only for owned regions)
  const moveCooldownRemaining = isOwned ? Math.max(0, (region.action_cooldowns?.move ?? 0) - currentTick) : 0;
  const attackCooldownRemaining = isOwned ? Math.max(0, (region.action_cooldowns?.attack ?? 0) - currentTick) : 0;
  const isMoveCoolingDown = moveCooldownRemaining > 0;
  const isAttackCoolingDown = attackCooldownRemaining > 0;

  // Fatigue indicator
  const hasFatigue = isOwned && region.fatigue_until != null && region.fatigue_until > currentTick;
  const fatigueTicks = hasFatigue ? Math.max(0, (region.fatigue_until ?? 0) - currentTick) : 0;
  const fatiguePercent = hasFatigue ? Math.round((region.fatigue_modifier ?? 0) * 100) : 0;

  const defaultTab: TabId = hasBuild ? "build" : hasProduce ? "produce" : "info";
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);

  const tabs: { id: TabId; label: string; icon: typeof Info; show: boolean }[] = [
    { id: "info", label: "Info", icon: Info, show: true },
    { id: "build", label: "Budowa", icon: Hammer, show: hasBuild },
    { id: "produce", label: "Jednostki", icon: SwordsIcon, show: hasProduce },
  ];

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex h-[min(55vh,520px)] flex-col overflow-hidden rounded-t-[20px] border-t border-border bg-card shadow-lg sm:bg-card/95 sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-[300px] sm:rounded-t-none sm:border-l sm:border-t-0 sm:shadow-[-16px_0_48px_rgba(0,0,0,0.3)] sm:backdrop-blur-xl">

      {/* ── Drag handle (mobile) ── */}
      <div className="flex justify-center py-2 sm:hidden">
        <div className="h-1 w-8 rounded-full bg-muted-foreground/30" />
      </div>

      {/* ── Sticky header ── */}
      <div className="flex items-center gap-2 px-3 pb-2 sm:pt-3">
        {/* Owner color dot */}
        {owner && (
          <span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-border" style={{ backgroundColor: owner.color }} />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-base font-bold text-foreground sm:text-lg">{region.name}</h3>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {owner ? (
              <span className="truncate">{owner.clan_tag && `[${owner.clan_tag}] `}{owner.username}{owner.is_bot ? " (BOT)" : ""}</span>
            ) : (
              <span>Neutralny</span>
            )}
            {region.is_capital && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-yellow-300">Stolica</span>
              </>
            )}
            {region.is_coastal && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-primary">Przybrzezny</span>
              </>
            )}
          </div>
        </div>

        {/* Quick stats — infantry (available) + special unit badges */}
        <div className="flex items-center gap-1.5 text-xs tabular-nums">
          {/* Infantry strength */}
          <div className="flex items-center gap-1 rounded-lg bg-muted/30 px-2 py-1">
            <Image
              src={getPlayerUnitAsset("infantry", ownerCosmetics, getUnitConfig("infantry")?.asset_url)}
              alt="" width={14} height={14} className="h-3.5 w-3.5 object-contain"
            />
            <span className="font-display font-bold text-foreground">
              {isOwned ? Math.max(0, (region.units?.infantry ?? 0) - reservedInfantry) : "?"}
            </span>
          </div>
          {/* Other units as compact badges */}
          {isOwned && unitBreakdown
            .filter(([type]) => type !== "infantry")
            .map(([type, count]) => {
              const cfg = getUnitConfig(type);
              const mp = count * Math.max(1, cfg?.manpower_cost ?? 1);
              return (
                <div key={type} className="flex items-center gap-0.5 rounded-lg bg-muted/30 px-1.5 py-1">
                  <Image
                    src={getPlayerUnitAsset(type, ownerCosmetics, cfg?.asset_url)}
                    alt="" width={12} height={12} className="h-3 w-3 object-contain"
                  />
                  <span className="font-display font-bold text-foreground text-[11px]">{count}</span>
                </div>
              );
            })
          }
          <div className="flex items-center gap-1 rounded-lg bg-muted/30 px-2 py-1">
            <span className="text-[11px] text-primary">⚡</span>
            <span className="font-display font-bold text-foreground">{isOwned ? myEnergy : "?"}</span>
          </div>
        </div>

        <button
          onClick={onClose}
          aria-label="Zamknij"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Tabs ── */}
      {(hasBuild || hasProduce) && (
        <div className="flex gap-1 border-b border-border px-3 pb-0">
          {tabs.filter(t => t.show).map((tab) => {
            const active = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin scrollbar-thumb-border">

        {/* ═══ INFO TAB ═══ */}
        {activeTab === "info" && (
          <div className="space-y-2">
            {/* Unit breakdown */}
            {unitBreakdown.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Jednostki</p>
                {unitBreakdown.map(([type, count]) => {
                  const unitConfig = getUnitConfig(type);
                  const manpowerCost = Math.max(1, unitConfig?.manpower_cost ?? 1);
                  const effectivePower = count * manpowerCost;
                  const isBaseInfantry = type === "infantry";
                  const freeInfantry = Math.max(0, count - reservedInfantry);
                  return (
                    <div key={type} className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-2 py-1.5">
                      <Image
                        src={getPlayerUnitAsset(type, ownerCosmetics, unitConfig?.asset_url)}
                        alt={type} width={16} height={16} className="h-4 w-4 object-contain"
                      />
                      <span className="flex-1 truncate text-xs text-foreground">{unitConfig?.name ?? type}</span>
                      <span className="text-xs font-bold tabular-nums text-foreground">
                        {isOwned ? (isBaseInfantry ? freeInfantry : effectivePower) : "?"}
                      </span>
                      {!isBaseInfantry && manpowerCost > 1 && isOwned && (
                        <span className="text-[10px] text-muted-foreground">({count}x)</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Infrastructure */}
            {displayedBuildings.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Infrastruktura</p>
                {displayedBuildings.map((building) => {
                  const instances = instancesByType[building.slug] ?? [];
                  const legacyCount = !region.building_instances ? (buildingCounts[building.slug] ?? 0) : 0;
                  const asset = getPlayerBuildingAsset(building.asset_key || building.slug, ownerCosmetics, building.asset_url);

                  if (instances.length > 0) {
                    return instances.map((inst, idx) => {
                      const lvl = inst.level;
                      const lvlColor = lvl >= 3 ? "text-yellow-300" : lvl === 2 ? "text-blue-300" : "text-muted-foreground";
                      return (
                        <div key={`${building.slug}-${idx}`} className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-2 py-1.5">
                          {asset && <Image src={asset} alt="" width={16} height={16} className="h-4 w-4 object-contain" />}
                          <span className="flex-1 truncate text-xs text-foreground">{building.name}</span>
                          <span className={`text-[10px] font-bold ${lvlColor}`}>Lvl {lvl}</span>
                        </div>
                      );
                    });
                  }
                  return (
                    <div key={building.slug} className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-2 py-1.5">
                      {asset && <Image src={asset} alt="" width={16} height={16} className="h-4 w-4 object-contain" />}
                      <span className="flex-1 truncate text-xs text-foreground">{building.name}</span>
                      <Badge variant="secondary" className="text-[10px]">x{legacyCount}</Badge>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Build queue */}
            {Object.keys(queuedBuildingCounts).length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">W kolejce</p>
                {Object.entries(queuedBuildingCounts).map(([slug, count]) => {
                  const building = buildings.find((e) => e.slug === slug);
                  const asset = getPlayerBuildingAsset(building?.asset_key || slug, myCosmetics, building?.asset_url);
                  return (
                    <div key={slug} className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-2 py-1.5">
                      {asset && <Image src={asset} alt="" width={16} height={16} className="h-4 w-4 object-contain" />}
                      <span className="flex-1 truncate text-xs text-foreground">{building?.name ?? slug}</span>
                      <Badge variant="secondary" className="text-[10px]">+{count}</Badge>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Bonuses */}
            {(region.defense_bonus > 0 || (region.energy_generation_bonus ?? 0) > 0) && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Bonusy</p>
                {region.defense_bonus > 0 && (
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-2 py-1.5 text-xs">
                    <span className="text-muted-foreground">Obrona</span>
                    <span className="font-bold text-green-400">+{Math.round(region.defense_bonus * 100)}%</span>
                  </div>
                )}
                {(region.energy_generation_bonus ?? 0) > 0 && (
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-2 py-1.5 text-xs">
                    <span className="text-muted-foreground">Energia</span>
                    <span className="font-bold text-primary">+{(region.energy_generation_bonus ?? 0).toFixed(1)}/tick</span>
                  </div>
                )}
              </div>
            )}

            {/* Cooldowns */}
            {(isMoveCoolingDown || isAttackCoolingDown) && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Cooldowny</p>
                {isMoveCoolingDown && (
                  <div className="flex items-center justify-between rounded-lg border border-blue-500/20 bg-blue-950/20 px-2 py-1.5 text-xs">
                    <div className="flex items-center gap-1.5 text-blue-400">
                      <Timer className="h-3 w-3" />
                      <span>Ruch</span>
                    </div>
                    <span className="font-bold tabular-nums text-blue-400">{moveCooldownRemaining}t</span>
                  </div>
                )}
                {isAttackCoolingDown && (
                  <div className="flex items-center justify-between rounded-lg border border-orange-500/20 bg-orange-950/20 px-2 py-1.5 text-xs">
                    <div className="flex items-center gap-1.5 text-orange-400">
                      <Timer className="h-3 w-3" />
                      <span>Atak</span>
                    </div>
                    <span className="font-bold tabular-nums text-orange-400">{attackCooldownRemaining}t</span>
                  </div>
                )}
              </div>
            )}

            {/* Combat fatigue */}
            {hasFatigue && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Stan bojowy</p>
                <div className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-950/20 px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-1.5 text-red-400">
                    <AlertTriangle className="h-3 w-3" />
                    <span>Zmeczenie bojowe</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-red-400">-{fatiguePercent}%</span>
                    <span className="tabular-nums text-muted-foreground">{fatigueTicks}t</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ BUILD TAB ═══ */}
        {activeTab === "build" && (
          <div className="space-y-1.5" data-tutorial="build-section">
            {buildOptions.map((building) => {
              const isBuildingLocked = hasBuildingLocks && !unlockedBuildings!.includes(building.slug);
              const typeInstances = instancesByType[building.slug] ?? [];
              const currentRegionLevel = typeInstances.length > 0
                ? typeInstances[0].level
                : region.building_levels?.[building.slug];
              const playerMaxLevel = buildingLevels?.[building.slug];
              const canUpgrade = currentRegionLevel != null && playerMaxLevel != null && currentRegionLevel < playerMaxLevel;
              const isAtMaxLevel = currentRegionLevel != null && playerMaxLevel != null && currentRegionLevel >= playerMaxLevel;
              const hasBuilt = (buildingCounts[building.slug] ?? 0) > 0;
              const displayName = hasBuilt && currentRegionLevel != null
                ? `${building.name} Lvl ${currentRegionLevel}`
                : building.name;
              const isUpgrade = (currentRegionLevel ?? 0) > 0;
              const nextLevel = isUpgrade ? (currentRegionLevel ?? 0) + 1 : 1;
              const nextCost = building.level_stats?.[String(nextLevel)]?.energy_cost ?? building.energy_cost;
              const nextTime = building.level_stats?.[String(nextLevel)]?.build_time_ticks ?? building.build_time_ticks;
              const asset = getPlayerBuildingAsset(building.asset_key || building.slug, ownerCosmetics, building.asset_url);

              return (
                <button
                  key={building.id}
                  onClick={() => !isBuildingLocked && onBuild(building.slug)}
                  disabled={myEnergy < nextCost || isBuildingLocked || isAtMaxLevel === true}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-accent/10 bg-accent/5 px-2.5 py-2 text-left transition-colors hover:bg-accent/15 active:scale-[0.98] disabled:opacity-40"
                >
                  {asset && (
                    <Image src={asset} alt="" width={28} height={28} className="h-7 w-7 shrink-0 object-contain" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 truncate text-sm font-medium text-foreground">
                      {isBuildingLocked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      {displayName}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {isBuildingLocked
                        ? "Wymaga blueprintu"
                        : isAtMaxLevel
                          ? "Maksymalny poziom"
                          : canUpgrade
                            ? `Ulepsz do Lvl ${currentRegionLevel! + 1}`
                            : `${(buildingCounts[building.slug] ?? 0) + (queuedBuildingCounts[building.slug] ?? 0)}/${building.max_per_region}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {isBuildingLocked ? (
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    ) : isAtMaxLevel ? (
                      <span className="rounded border border-yellow-300/20 bg-yellow-300/10 px-1.5 py-0.5 text-[10px] font-bold text-yellow-300">Max</span>
                    ) : (
                      <div className="space-y-0.5">
                        <div className="flex items-center justify-end gap-0.5 text-xs font-bold">
                          <span className="text-primary">⚡</span>
                          <span className={myEnergy >= nextCost ? "text-foreground" : "text-destructive"}>{nextCost}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">{nextTime}t</div>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ═══ PRODUCE TAB ═══ */}
        {activeTab === "produce" && (
          <div className="space-y-1.5">
            {producedUnits.map((unit) => {
              const isUnitLocked = hasUnitLocks && Boolean(unit.produced_by_slug) && !unlockedUnits!.includes(unit.slug);
              return (
                <button
                  key={unit.id}
                  onClick={() => !isUnitLocked && onProduceUnit(unit.slug)}
                  disabled={myEnergy < unit.production_cost || isUnitLocked}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-primary/10 bg-primary/5 px-2.5 py-2 text-left transition-colors hover:bg-primary/15 active:scale-[0.98] disabled:opacity-40"
                >
                  <Image
                    src={getPlayerUnitAsset(unit.asset_key || unit.slug, myCosmetics, unit.asset_url)}
                    alt="" width={28} height={28} className="h-7 w-7 shrink-0 object-contain"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 truncate text-sm font-medium text-foreground">
                      {isUnitLocked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      {unit.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {isUnitLocked ? "Wymaga blueprintu" : `Zaloga ${unit.manpower_cost} · ${unit.production_time_ticks}t`}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {isUnitLocked ? (
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <div className="flex items-center gap-0.5 text-xs font-bold">
                        <span className="text-primary">⚡</span>
                        <span className={myEnergy >= unit.production_cost ? "text-foreground" : "text-destructive"}>{unit.production_cost}</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
