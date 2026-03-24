"use client";

import Image from "next/image";
import { memo, useMemo } from "react";
import type { BuildingQueueItem, UnitQueueItem } from "@/hooks/useGameSocket";
import type { BuildingType, UnitType } from "@/lib/api";
import { getActionAsset, getPlayerBuildingAsset, getPlayerUnitAsset } from "@/lib/gameAssets";

interface BuildQueueProps {
  queue: BuildingQueueItem[];
  unitQueue: UnitQueueItem[];
  buildings: BuildingType[];
  units: UnitType[];
  myUserId: string;
  myCosmetics?: Record<string, unknown>;
}

export default memo(function BuildQueue({
  queue,
  unitQueue,
  buildings,
  units,
  myUserId,
  myCosmetics,
}: BuildQueueProps) {
  const myBuilds = useMemo(() => queue.filter((item) => item.player_id === myUserId), [queue, myUserId]);
  const myUnits = useMemo(() => unitQueue.filter((item) => item.player_id === myUserId), [unitQueue, myUserId]);

  const buildingMap = useMemo(
    () => Object.fromEntries(buildings.map((building) => [building.slug, building])),
    [buildings],
  );
  const unitMap = useMemo(() => Object.fromEntries(units.map((unit) => [unit.slug, unit])), [units]);

  if (myBuilds.length === 0 && myUnits.length === 0) return null;

  const buildItems = myBuilds.map((item, idx) => {
    const config = buildingMap[item.building_type];
    return {
      key: `${item.region_id}-${idx}`,
      name: config?.name || item.building_type,
      remaining: item.ticks_remaining,
      total: item.total_ticks || 1,
      image:
        getPlayerBuildingAsset(config?.asset_key || item.building_type, myCosmetics, config?.asset_url) ||
        getActionAsset("build"),
    };
  });

  const unitItems = myUnits.map((item, idx) => {
    const config = unitMap[item.unit_type];
    return {
      key: `${item.region_id}-${item.unit_type}-${idx}`,
      name: config?.name || item.unit_type,
      remaining: item.ticks_remaining,
      total: item.total_ticks || 1,
      image: getPlayerUnitAsset(config?.asset_key || item.unit_type, myCosmetics, config?.asset_url),
    };
  });

  return (
    <>
      {/* Desktop */}
      <div className="absolute bottom-4 left-4 z-20 hidden w-[220px] space-y-3 sm:block lg:bottom-4">
        {buildItems.length > 0 && (
          <QueueSection title={`Budowa (${buildItems.length})`} asset={getActionAsset("build")} items={buildItems} />
        )}
        {unitItems.length > 0 && (
          <QueueSection
            title={`Produkcja (${unitItems.length})`}
            asset={getPlayerUnitAsset("default", myCosmetics)}
            items={unitItems}
            accentClass="from-cyan-400 to-cyan-200"
          />
        )}
      </div>

      {/* Mobile – compact icons row below HUD */}
      <div className="absolute left-2 top-[120px] z-20 flex flex-wrap gap-1.5 sm:hidden">
        {[...buildItems, ...unitItems].map((item) => {
          const progress = Math.max(0, Math.min(1, 1 - item.remaining / item.total));
          const percent = Math.round(progress * 100);
          return (
            <div
              key={item.key}
              className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card"
              title={`${item.name} – ${percent}%`}
            >
              <Image
                src={item.image}
                alt={item.name}
                width={22}
                height={22}
                className="h-[22px] w-[22px] object-contain"
              />
              {/* Circular-ish progress ring via bottom border */}
              <div className="absolute inset-0 rounded-xl border-2 border-transparent" />
              <div
                className="absolute bottom-0 left-0 h-1 rounded-b-xl bg-gradient-to-r from-amber-500 to-amber-300"
                style={{ width: `${percent}%` }}
              />
              <span className="absolute -bottom-1 -right-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-card px-0.5 font-display text-[10px] font-bold tabular-nums text-accent">
                {percent}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
});

const QueueSection = memo(function QueueSection({
  title,
  asset,
  items,
  accentClass = "from-amber-500 to-amber-300",
}: {
  title: string;
  asset: string;
  items: Array<{
    key: string;
    name: string;
    remaining: number;
    total: number;
    image: string;
  }>;
  accentClass?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.24em] text-accent">
        <Image src={asset} alt="" width={16} height={16} className="h-4 w-4 object-contain" />
        {title}
      </div>
      {items.map((item) => {
        const progress = Math.max(0, Math.min(1, 1 - item.remaining / item.total));
        const percent = Math.round(progress * 100);
        return (
          <div
            key={item.key}
            className="overflow-hidden rounded-xl border border-border bg-card/80 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl"
          >
            <div className="flex items-center gap-2 px-2.5 py-2">
              <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
                <Image src={item.image} alt={item.name} width={28} height={28} className="h-7 w-7 object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-sm font-semibold tracking-wide text-foreground">
                  {item.name}
                </div>
                <div className="text-xs font-medium text-muted-foreground">
                  {item.remaining > 0 ? `${item.remaining} tur do końca` : "Ukończono!"}
                </div>
              </div>
              <span className="font-display text-xs font-bold tabular-nums text-accent">{percent}%</span>
            </div>
            <div className="h-1 w-full bg-muted/30">
              <div
                className={`h-full bg-gradient-to-r ${accentClass} transition-[width] duration-300`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});
