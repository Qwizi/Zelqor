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

// ─── helpers ─────────────────────────────────────────────────────────────────

function movementLabel(type: string): string {
  if (type === "land") return "Ladowy";
  if (type === "sea") return "Morski";
  if (type === "air") return "Powietrzny";
  return type;
}

function combatTargetLabel(target: string): string {
  if (target === "ground") return "Naziemny";
  if (target === "air") return "Powietrzny";
  if (target === "both") return "Wszystko";
  return target;
}

// ─── Tooltip atoms ────────────────────────────────────────────────────────────

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums text-foreground/90">{value}</span>
    </div>
  );
}

function Badge({ children, color = "default" }: { children: React.ReactNode; color?: "green" | "blue" | "amber" | "default" }) {
  const colors = {
    green: "bg-green-900/60 text-green-300 border-green-700/40",
    blue: "bg-blue-900/60 text-blue-300 border-blue-700/40",
    amber: "bg-amber-900/60 text-amber-300 border-amber-700/40",
    default: "bg-muted/60 text-muted-foreground border-border",
  };
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

// ─── Unit tooltip ─────────────────────────────────────────────────────────────

function UnitTooltip({ unit, level }: { unit: UnitType; level?: number }) {
  const hasLevelStats = unit.level_stats && Object.keys(unit.level_stats).length > 0;
  // Override base stats with level-specific values if available
  const lvl = level ?? 1;
  const ls = unit.level_stats?.[String(lvl)] ?? {};
  const attack = ls.attack ?? unit.attack;
  const manpowerCost = ls.manpower_cost ?? unit.manpower_cost;
  const productionCost = ls.production_cost ?? unit.production_cost;
  const productionTime = ls.production_time_ticks ?? unit.production_time_ticks;
  const abilities: string[] = [];
  if (unit.is_stealth) abilities.push("Ukryty");
  if (unit.aoe_damage > 0) abilities.push(`Obszarowy ×${unit.aoe_damage}`);
  if (unit.path_damage > 0) abilities.push(`Dmg na trasie ×${unit.path_damage}`);
  if (unit.intercept_air) abilities.push("Przechwytuje lotnictwo");
  if (unit.blockade_port) abilities.push("Blokada portu");

  return (
    <div className="invisible group-hover:visible pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-60 -translate-x-1/2 rounded-xl border border-border/60 bg-card p-3 shadow-2xl">
      {/* arrow */}
      <div className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 rounded-sm border-b border-r border-border/60 bg-card" />

      {/* name + movement */}
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-foreground">{unit.name} {lvl > 1 && <span className="text-amber-400 text-[10px]">Lv{lvl}</span>}</p>
        <Badge color="blue">{movementLabel(unit.movement_type)}</Badge>
      </div>
      {unit.description && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{unit.description}</p>
      )}

      {/* core stats */}
      <div className="mt-2.5 space-y-1 text-xs border-t border-border/40 pt-2">
        <StatRow label="Atak" value={attack} />
        <StatRow label="Obrona" value={unit.defense} />
        <StatRow label="Predkosc" value={unit.speed} />
        {unit.attack_range > 1 && <StatRow label="Zasieg" value={unit.attack_range} />}
        <StatRow label="Cel" value={combatTargetLabel(unit.combat_target)} />
      </div>

      {/* cost */}
      {unit.produced_by_slug && (
        <div className="mt-2 space-y-1 text-xs border-t border-border/40 pt-2">
          <StatRow label="Koszt" value={<span className="text-primary">{productionCost}⚡</span>} />
          {manpowerCost > 1 && <StatRow label="Sila" value={`${manpowerCost}♟`} />}
          {productionTime > 0 && <StatRow label="Czas" value={`${productionTime}t`} />}
        </div>
      )}

      {/* abilities */}
      {abilities.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-border/40 pt-2">
          {abilities.map((a) => (
            <Badge key={a} color="amber">{a}</Badge>
          ))}
        </div>
      )}

      {/* level stats */}
      {hasLevelStats && (
        <div className="mt-2 border-t border-border/40 pt-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Poziomy</p>
          <div className="space-y-0.5 text-xs">
            {Object.entries(unit.level_stats).slice(0, 4).map(([lvl, stats]) => (
              <div key={lvl} className="flex items-center gap-1.5">
                <span className="w-8 text-amber-400 font-medium">Lv{lvl}</span>
                <span className="text-muted-foreground text-[10px]">
                  {Object.entries(stats).slice(0, 2).map(([k, v]) => `${k}:${v}`).join(" ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Building tooltip ─────────────────────────────────────────────────────────

function BuildingTooltip({
  building,
  currentLevel,
  playerMaxLevel,
  nextCost,
  nextLevel,
}: {
  building: BuildingType;
  currentLevel: number | undefined;
  playerMaxLevel: number | undefined;
  nextCost: number;
  nextLevel: number;
}) {
  const hasLevelStats = building.level_stats && Object.keys(building.level_stats).length > 0;
  const bonuses: string[] = [];
  if (building.defense_bonus > 0) bonuses.push(`Obrona +${building.defense_bonus}`);
  if (building.vision_range > 0) bonuses.push(`Wizja +${building.vision_range}`);
  if (building.unit_generation_bonus > 0) bonuses.push(`Jednostki +${building.unit_generation_bonus}/t`);
  if (building.energy_generation_bonus > 0) bonuses.push(`Energia +${building.energy_generation_bonus}/t`);

  const levelsToShow = hasLevelStats ? Object.entries(building.level_stats).slice(0, 4) : [];

  return (
    <div className="invisible group-hover:visible pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-60 -translate-x-1/2 rounded-xl border border-border/60 bg-card p-3 shadow-2xl">
      <div className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 rounded-sm border-b border-r border-border/60 bg-card" />

      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-foreground">{building.name}</p>
        {building.requires_coastal && <Badge color="blue">Nadbrzezny</Badge>}
      </div>
      {building.description && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{building.description}</p>
      )}

      {/* level indicator */}
      <div className="mt-2 flex items-center gap-2 border-t border-border/40 pt-2 text-xs">
        <span className="text-muted-foreground">Poziom</span>
        <span className="font-semibold">
          <span className="text-amber-400">{currentLevel ?? 0}</span>
          {playerMaxLevel != null && (
            <span className="text-muted-foreground"> / {playerMaxLevel}</span>
          )}
        </span>
      </div>

      {/* next upgrade cost */}
      <div className="mt-1.5 space-y-1 text-xs">
        <StatRow label="Koszt (Lv{nextLevel})" value={<span className="text-primary">{nextCost}⚡</span>} />
        <StatRow label={`Czas`} value={`${building.build_time_ticks}t`} />
      </div>

      {/* bonuses */}
      {bonuses.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-border/40 pt-2">
          {bonuses.map((b) => (
            <Badge key={b} color="green">{b}</Badge>
          ))}
        </div>
      )}

      {/* level stats preview */}
      {levelsToShow.length > 0 && (
        <div className="mt-2 border-t border-border/40 pt-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Bonusy poziomow</p>
          <div className="space-y-0.5 text-xs">
            {levelsToShow.map(([lvl, stats]) => (
              <div key={lvl} className="flex items-center gap-1.5">
                <span className="w-8 text-amber-400 font-medium">Lv{lvl}</span>
                <span className="text-muted-foreground text-[10px]">
                  {Object.entries(stats).slice(0, 3).map(([k, v]) => `${k}:${v}`).join(" ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Unit type selector tooltip ───────────────────────────────────────────────

function UnitSelectorTooltip({
  unitType,
  count,
  displayCount,
  unit,
  percent,
}: {
  unitType: string;
  count: number;
  displayCount: number;
  unit: UnitType | undefined;
  percent: number;
}) {
  if (!unit) return null;
  const mp = Math.max(1, unit.manpower_cost);
  const isInfantry = unitType === "infantry";
  const sendCount = isInfantry
    ? Math.max(1, Math.floor(displayCount * percent / 100))
    : Math.max(1, Math.floor(count * percent / 100));
  const totalAttack = sendCount * unit.attack;
  const totalDmg = isInfantry ? totalAttack : sendCount * mp * unit.attack;

  return (
    <div className="invisible group-hover:visible pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-xl border border-border/60 bg-card p-3 shadow-2xl">
      <div className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 rounded-sm border-b border-r border-border/60 bg-card" />
      <p className="font-semibold text-foreground">{unit.name}</p>
      <div className="mt-2 space-y-1 text-xs border-t border-border/40 pt-2">
        <StatRow label="Atak / szt." value={unit.attack} />
        <StatRow label="Obrona" value={unit.defense} />
        <StatRow label="Dostepne" value={isInfantry ? displayCount : count} />
        <StatRow
          label={`Wysylasz (${percent}%)`}
          value={<span className="text-primary font-bold">{sendCount}</span>}
        />
        <StatRow
          label="Calkowity DMG"
          value={
            <span className="text-red-400 font-bold">
              {isInfantry
                ? `${unit.attack} × ${sendCount} = ${Math.round(totalAttack)}`
                : `${mp} × ${unit.attack} × ${sendCount} = ${Math.round(totalDmg)}`
              }
            </span>
          }
        />
        {!isInfantry && (
          <StatRow label="Sila zarezerwowana" value={`${count * mp}♟`} />
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

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

  // Available infantry = raw infantry minus manpower reserved by special units
  const availableInfantry = useMemo(() => {
    const raw = region.units?.infantry ?? 0;
    const reserved = visibleUnitTypes
      .filter(([t]) => t !== "infantry")
      .reduce((s, [t, c]) => s + c * Math.max(1, unitConfigMap.get(t)?.manpower_cost ?? 1), 0);
    return Math.max(0, raw - reserved);
  }, [region.units, visibleUnitTypes, unitConfigMap]);

  const hasMoveAction = isOwned && visibleUnitTypes.length > 0;
  const hasBuild = isOwned && buildOptions.length > 0;
  const hasProduce = isOwned && producedUnits.length > 0;
  const buildingCount = Object.values(buildingCounts).reduce((s, c) => s + c, 0);

  const [expanded, setExpanded] = useState(false);

  return (
    <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 w-[min(95vw,540px)]">
      <div className="rounded-2xl border border-border bg-card/90 shadow-[0_10px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          {owner && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/20"
              style={{ backgroundColor: owner.color }}
            />
          )}
          <span className="min-w-0 flex-1 truncate font-semibold tracking-wide text-foreground text-sm">
            {region.name}
          </span>

          {/* unit + building summary */}
          <div className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground shrink-0">
            {isOwned ? (
              <>
                <div className="flex items-center gap-0.5">
                  <Image src={getUnitAsset("infantry")} alt="" width={12} height={12} className="h-3 w-3 object-contain opacity-70" />
                  <span className="font-semibold text-foreground/80">
                    {Math.max(0, (region.units?.infantry ?? 0) - visibleUnitTypes.filter(([t]) => t !== "infantry").reduce((s, [t, c]) => s + c * Math.max(1, unitConfigMap.get(t)?.manpower_cost ?? 1), 0))}
                  </span>
                </div>
                {visibleUnitTypes.filter(([t]) => t !== "infantry").map(([t, c]) => (
                  <div key={t} className="flex items-center gap-0.5">
                    <Image src={getUnitAsset(t)} alt="" width={11} height={11} className="h-2.5 w-2.5 object-contain opacity-70" />
                    <span className="font-semibold text-[10px] text-foreground/70">{c}</span>
                  </div>
                ))}
              </>
            ) : (
              <span className="font-semibold text-foreground/60">?</span>
            )}
            {buildingCount > 0 && (
              <>
                <span className="text-white/15">·</span>
                <span className="text-yellow-400/80 text-[11px]">⚡</span>
                <span className="font-semibold tabular-nums text-foreground/70">{myEnergy}</span>
              </>
            )}
          </div>
          {/* Region bonuses */}
          {isOwned && (region.defense_bonus > 0 || region.unit_generation_bonus > 0 || region.energy_generation_bonus > 0) && (
            <div className="flex items-center gap-1.5 text-[10px] tabular-nums shrink-0">
              {region.defense_bonus > 0 && (
                <span className="text-blue-400" title="Bonus obrony">🛡+{+region.defense_bonus.toFixed(2)}</span>
              )}
              {region.unit_generation_bonus > 0 && (
                <span className="text-green-400" title="Bonus gen. jednostek">♟+{+region.unit_generation_bonus.toFixed(1)}/t</span>
              )}
              {region.energy_generation_bonus > 0 && (
                <span className="text-yellow-400" title="Bonus gen. energii">⚡+{+region.energy_generation_bonus.toFixed(1)}/t</span>
              )}
            </div>
          )}

          <button
            onClick={onCancel}
            aria-label="Anuluj"
            className="ml-1 rounded-full p-1 text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* ── Move actions ────────────────────────────────────────────── */}
        {hasMoveAction && (
          <div className="border-t border-border px-3 py-2.5 space-y-2">

            {/* Percent presets */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mr-1">Wyslij</span>
              {PERCENT_PRESETS.map((preset) => {
                const active = unitPercent === preset;
                return (
                  <button
                    key={preset}
                    onClick={() => onPercentChange(preset)}
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold tabular-nums transition-all ${
                      active
                        ? "border-primary/60 bg-primary/20 text-primary shadow-sm shadow-primary/20"
                        : "border-white/10 bg-white/5 text-muted-foreground hover:border-white/20 hover:text-white/70"
                    }`}
                  >
                    {preset === 100 ? "MAX" : `${preset}%`}
                  </button>
                );
              })}
            </div>

            {/* Unit type pills */}
            {visibleUnitTypes.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {visibleUnitTypes.map(([unitType, count]) => {
                  const active = unitType === selectedUnitType;
                  const isInfantry = unitType === "infantry";
                  const mp = Math.max(1, unitConfigMap.get(unitType)?.manpower_cost ?? 1);
                  const reserved = isInfantry
                    ? visibleUnitTypes.filter(([t]) => t !== "infantry").reduce((s, [t, c]) => s + c * Math.max(1, unitConfigMap.get(t)?.manpower_cost ?? 1), 0)
                    : 0;
                  const displayCount = isInfantry ? Math.max(0, count - reserved) : count;
                  const label = isInfantry ? `${displayCount}` : `${count}(${count * mp})`;
                  const unitData = unitConfigMap.get(unitType);

                  return (
                    <div key={unitType} className="group relative">
                      <button
                        onClick={() => onUnitTypeChange(unitType)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-all ${
                          active
                            ? "border-primary/60 bg-primary/20 text-primary shadow-sm shadow-primary/20"
                            : "border-white/12 bg-white/6 text-white/60 hover:border-white/25 hover:bg-white/10 hover:text-white/85"
                        }`}
                      >
                        <Image
                          src={getUnitAsset(unitType)}
                          alt={unitType}
                          width={14}
                          height={14}
                          className="h-3.5 w-3.5 object-contain"
                        />
                        <span className="tabular-nums">{label}</span>
                      </button>
                      {unitData && (
                        <UnitSelectorTooltip
                          unitType={unitType}
                          count={count}
                          displayCount={displayCount}
                          unit={unitData}
                          percent={unitPercent}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Build / Produce ─────────────────────────────────────────── */}
        {(hasBuild || hasProduce) && (
          <>
            {/* Mobile toggle */}
            <div className="flex items-center border-t border-border sm:hidden">
              <button
                onClick={() => setExpanded((prev) => !prev)}
                className="flex w-full items-center justify-center gap-1.5 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35 hover:text-white/60 transition-colors"
              >
                <ChevronUp className={`h-3 w-3 transition-transform ${expanded ? "" : "rotate-180"}`} />
                {hasBuild && "Buduj"}{hasBuild && hasProduce && " · "}{hasProduce && "Produkuj"}
              </button>
            </div>

            {/* Build row */}
            {hasBuild && (
              <div className={`border-t border-border px-3 py-2.5 ${expanded ? "block" : "hidden"} sm:block`}>
                <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground/60">Budynki</p>
                <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
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

                    const stateClass = isBuildingLocked
                      ? "border-red-500/25 bg-red-950/15 opacity-50 cursor-not-allowed"
                      : isAtMaxLevel
                        ? "border-amber-500/25 bg-amber-950/10 cursor-default"
                        : canAfford
                          ? "border-green-500/25 bg-green-950/15 hover:border-green-500/45 hover:bg-green-950/25 cursor-pointer"
                          : "border-border bg-muted/20 opacity-55 cursor-not-allowed";

                    return (
                      <div key={building.id} className="group relative">
                        <button
                          onClick={() => !isBuildingLocked && !isAtMaxLevel && canAfford && onBuild(building.slug)}
                          className={`flex w-full flex-col items-center gap-0.5 rounded-lg border p-1.5 transition-all ${stateClass}`}
                        >
                          <div className="relative">
                            {asset && (
                              <Image src={asset} alt="" width={20} height={20} className="h-5 w-5 object-contain" />
                            )}
                            {isBuildingLocked && (
                              <Lock className="absolute -right-1 -top-1 h-2.5 w-2.5 text-red-400" />
                            )}
                          </div>
                          <span className="w-full text-[8px] font-medium text-muted-foreground leading-tight truncate text-center">{building.name}</span>
                          {isAtMaxLevel ? (
                            <span className="text-[9px] font-semibold text-amber-400">Max</span>
                          ) : (
                            <div className="flex items-center gap-0.5">
                              <span className="text-[9px] text-yellow-400">⚡</span>
                              <span className={`text-[10px] font-bold tabular-nums ${canAfford ? "text-green-400" : "text-red-400"}`}>
                                {nextCost}
                              </span>
                              {isUpgrade && <span className="text-[8px] text-amber-400/80 ml-0.5">Lv{nextLevel}</span>}
                            </div>
                          )}
                        </button>
                        {/* Rich building tooltip */}
                        <BuildingTooltip
                          building={building}
                          currentLevel={currentRegionLevel}
                          playerMaxLevel={playerMaxLevel}
                          nextCost={nextCost}
                          nextLevel={nextLevel}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Produce row */}
            {hasProduce && (
              <div className={`border-t border-border px-3 py-2.5 ${expanded ? "block" : "hidden"} sm:block`}>
                <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground/60">Produkcja</p>
                <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
                  {producedUnits.map((unit) => {
                    const isUnitLocked = hasUnitLocks && Boolean(unit.produced_by_slug) && !unlockedUnits!.includes(unit.slug);
                    // Get stats from level_stats based on producer building level
                    const producerInstances = instancesByType[unit.produced_by_slug ?? ""] ?? [];
                    const producerLevel = producerInstances.length > 0
                      ? producerInstances[0].level
                      : (buildingLevels?.[unit.produced_by_slug ?? ""] ?? 1);
                    const lvlStats = unit.level_stats?.[String(producerLevel)] ?? {};
                    const effectiveCost = lvlStats.production_cost ?? unit.production_cost;
                    const effectiveManpower = lvlStats.manpower_cost ?? unit.manpower_cost ?? 1;
                    const effectiveAttack = lvlStats.attack ?? unit.attack;
                    const canAffordEnergy = myEnergy >= effectiveCost;
                    const canAffordManpower = availableInfantry >= effectiveManpower;
                    const canAfford = canAffordEnergy && canAffordManpower;
                    const asset = getPlayerUnitAsset(unit.asset_key || unit.slug, myCosmetics, unit.asset_url);

                    const stateClass = isUnitLocked
                      ? "border-red-500/25 bg-red-950/15 opacity-50 cursor-not-allowed"
                      : canAfford
                        ? "border-green-500/25 bg-green-950/15 hover:border-green-500/45 hover:bg-green-950/25 cursor-pointer"
                        : "border-border bg-muted/20 opacity-55 cursor-not-allowed";

                    return (
                      <div key={unit.id} className="group relative">
                        <button
                          onClick={() => !isUnitLocked && canAfford && onProduceUnit(unit.slug)}
                          className={`flex w-full flex-col items-center gap-0.5 rounded-lg border p-1.5 transition-all ${stateClass}`}
                        >
                          <div className="relative">
                            <Image src={asset} alt="" width={20} height={20} className="h-5 w-5 object-contain" />
                            {isUnitLocked && (
                              <Lock className="absolute -right-1 -top-1 h-2.5 w-2.5 text-red-400" />
                            )}
                          </div>
                          <span className="w-full text-[8px] font-medium text-muted-foreground leading-tight truncate text-center">{unit.name}</span>
                          {isUnitLocked ? (
                            <Lock className="h-2.5 w-2.5 text-muted-foreground/60" />
                          ) : (
                            <div className="flex items-center gap-0.5">
                              <span className="text-[9px] text-yellow-400">⚡</span>
                              <span className={`text-[10px] font-bold tabular-nums ${canAffordEnergy ? "text-green-400" : "text-red-400"}`}>
                                {effectiveCost}
                              </span>
                              {effectiveManpower > 1 && (
                                <span className={`text-[8px] font-bold tabular-nums ml-0.5 ${canAffordManpower ? "text-muted-foreground" : "text-red-400"}`}>
                                  {effectiveManpower}♟
                                </span>
                              )}
                            </div>
                          )}
                        </button>
                        <UnitTooltip unit={unit} level={producerLevel} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});
