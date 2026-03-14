"use client";

import { memo, useMemo } from "react";
import Image from "next/image";
import type { GameRegion, GamePlayer, BuildingQueueItem } from "@/hooks/useGameSocket";
import type { BuildingType, UnitType } from "@/lib/api";
import { getActionAsset, getBuildingAsset, getUnitAsset } from "@/lib/gameAssets";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Lock } from "lucide-react";

interface RegionPanelProps {
  regionId: string;
  region: GameRegion;
  players: Record<string, GamePlayer>;
  myUserId: string;
  myEnergy: number;
  buildings: BuildingType[];
  buildingQueue: BuildingQueueItem[];
  units: UnitType[];
  onBuild: (buildingType: string) => void;
  onProduceUnit: (unitType: string) => void;
  onClose: () => void;
  /** When non-empty, buildings not in this list show a lock icon and are disabled */
  unlockedBuildings?: string[];
  /** When non-empty, units not in this list (and with produced_by_slug) show a lock icon and are disabled */
  unlockedUnits?: string[];
  /** Player's max buildable levels from their deck */
  buildingLevels?: Record<string, number>;
  /** Current building levels in this region */
  regionBuildingLevels?: Record<string, number>;
}

export default memo(function RegionPanel({
  regionId,
  region,
  players,
  myUserId,
  myEnergy,
  buildings,
  buildingQueue,
  units,
  onBuild,
  onProduceUnit,
  onClose,
  unlockedBuildings,
  unlockedUnits,
  buildingLevels,
  regionBuildingLevels,
}: RegionPanelProps) {
  const hasBuildingLocks = unlockedBuildings != null && unlockedBuildings.length > 0;
  const hasUnitLocks = unlockedUnits != null && unlockedUnits.length > 0;
  const isOwned = region.owner_id === myUserId;
  const owner = region.owner_id ? players[region.owner_id] : null;
  const buildingCounts = useMemo(() => region.buildings ?? {}, [region.buildings]);

  const unitConfigMap = useMemo(
    () => new Map(units.map((unit) => [unit.slug, unit])),
    [units]
  );
  const getUnitConfig = (slug: string) => unitConfigMap.get(slug) ?? null;

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

  const { buildOptions, compactBuildOptions, producedUnits, compactProducedUnits, displayedBuildings, compactDisplayedBuildings } = useMemo(() => {
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
    return {
      buildOptions: buildOpts,
      compactBuildOptions: buildOpts.slice(0, 6),
      producedUnits: produced,
      compactProducedUnits: produced.slice(0, 4),
      displayedBuildings: displayed,
      compactDisplayedBuildings: displayed.slice(0, 5),
    };
  }, [buildings, units, region.is_coastal, buildingCounts, queuedBuildingCounts]);

  const { unitBreakdown, compactUnitBreakdown, reservedInfantry } = useMemo(() => {
    const breakdown = Object.entries(region.units ?? {})
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
    const reserved = breakdown.reduce((total, [type, count]) => {
      if (type === "infantry") return total;
      const manpowerCost = Math.max(1, unitConfigMap.get(type)?.manpower_cost ?? 1);
      return total + count * manpowerCost;
    }, 0);
    return {
      unitBreakdown: breakdown,
      compactUnitBreakdown: breakdown.slice(0, 4),
      reservedInfantry: reserved,
    };
  }, [region.units, unitConfigMap]);

  const unitType = region.unit_type ?? "infantry";
  const movementHint =
    unitType === "fighter"
      ? "Lotnictwo korzysta z lotniska i uderza dalej niz piechota."
      : unitType === "ship"
        ? "Flota dziala tylko na regionach przybrzeznych."
        : "Jednostki ladowe walcza i poruszaja sie po standardowym grafie regionow.";

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 h-[min(68vh,720px)] overflow-y-auto rounded-t-[28px] border-t border-white/10 bg-slate-950/92 p-4 shadow-[0_-20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-[360px] sm:rounded-t-none sm:border-l sm:border-t-0 sm:shadow-[-20px_0_60px_rgba(0,0,0,0.3)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
            Region
          </p>
          <h3 className="font-display text-2xl text-zinc-50">{region.name}</h3>
        </div>
        <button
          onClick={onClose}
          aria-label="Zamknij"
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
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

      <p className="text-sm text-zinc-400">{region.country_code} · ID {regionId}</p>

      <div className="mt-4 space-y-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
          <span className="min-w-0 text-zinc-400">Właściciel</span>
          {owner ? (
            <span className="flex max-w-[62%] items-center gap-1.5">
              <Badge style={{ backgroundColor: owner.color }} className="truncate border-0 text-white">
                {owner.username}
              </Badge>
              {owner.is_bot && (
                <span className="shrink-0 rounded bg-zinc-700 px-1 py-0.5 text-[9px] uppercase tracking-wider text-zinc-400">
                  bot
                </span>
              )}
            </span>
          ) : (
            <span className="text-zinc-500">Brak</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <span className="block text-xs uppercase tracking-[0.16em] text-zinc-500">Jednostki</span>
            <div className="mt-2 flex min-w-0 items-center gap-2">
              <Image
                src={getUnitAsset(region.unit_type ?? "default")}
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 object-contain"
              />
              <span className="truncate font-display text-2xl text-zinc-50">
                {isOwned ? region.unit_count : "?"}
              </span>
            </div>
          </div>
          <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <span className="block text-xs uppercase tracking-[0.16em] text-zinc-500">Energia</span>
            <div className="mt-2 flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center text-cyan-400">⚡</span>
              <span className="truncate font-display text-2xl text-zinc-50">
                {isOwned ? myEnergy : "?"}
              </span>
            </div>
          </div>
        </div>

        {compactUnitBreakdown.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
            <div className="mb-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
              Typy jednostek
            </div>
            <div className="grid gap-2">
              {compactUnitBreakdown.map(([type, count]) => (
                (() => {
                  const unitConfig = getUnitConfig(type);
                  const manpowerCost = Math.max(1, unitConfig?.manpower_cost ?? 1);
                  const effectivePower = count * manpowerCost;
                  const isBaseInfantry = type === "infantry";
                  const freeInfantry = Math.max(0, count - reservedInfantry);

                  return (
                    <div
                      key={type}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <Image
                            src={getUnitAsset(type)}
                            alt={type}
                            width={18}
                            height={18}
                            className="h-[18px] w-[18px] object-contain"
                          />
                          <span className="truncate text-sm text-zinc-100">{getUnitConfig(type)?.name ?? type}</span>
                        </div>
                        {isBaseInfantry && reservedInfantry > 0 && (
                          <div className="mt-1 text-[11px] text-zinc-500">
                            wolna sila {freeInfantry} · zaladowana w nosnikach {reservedInfantry}
                          </div>
                        )}
                        {!isBaseInfantry && manpowerCost > 1 && (
                          <div className="mt-1 text-[11px] text-zinc-500">
                            {count} nosnik{count === 1 ? "" : "i"} · sila {effectivePower} · zaloga {manpowerCost}/szt.
                          </div>
                        )}
                      </div>
                      <Badge variant="secondary">
                        {isOwned ? (isBaseInfantry ? freeInfantry : effectivePower) : "?"}
                      </Badge>
                    </div>
                  );
                })()
              ))}
            </div>
            {unitBreakdown.length > compactUnitBreakdown.length && (
              <div className="mt-2 text-[11px] text-zinc-500">
                +{unitBreakdown.length - compactUnitBreakdown.length} dodatkowych typow
              </div>
            )}
          </div>
        )}

        {region.is_capital && (
          <div className="flex items-center gap-2 rounded-2xl border border-yellow-300/15 bg-yellow-300/5 px-3 py-2 text-yellow-300">
            <Image
              src="/assets/units/capital_star.png"
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 object-contain"
            />
            <span className="text-sm font-medium">Stolica</span>
          </div>
        )}

        {region.is_coastal && (
          <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/5 px-3 py-2 text-sm text-cyan-200">
            Region przybrzezny
          </div>
        )}

        {compactDisplayedBuildings.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
            <div className="mb-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
              Infrastruktura
            </div>
            <div className="grid gap-2">
              {compactDisplayedBuildings.map((building) => {
                const regionLevel = regionBuildingLevels?.[building.slug];
                const levelColor =
                  regionLevel === 3
                    ? "text-yellow-300 bg-yellow-300/10 border-yellow-300/20"
                    : regionLevel === 2
                      ? "text-blue-300 bg-blue-300/10 border-blue-300/20"
                      : "text-zinc-400 bg-white/[0.06] border-white/10";
                return (
                  <div
                    key={building.slug}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {getBuildingAsset(building.asset_key || building.slug) && (
                        <Image
                          src={getBuildingAsset(building.asset_key || building.slug)!}
                          alt={building.name}
                          width={22}
                          height={22}
                          className="h-[22px] w-[22px] object-contain"
                        />
                      )}
                      <span className="truncate text-sm text-zinc-100">{building.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {regionLevel != null && (
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${levelColor}`}>
                          Lvl {regionLevel}
                        </span>
                      )}
                      <Badge variant="secondary">x{buildingCounts[building.slug]}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
            {displayedBuildings.length > compactDisplayedBuildings.length && (
              <div className="mt-2 text-[11px] text-zinc-500">
                +{displayedBuildings.length - compactDisplayedBuildings.length} kolejnych budynkow
              </div>
            )}
          </div>
        )}

        {Object.keys(queuedBuildingCounts).length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
            <div className="mb-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
              W kolejce
            </div>
            <div className="grid gap-2">
              {Object.entries(queuedBuildingCounts).map(([slug, count]) => {
                const building = buildings.find((entry) => entry.slug === slug);
                const label = building?.name ?? slug;
                const asset = getBuildingAsset(building?.asset_key || slug);
                return (
                  <div
                    key={slug}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {asset && (
                        <Image
                          src={asset}
                          alt={label}
                          width={22}
                          height={22}
                          className="h-[22px] w-[22px] object-contain"
                        />
                      )}
                      <span className="truncate text-sm text-zinc-100">{label}</span>
                    </div>
                    <Badge variant="secondary">+{count}</Badge>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {region.defense_bonus > 0 && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <span className="min-w-0 text-zinc-400">Bonus obrony</span>
            <span className="whitespace-nowrap flex items-center gap-1 text-green-400">
              <Image
                src={getActionAsset("defense")}
                alt=""
                width={14}
                height={14}
                className="h-3.5 w-3.5 object-contain"
              />
              +{Math.round(region.defense_bonus * 100)}%
            </span>
          </div>
        )}

        {(region.energy_generation_bonus ?? 0) > 0 && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <span className="min-w-0 text-zinc-400">Energia regionu</span>
            <span className="whitespace-nowrap flex items-center gap-1 text-cyan-300">
              <span className="text-[13px]">⚡</span>
              +{(region.energy_generation_bonus ?? 0).toFixed(1)}/tick
            </span>
          </div>
        )}

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
          {movementHint}
        </div>
      </div>

      {isOwned && (
        <>
          <Separator className="my-5 bg-white/10" />
          <div data-tutorial="build-section">
          <h4 className="flex items-center gap-2 text-sm font-medium text-amber-400">
            <Image
              src={getActionAsset("build")}
              alt=""
              width={18}
              height={18}
              className="h-[18px] w-[18px] object-contain"
            />
            Rozbudowa infrastruktury
          </h4>
          <div className="mt-3 space-y-2">
            {compactBuildOptions.map((building) => {
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
                  onClick={() => !isBuildingLocked && onBuild(building.slug)}
                  disabled={myEnergy < building.energy_cost || isBuildingLocked || isAtMaxLevel === true}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[22px] border border-amber-400/10 bg-amber-500/10 px-3 py-3 text-left text-sm transition-colors hover:bg-amber-500/15 disabled:opacity-40"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    {getBuildingAsset(building.asset_key || building.slug) && (
                      <Image
                        src={getBuildingAsset(building.asset_key || building.slug)!}
                        alt={building.name}
                        width={32}
                        height={32}
                        className="h-8 w-8 shrink-0 object-contain"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 truncate font-medium text-zinc-50">
                        {isBuildingLocked && <Lock className="h-3 w-3 shrink-0 text-zinc-500" />}
                        {displayName}
                      </span>
                      <span className="mt-1 block text-[11px] leading-4 text-zinc-400">
                        {isBuildingLocked
                          ? "Wymaga blueprintu z talii"
                          : isAtMaxLevel
                            ? "Max"
                            : canUpgrade
                              ? upgradeLabel
                              : `Limit ${(buildingCounts[building.slug] ?? 0) + (queuedBuildingCounts[building.slug] ?? 0)}/${building.max_per_region}`}
                      </span>
                    </span>
                  </span>
                  <div className="text-right text-[11px] text-zinc-400">
                    {isBuildingLocked ? (
                      <Lock className="ml-auto h-4 w-4 text-zinc-600" />
                    ) : isAtMaxLevel ? (
                      <span className="rounded border border-yellow-300/20 bg-yellow-300/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-300">
                        Max
                      </span>
                    ) : (
                      <>
                        <span className="flex items-center justify-end gap-1">
                          <span className="text-[13px] text-cyan-400">⚡</span>
                          {building.energy_cost}
                        </span>
                        <span className="mt-1 flex items-center justify-end gap-1">
                          <Image
                            src="/assets/icons/time_icon.png"
                            alt=""
                            width={14}
                            height={14}
                            className="h-3.5 w-3.5 object-contain opacity-70"
                          />
                          {building.build_time_ticks} tick
                        </span>
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {buildOptions.length > compactBuildOptions.length && (
            <div className="mt-2 text-[11px] text-zinc-500">
              Pokazano {compactBuildOptions.length} z {buildOptions.length} mozliwych budynkow
            </div>
          )}
          </div>{/* close data-tutorial="build-section" */}

          {compactProducedUnits.length > 0 && (
            <>
              <Separator className="my-5 bg-white/10" />
              <h4 className="flex items-center gap-2 text-sm font-medium text-cyan-300">
                <Image
                  src={getUnitAsset(region.unit_type ?? "default")}
                  alt=""
                  width={18}
                  height={18}
                  className="h-[18px] w-[18px] object-contain"
                />
                Produkcja jednostek specjalnych
              </h4>
              <div className="mt-3 space-y-2">
                {compactProducedUnits.map((unit) => {
                  const isUnitLocked = hasUnitLocks && Boolean(unit.produced_by_slug) && !unlockedUnits!.includes(unit.slug);
                  return (
                    <button
                      key={unit.id}
                      onClick={() => !isUnitLocked && onProduceUnit(unit.slug)}
                      disabled={myEnergy < unit.production_cost || isUnitLocked}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[22px] border border-cyan-400/10 bg-cyan-500/10 px-3 py-3 text-left transition-colors hover:bg-cyan-500/15 disabled:opacity-40"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Image
                          src={getUnitAsset(unit.asset_key || unit.slug)}
                          alt={unit.name}
                          width={28}
                          height={28}
                          className="h-7 w-7 object-contain"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 truncate font-medium text-zinc-50">
                            {isUnitLocked && <Lock className="h-3 w-3 shrink-0 text-zinc-500" />}
                            {unit.name}
                          </div>
                          <div className="text-xs text-zinc-400">
                            {isUnitLocked ? "Wymaga blueprintu z talii" : unit.description}
                          </div>
                        </div>
                      </div>
                      <div className="whitespace-nowrap text-right text-xs text-zinc-400">
                        {isUnitLocked ? (
                          <Lock className="ml-auto h-4 w-4 text-zinc-600" />
                        ) : (
                          <>
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-[13px] text-cyan-400">⚡</span>
                              {unit.production_cost}
                            </div>
                            <div>Załoga: {unit.manpower_cost} piech.</div>
                            <div>{unit.production_time_ticks} tick</div>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              {producedUnits.length > compactProducedUnits.length && (
                <div className="mt-2 text-[11px] text-zinc-500">
                  +{producedUnits.length - compactProducedUnits.length} dodatkowych jednostek specjalnych
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
});
