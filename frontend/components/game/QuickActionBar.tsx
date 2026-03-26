"use client";

import { AlertTriangle, BoltIcon, ChevronUp, Lock, Timer, X, Zap } from "lucide-react";
import Image from "next/image";
import { memo, useMemo, useState } from "react";
import type { BuildingQueueItem, GamePlayer, GameRegion } from "@/hooks/useGameSocket";
import type { BuildingType, UnitType } from "@/lib/api";
import { getPlayerBuildingAsset, getPlayerUnitAsset, getUnitAsset } from "@/lib/gameAssets";
import { AP_COSTS, AP_MAX } from "@/lib/gameTypes";

const PERCENT_PRESETS = [25, 50, 75, 100] as const;

export interface QuickActionBarProps {
  regionId: string;
  region: GameRegion;
  players: Record<string, GamePlayer>;
  myUserId: string;
  myEnergy: number;
  myActionPoints: number;
  currentTick: number;
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

function Badge({
  children,
  color = "default",
}: {
  children: React.ReactNode;
  color?: "green" | "blue" | "amber" | "default";
}) {
  const colors = {
    green: "bg-green-900/60 text-green-300 border-green-700/40",
    blue: "bg-blue-900/60 text-blue-300 border-blue-700/40",
    amber: "bg-amber-900/60 text-amber-300 border-amber-700/40",
    default: "bg-muted/60 text-muted-foreground border-border",
  };
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-caption font-medium ${colors[color]}`}>
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
        <p className="font-semibold text-foreground">
          {unit.name} {lvl > 1 && <span className="text-amber-400 text-caption">Lv{lvl}</span>}
        </p>
        <Badge color="blue">{movementLabel(unit.movement_type)}</Badge>
      </div>
      {unit.description && <p className="mt-1 text-caption leading-snug text-muted-foreground">{unit.description}</p>}

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
            <Badge key={a} color="amber">
              {a}
            </Badge>
          ))}
        </div>
      )}

      {/* level stats */}
      {hasLevelStats && (
        <div className="mt-2 border-t border-border/40 pt-2">
          <p className="mb-1 text-caption uppercase tracking-wide text-muted-foreground">Poziomy</p>
          <div className="space-y-0.5 text-xs">
            {Object.entries(unit.level_stats)
              .slice(0, 4)
              .map(([lvl, stats]) => (
                <div key={lvl} className="flex items-center gap-1.5">
                  <span className="w-8 text-amber-400 font-medium">Lv{lvl}</span>
                  <span className="text-muted-foreground text-caption">
                    {Object.entries(stats)
                      .slice(0, 2)
                      .map(([k, v]) => `${k}:${v}`)
                      .join(" ")}
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
        <p className="mt-1 text-caption leading-snug text-muted-foreground">{building.description}</p>
      )}

      {/* level indicator */}
      <div className="mt-2 flex items-center gap-2 border-t border-border/40 pt-2 text-xs">
        <span className="text-muted-foreground">Poziom</span>
        <span className="font-semibold">
          <span className="text-amber-400">{currentLevel ?? 0}</span>
          {playerMaxLevel != null && <span className="text-muted-foreground"> / {playerMaxLevel}</span>}
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
            <Badge key={b} color="green">
              {b}
            </Badge>
          ))}
        </div>
      )}

      {/* level stats preview */}
      {levelsToShow.length > 0 && (
        <div className="mt-2 border-t border-border/40 pt-2">
          <p className="mb-1 text-caption uppercase tracking-wide text-muted-foreground">Bonusy poziomow</p>
          <div className="space-y-0.5 text-xs">
            {levelsToShow.map(([lvl, stats]) => (
              <div key={lvl} className="flex items-center gap-1.5">
                <span className="w-8 text-amber-400 font-medium">Lv{lvl}</span>
                <span className="text-muted-foreground text-caption">
                  {Object.entries(stats)
                    .slice(0, 3)
                    .map(([k, v]) => `${k}:${v}`)
                    .join(" ")}
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
    ? Math.max(1, Math.floor((displayCount * percent) / 100))
    : Math.max(1, Math.floor((count * percent) / 100));
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
        <StatRow label={`Wysylasz (${percent}%)`} value={<span className="text-primary font-bold">{sendCount}</span>} />
        <StatRow
          label="Calkowity DMG"
          value={
            <span className="text-red-400 font-bold">
              {isInfantry
                ? `${unit.attack} × ${sendCount} = ${Math.round(totalAttack)}`
                : `${mp} × ${unit.attack} × ${sendCount} = ${Math.round(totalDmg)}`}
            </span>
          }
        />
        {!isInfantry && <StatRow label="Sila zarezerwowana" value={`${count * mp}♟`} />}
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
  myActionPoints,
  currentTick,
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

  const unitConfigMap = useMemo(() => new Map(units.map((u) => [u.slug, u])), [units]);

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
    [buildingQueue, regionId],
  );

  const { buildOptions, producedUnits } = useMemo(() => {
    const buildOpts = [...buildings]
      .filter((b) => !b.requires_coastal || region.is_coastal)
      .filter((b) => (buildingCounts[b.slug] ?? 0) + (queuedBuildingCounts[b.slug] ?? 0) < b.max_per_region)
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
    [region.units],
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
  const _buildingCount = Object.values(buildingCounts).reduce((s, c) => s + c, 0);

  // AP gating
  const canAffordMove = myActionPoints >= AP_COSTS.move;
  const canAffordBuild = myActionPoints >= AP_COSTS.build;
  const canAffordProduce = myActionPoints >= AP_COSTS.produce;

  // Region cooldowns: ticks remaining until the action is ready
  const moveCooldownRemaining = Math.max(0, (region.action_cooldowns?.move ?? 0) - currentTick);
  const attackCooldownRemaining = Math.max(0, (region.action_cooldowns?.attack ?? 0) - currentTick);
  const isMoveCoolingDown = moveCooldownRemaining > 0;
  const isAttackCoolingDown = attackCooldownRemaining > 0;

  // Fatigue: active when fatigue_until > currentTick
  const hasFatigue = region.fatigue_until != null && region.fatigue_until > currentTick;
  const fatigueTicks = hasFatigue ? Math.max(0, (region.fatigue_until ?? 0) - currentTick) : 0;
  const fatiguePercent = hasFatigue ? Math.round((region.fatigue_modifier ?? 0) * 100) : 0;

  const [expanded, setExpanded] = useState(false);

  return (
    <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 w-[min(95vw,680px)]">
      <div
        className={`rounded-2xl border bg-card/90 shadow-[0_10px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-colors ${
          hasFatigue ? "border-red-500/60" : "border-border"
        }`}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="px-3 pt-2.5 pb-1">
          {/* Region name row */}
          <div className="flex items-center gap-2 mb-2">
            {owner && (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/20"
                style={{ backgroundColor: owner.color }}
              />
            )}
            <span className="min-w-0 flex-1 truncate font-semibold tracking-wide text-foreground text-sm">
              {region.name}
            </span>

            {/* Cooldown badges */}
            {isOwned && isMoveCoolingDown && (
              <div
                className="flex shrink-0 items-center gap-0.5 rounded-full border border-blue-500/30 bg-blue-950/30 px-1.5 py-0.5 text-caption font-semibold tabular-nums text-blue-400"
                title={`Cooldown ruchu: ${moveCooldownRemaining} tickow`}
              >
                <Timer className="h-2.5 w-2.5" />
                {moveCooldownRemaining}t
              </div>
            )}
            {isOwned && isAttackCoolingDown && (
              <div
                className="flex shrink-0 items-center gap-0.5 rounded-full border border-orange-500/30 bg-orange-950/30 px-1.5 py-0.5 text-caption font-semibold tabular-nums text-orange-400"
                title={`Cooldown ataku: ${attackCooldownRemaining} tickow`}
              >
                <Timer className="h-2.5 w-2.5" />
                {attackCooldownRemaining}t
              </div>
            )}

            {/* Fatigue badge */}
            {isOwned && hasFatigue && (
              <div
                className="flex shrink-0 items-center gap-1 rounded-full border border-red-500/50 bg-red-950/40 px-2 py-1 text-xs font-semibold tabular-nums text-red-400"
                title={`Zmeczenie bojowe: -${fatiguePercent}% sily przez ${fatigueTicks} tickow`}
              >
                <AlertTriangle className="h-3 w-3" />-{fatiguePercent}%
              </div>
            )}

            {/* Region bonuses */}
            {isOwned &&
              ((region.defense_bonus ?? 0) > 0 ||
                (region.unit_generation_bonus ?? 0) > 0 ||
                (region.energy_generation_bonus ?? 0) > 0) && (
                <div className="flex items-center gap-1.5 text-caption tabular-nums shrink-0">
                  {(region.defense_bonus ?? 0) > 0 && (
                    <span className="text-blue-400" title="Bonus obrony">
                      🛡+{+(region.defense_bonus ?? 0).toFixed(2)}
                    </span>
                  )}
                  {(region.unit_generation_bonus ?? 0) > 0 && (
                    <span className="text-green-400" title="Bonus gen. jednostek">
                      ♟+{+(region.unit_generation_bonus ?? 0).toFixed(1)}/t
                    </span>
                  )}
                  {(region.energy_generation_bonus ?? 0) > 0 && (
                    <span className="text-yellow-400" title="Bonus gen. energii">
                      ⚡+{+(region.energy_generation_bonus ?? 0).toFixed(1)}/t
                    </span>
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

          {/* Stats row — units, energy, AP */}
          {isOwned && (
            <div className="grid grid-cols-3 gap-1.5">
              {/* Units */}
              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/20 px-2 py-1.5">
                <Image
                  src={getUnitAsset("infantry")}
                  alt=""
                  width={16}
                  height={16}
                  className="h-4 w-4 object-contain opacity-80"
                />
                <div className="min-w-0">
                  <div className="font-display text-lg font-bold leading-none tabular-nums text-foreground">
                    {availableInfantry}
                  </div>
                  <div className="text-caption text-muted-foreground">Jednostki</div>
                </div>
                {visibleUnitTypes.filter(([t]) => t !== "infantry").length > 0 && (
                  <div className="ml-auto flex items-center gap-1">
                    {visibleUnitTypes
                      .filter(([t]) => t !== "infantry")
                      .map(([t, c]) => (
                        <div key={t} className="flex items-center gap-0.5" title={t}>
                          <Image
                            src={getUnitAsset(t)}
                            alt=""
                            width={12}
                            height={12}
                            className="h-3 w-3 object-contain opacity-70"
                          />
                          <span className="text-xs font-semibold tabular-nums text-foreground/70">{c}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Energy */}
              <div
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${
                  myEnergy < 50 ? "border-yellow-500/40 bg-yellow-950/20" : "border-border bg-muted/20"
                }`}
              >
                <Zap className={`h-4 w-4 shrink-0 ${myEnergy < 50 ? "text-yellow-400" : "text-primary"}`} />
                <div className="min-w-0">
                  <div
                    className={`font-display text-lg font-bold leading-none tabular-nums ${
                      myEnergy < 50 ? "text-yellow-400" : "text-primary"
                    }`}
                  >
                    {myEnergy}
                  </div>
                  <div className="text-micro text-muted-foreground">Energia</div>
                </div>
              </div>

              {/* AP */}
              <div
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${
                  myActionPoints < 3
                    ? "border-red-500/40 bg-red-950/20"
                    : myActionPoints < 6
                      ? "border-amber-500/30 bg-amber-950/15"
                      : "border-border bg-muted/20"
                }`}
              >
                <BoltIcon
                  className={`h-4 w-4 shrink-0 ${
                    myActionPoints < 3 ? "text-red-400" : myActionPoints < 6 ? "text-amber-400" : "text-emerald-400"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={`font-display text-lg font-bold leading-none tabular-nums ${
                      myActionPoints < 3 ? "text-red-400" : myActionPoints < 6 ? "text-amber-400" : "text-emerald-400"
                    }`}
                  >
                    {myActionPoints}
                    <span className="text-xs font-normal text-muted-foreground">/{AP_MAX}</span>
                  </div>
                  <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full transition-transform duration-300 ${
                        myActionPoints < 3 ? "bg-red-500" : myActionPoints < 6 ? "bg-amber-500" : "bg-emerald-500"
                      }`}
                      style={{ transform: `scaleX(${Math.min(1, myActionPoints / AP_MAX)})`, transformOrigin: "left" }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Move actions ────────────────────────────────────────────── */}
        {hasMoveAction && (
          <div className="border-t border-border px-3 py-2.5 space-y-2">
            {/* AP / cooldown warning row */}
            {(!canAffordMove || isMoveCoolingDown) && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-950/20 px-2.5 py-1.5">
                {isMoveCoolingDown ? (
                  <>
                    <Timer className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <span className="text-xs font-medium text-amber-400">
                      Cooldown ruchu: {moveCooldownRemaining} tick{moveCooldownRemaining !== 1 ? "i" : ""}
                    </span>
                  </>
                ) : (
                  <>
                    <BoltIcon className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <span className="text-xs font-medium text-amber-400">
                      Brak AP na ruch ({AP_COSTS.move} wymagane, masz {myActionPoints})
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Fatigue warning */}
            {hasFatigue && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-950/20 px-2.5 py-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                <span className="text-xs font-medium text-red-400">
                  Zmeczenie bojowe: -{fatiguePercent}% sily ({fatigueTicks} tick{fatigueTicks !== 1 ? "i" : ""})
                </span>
              </div>
            )}

            {/* Percent presets */}
            <div
              className={`flex items-center gap-1.5 ${isMoveCoolingDown || !canAffordMove ? "opacity-50 pointer-events-none" : ""}`}
            >
              <span className="text-xs font-bold uppercase tracking-widest text-foreground/70 mr-1">Wyslij</span>
              {PERCENT_PRESETS.map((preset) => {
                const active = unitPercent === preset;
                return (
                  <button
                    key={preset}
                    onClick={() => onPercentChange(preset)}
                    disabled={isMoveCoolingDown || !canAffordMove}
                    className={`rounded-md border px-2.5 py-1 text-xs font-bold tabular-nums transition-all ${
                      active
                        ? "border-primary bg-primary/25 text-primary shadow-sm shadow-primary/20"
                        : "border-white/20 bg-white/8 text-foreground/70 hover:border-white/35 hover:bg-white/15 hover:text-foreground"
                    }`}
                  >
                    {preset === 100 ? "MAX" : `${preset}%`}
                  </button>
                );
              })}
            </div>

            {/* Unit type pills */}
            {visibleUnitTypes.length > 0 && (
              <div
                className={`flex items-center gap-1.5 flex-wrap ${isMoveCoolingDown || !canAffordMove ? "opacity-50 pointer-events-none" : ""}`}
              >
                {visibleUnitTypes.map(([unitType, count]) => {
                  const active = unitType === selectedUnitType;
                  const isInfantry = unitType === "infantry";
                  const mp = Math.max(1, unitConfigMap.get(unitType)?.manpower_cost ?? 1);
                  const reserved = isInfantry
                    ? visibleUnitTypes
                        .filter(([t]) => t !== "infantry")
                        .reduce((s, [t, c]) => s + c * Math.max(1, unitConfigMap.get(t)?.manpower_cost ?? 1), 0)
                    : 0;
                  const displayCount = isInfantry ? Math.max(0, count - reserved) : count;
                  const label = isInfantry ? `${displayCount}` : `${count}(${count * mp})`;
                  const unitData = unitConfigMap.get(unitType);

                  return (
                    <div key={unitType} className="group relative">
                      <button
                        onClick={() => onUnitTypeChange(unitType)}
                        disabled={isMoveCoolingDown || !canAffordMove}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-all ${
                          active
                            ? "border-primary bg-primary/25 text-primary shadow-sm shadow-primary/20"
                            : "border-white/20 bg-white/8 text-foreground/70 hover:border-white/35 hover:bg-white/15 hover:text-foreground"
                        }`}
                      >
                        <Image
                          src={getUnitAsset(unitType)}
                          alt={unitType}
                          width={16}
                          height={16}
                          className="h-4 w-4 object-contain"
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
                className="flex w-full items-center justify-center gap-1.5 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/35 hover:text-white/60 transition-colors"
              >
                <ChevronUp className={`h-3 w-3 transition-transform ${expanded ? "" : "rotate-180"}`} />
                {hasBuild && "Buduj"}
                {hasBuild && hasProduce && " · "}
                {hasProduce && "Produkuj"}
              </button>
            </div>

            {/* Build row */}
            {hasBuild && (
              <div data-tutorial="build-section" className={`border-t border-border px-3 py-2.5 ${expanded ? "block" : "hidden"} sm:block`}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground/60">Budynki</p>
                  {!canAffordBuild && (
                    <span className="flex items-center gap-1 text-xs font-medium text-amber-400">
                      <BoltIcon className="h-3 w-3" />
                      {AP_COSTS.build} AP wymagane
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
                  {buildOptions.map((building) => {
                    const isBuildingLocked = hasBuildingLocks && !unlockedBuildings?.includes(building.slug);
                    const typeInstances = instancesByType[building.slug] ?? [];
                    const currentRegionLevel =
                      typeInstances.length > 0 ? typeInstances[0].level : region.building_levels?.[building.slug];
                    const playerMaxLevel = buildingLevels?.[building.slug];
                    const isAtMaxLevel =
                      currentRegionLevel != null && playerMaxLevel != null && currentRegionLevel >= playerMaxLevel;
                    const isUpgrade = (currentRegionLevel ?? 0) > 0;
                    const nextLevel = isUpgrade ? (currentRegionLevel ?? 0) + 1 : 1;
                    const nextCost = building.level_stats?.[String(nextLevel)]?.energy_cost ?? building.energy_cost;
                    const asset = getPlayerBuildingAsset(
                      building.asset_key || building.slug,
                      ownerCosmetics,
                      building.asset_url,
                    );
                    const canAffordEnergy = myEnergy >= nextCost;
                    const canAfford = canAffordEnergy && canAffordBuild;

                    const stateClass = isBuildingLocked
                      ? "border-red-500/30 bg-red-950/20 opacity-50 cursor-not-allowed"
                      : isAtMaxLevel
                        ? "border-amber-500/30 bg-amber-950/15 cursor-default"
                        : canAfford
                          ? "border-green-500/35 bg-green-950/20 hover:border-green-400/60 hover:bg-green-950/30 cursor-pointer"
                          : "border-white/15 bg-muted/25 opacity-55 cursor-not-allowed";

                    return (
                      <div key={building.id} className="group relative">
                        <button
                          onClick={() => !isBuildingLocked && !isAtMaxLevel && canAfford && onBuild(building.slug)}
                          title={!canAffordBuild ? `Wymaga ${AP_COSTS.build} AP (masz ${myActionPoints})` : undefined}
                          className={`flex w-full flex-col items-center gap-0.5 rounded-lg border p-1.5 transition-all ${stateClass}`}
                        >
                          <div className="relative">
                            {asset && (
                              <Image src={asset} alt="" width={24} height={24} className="h-6 w-6 object-contain" />
                            )}
                            {isBuildingLocked && <Lock className="absolute -right-1 -top-1 h-2.5 w-2.5 text-red-400" />}
                            {!canAffordBuild && !isBuildingLocked && !isAtMaxLevel && (
                              <BoltIcon className="absolute -right-1 -top-1 h-2.5 w-2.5 text-amber-400" />
                            )}
                          </div>
                          <span className="w-full text-caption font-semibold text-foreground/70 leading-tight truncate text-center">
                            {building.name}
                          </span>
                          {isAtMaxLevel ? (
                            <span className="text-label font-bold text-amber-400">Max</span>
                          ) : (
                            <div className="flex items-center gap-0.5">
                              <span className="text-label text-yellow-400">⚡</span>
                              <span
                                className={`text-xs font-bold tabular-nums ${canAffordEnergy ? "text-green-400" : "text-red-400"}`}
                              >
                                {nextCost}
                              </span>
                              {isUpgrade && (
                                <span className="text-caption font-semibold text-amber-400 ml-0.5">Lv{nextLevel}</span>
                              )}
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
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground/60">Produkcja</p>
                  {!canAffordProduce && (
                    <span className="flex items-center gap-1 text-xs font-medium text-amber-400">
                      <BoltIcon className="h-3 w-3" />
                      {AP_COSTS.produce} AP wymagane
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
                  {producedUnits.map((unit) => {
                    const isUnitLocked =
                      hasUnitLocks && Boolean(unit.produced_by_slug) && !unlockedUnits?.includes(unit.slug);
                    // Get stats from level_stats based on producer building level
                    const producerInstances = instancesByType[unit.produced_by_slug ?? ""] ?? [];
                    const producerLevel =
                      producerInstances.length > 0
                        ? producerInstances[0].level
                        : (buildingLevels?.[unit.produced_by_slug ?? ""] ?? 1);
                    const lvlStats = unit.level_stats?.[String(producerLevel)] ?? {};
                    const effectiveCost = lvlStats.production_cost ?? unit.production_cost;
                    const effectiveManpower = lvlStats.manpower_cost ?? unit.manpower_cost ?? 1;
                    const _effectiveAttack = lvlStats.attack ?? unit.attack;
                    const canAffordEnergy = myEnergy >= effectiveCost;
                    const canAffordManpower = availableInfantry >= effectiveManpower;
                    const canAfford = canAffordEnergy && canAffordManpower && canAffordProduce;
                    const asset = getPlayerUnitAsset(unit.asset_key || unit.slug, myCosmetics, unit.asset_url);

                    const stateClass = isUnitLocked
                      ? "border-red-500/30 bg-red-950/20 opacity-50 cursor-not-allowed"
                      : canAfford
                        ? "border-green-500/35 bg-green-950/20 hover:border-green-400/60 hover:bg-green-950/30 cursor-pointer"
                        : "border-white/15 bg-muted/25 opacity-55 cursor-not-allowed";

                    return (
                      <div key={unit.id} className="group relative">
                        <button
                          onClick={() => !isUnitLocked && canAfford && onProduceUnit(unit.slug)}
                          title={
                            !canAffordProduce ? `Wymaga ${AP_COSTS.produce} AP (masz ${myActionPoints})` : undefined
                          }
                          className={`flex w-full flex-col items-center gap-0.5 rounded-lg border p-1.5 transition-all ${stateClass}`}
                        >
                          <div className="relative">
                            <Image src={asset} alt="" width={24} height={24} className="h-6 w-6 object-contain" />
                            {isUnitLocked && <Lock className="absolute -right-1 -top-1 h-2.5 w-2.5 text-red-400" />}
                            {!canAffordProduce && !isUnitLocked && (
                              <BoltIcon className="absolute -right-1 -top-1 h-2.5 w-2.5 text-amber-400" />
                            )}
                          </div>
                          <span className="w-full text-caption font-semibold text-foreground/70 leading-tight truncate text-center">
                            {unit.name}
                          </span>
                          {isUnitLocked ? (
                            <Lock className="h-3 w-3 text-muted-foreground/60" />
                          ) : (
                            <div className="flex items-center gap-0.5">
                              <span className="text-label text-yellow-400">⚡</span>
                              <span
                                className={`text-xs font-bold tabular-nums ${canAffordEnergy ? "text-green-400" : "text-red-400"}`}
                              >
                                {effectiveCost}
                              </span>
                              {effectiveManpower > 1 && (
                                <span
                                  className={`text-label font-bold tabular-nums ml-0.5 ${canAffordManpower ? "text-foreground/60" : "text-red-400"}`}
                                >
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
