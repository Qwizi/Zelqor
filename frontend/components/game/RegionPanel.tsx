"use client";

import Image from "next/image";
import type { GameRegion, GamePlayer, BuildingQueueItem } from "@/hooks/useGameSocket";
import type { BuildingType, UnitType } from "@/lib/api";
import { getActionAsset, getBuildingAsset, getUnitAsset } from "@/lib/gameAssets";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface RegionPanelProps {
  regionId: string;
  region: GameRegion;
  players: Record<string, GamePlayer>;
  myUserId: string;
  myCurrency: number;
  buildings: BuildingType[];
  buildingQueue: BuildingQueueItem[];
  units: UnitType[];
  onBuild: (buildingType: string) => void;
  onProduceUnit: (unitType: string) => void;
  onClose: () => void;
}

export default function RegionPanel({
  regionId,
  region,
  players,
  myUserId,
  myCurrency,
  buildings,
  buildingQueue,
  units,
  onBuild,
  onProduceUnit,
  onClose,
}: RegionPanelProps) {
  const isOwned = region.owner_id === myUserId;
  const owner = region.owner_id ? players[region.owner_id] : null;
  const buildingCounts = region.buildings ?? {};
  const queuedBuildingCounts = buildingQueue
    .filter((item) => item.region_id === regionId)
    .reduce<Record<string, number>>((acc, item) => {
      acc[item.building_type] = (acc[item.building_type] ?? 0) + 1;
      return acc;
    }, {});

  const buildOptions = [...buildings]
    .filter((building) => !building.requires_coastal || region.is_coastal)
    .filter(
      (building) =>
        (buildingCounts[building.slug] ?? 0) + (queuedBuildingCounts[building.slug] ?? 0) <
        building.max_per_region
    )
    .sort((a, b) => a.order - b.order || a.currency_cost - b.currency_cost || a.name.localeCompare(b.name));

  const producedUnits = [...units]
    .filter((unit) => Boolean(unit.produced_by_slug))
    .filter((unit) => (buildingCounts[unit.produced_by_slug ?? ""] ?? 0) > 0)
    .sort((a, b) => a.order - b.order || a.production_cost - b.production_cost || a.name.localeCompare(b.name));

  const displayedBuildings = [...buildings]
    .filter((building) => (buildingCounts[building.slug] ?? 0) > 0)
    .sort((a, b) => a.order - b.order);
  const unitBreakdown = Object.entries(region.units ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const getUnitConfig = (slug: string) =>
    units.find((unit) => unit.slug === slug) ?? null;
  const reservedInfantry = unitBreakdown.reduce((total, [type, count]) => {
    if (type === "infantry") return total;
    const manpowerCost = Math.max(1, getUnitConfig(type)?.manpower_cost ?? 1);
    return total + count * manpowerCost;
  }, 0);

  const unitType = region.unit_type ?? "infantry";
  const movementHint =
    unitType === "fighter"
      ? "Lotnictwo korzysta z lotniska i uderza dalej niz piechota."
      : unitType === "ship"
        ? "Flota dziala tylko na regionach przybrzeznych."
        : "Jednostki ladowe walcza i poruszaja sie po standardowym grafie regionow.";

  return (
    <div className="absolute right-0 top-0 z-10 h-full w-[360px] overflow-y-auto border-l border-white/10 bg-slate-950/88 p-4 shadow-[-20px_0_60px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
            Region
          </p>
          <h3 className="font-display text-2xl text-zinc-50">{region.name}</h3>
        </div>
        <button
          onClick={onClose}
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
            <Badge style={{ backgroundColor: owner.color }} className="max-w-[62%] truncate border-0 text-white">
              {owner.username}
            </Badge>
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
            <span className="block text-xs uppercase tracking-[0.16em] text-zinc-500">Waluta</span>
            <div className="mt-2 flex min-w-0 items-center gap-2">
              <Image
                src="/assets/common/coin_w200.webp"
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 object-contain"
              />
              <span className="truncate font-display text-2xl text-zinc-50">
                {isOwned ? myCurrency : "?"}
              </span>
            </div>
          </div>
        </div>

        {unitBreakdown.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
            <div className="mb-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
              Typy jednostek
            </div>
            <div className="grid gap-2">
              {unitBreakdown.map(([type, count]) => (
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
                          <span className="truncate text-sm text-zinc-100">{type}</span>
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

        {displayedBuildings.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
            <div className="mb-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
              Infrastruktura
            </div>
            <div className="grid gap-2">
              {displayedBuildings.map((building) => (
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
                  <Badge variant="secondary">x{buildingCounts[building.slug]}</Badge>
                </div>
              ))}
            </div>
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

        {(region.currency_generation_bonus ?? 0) > 0 && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <span className="min-w-0 text-zinc-400">Dochód regionu</span>
            <span className="whitespace-nowrap flex items-center gap-1 text-amber-300">
              <Image
                src="/assets/common/coin_w200.webp"
                alt=""
                width={14}
                height={14}
                className="h-3.5 w-3.5 object-contain"
              />
              +{(region.currency_generation_bonus ?? 0).toFixed(1)}/tick
            </span>
          </div>
        )}

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-zinc-400">
          {movementHint}
        </div>
      </div>

      {isOwned && (
        <>
          <Separator className="my-5 bg-white/10" />
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
          <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2">
            {buildOptions.map((building) => (
              <button
                key={building.id}
                onClick={() => onBuild(building.slug)}
                disabled={myCurrency < building.currency_cost}
                className="flex min-h-[132px] min-w-0 flex-col items-start justify-between rounded-[22px] border border-amber-400/10 bg-amber-500/10 p-3 text-left text-sm transition-colors hover:bg-amber-500/15 disabled:opacity-40"
              >
                <span className="flex min-w-0 items-start gap-3">
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
                    <span className="block truncate font-medium text-zinc-50">{building.name}</span>
                    <span className="mt-1 block text-xs leading-4 text-zinc-400">
                      {building.description}
                    </span>
                  </span>
                </span>
                <div className="w-full space-y-1 text-xs text-zinc-400">
                  <span className="flex items-center gap-1">
                    <Image
                      src="/assets/common/coin_w200.webp"
                      alt=""
                      width={14}
                      height={14}
                      className="h-3.5 w-3.5 object-contain"
                    />
                    {building.currency_cost}
                  </span>
                  <span className="block">
                    Limit: {(buildingCounts[building.slug] ?? 0) + (queuedBuildingCounts[building.slug] ?? 0)}/{building.max_per_region}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {producedUnits.length > 0 && (
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
                {producedUnits.map((unit) => (
                  <button
                    key={unit.id}
                    onClick={() => onProduceUnit(unit.slug)}
                    disabled={myCurrency < unit.production_cost}
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
                        <div className="truncate font-medium text-zinc-50">{unit.name}</div>
                        <div className="text-xs text-zinc-400">{unit.description}</div>
                      </div>
                    </div>
                    <div className="whitespace-nowrap text-right text-xs text-zinc-400">
                      <div className="flex items-center justify-end gap-1">
                        <Image
                          src="/assets/common/coin_w200.webp"
                          alt=""
                          width={14}
                          height={14}
                          className="h-3.5 w-3.5 object-contain"
                        />
                        {unit.production_cost}
                      </div>
                      <div>Załoga: {unit.manpower_cost} piech.</div>
                      <div>{unit.production_time_ticks} tick</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
