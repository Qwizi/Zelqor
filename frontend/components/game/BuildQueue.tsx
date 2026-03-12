"use client";

import { memo, useMemo } from "react";
import Image from "next/image";
import type { BuildingQueueItem, UnitQueueItem } from "@/hooks/useGameSocket";
import type { BuildingType, UnitType } from "@/lib/api";
import { getActionAsset, getBuildingAsset, getUnitAsset } from "@/lib/gameAssets";

interface BuildQueueProps {
  queue: BuildingQueueItem[];
  unitQueue: UnitQueueItem[];
  buildings: BuildingType[];
  units: UnitType[];
  myUserId: string;
}

export default memo(function BuildQueue({
  queue,
  unitQueue,
  buildings,
  units,
  myUserId,
}: BuildQueueProps) {
  const myBuilds = useMemo(() => queue.filter((item) => item.player_id === myUserId), [queue, myUserId]);
  const myUnits = useMemo(() => unitQueue.filter((item) => item.player_id === myUserId), [unitQueue, myUserId]);

  const buildingMap = useMemo(
    () => Object.fromEntries(buildings.map((building) => [building.slug, building])),
    [buildings]
  );
  const unitMap = useMemo(
    () => Object.fromEntries(units.map((unit) => [unit.slug, unit])),
    [units]
  );

  if (myBuilds.length === 0 && myUnits.length === 0) return null;

  return (
    <div className="absolute bottom-[5.5rem] left-2 right-2 z-20 space-y-2 sm:bottom-4 sm:left-4 sm:right-auto sm:w-[320px] sm:space-y-3 lg:bottom-4">
      {myBuilds.length > 0 && (
        <QueueSection
          title={`Budowa (${myBuilds.length})`}
          asset={getActionAsset("build")}
          items={myBuilds.map((item, idx) => {
            const config = buildingMap[item.building_type];
            return {
              key: `${item.region_id}-${idx}`,
              name: config?.name || item.building_type,
              remaining: item.ticks_remaining,
              total: item.total_ticks || 1,
              image: getBuildingAsset(config?.asset_key || item.building_type) || getActionAsset("build"),
            };
          })}
        />
      )}

      {myUnits.length > 0 && (
        <QueueSection
          title={`Produkcja (${myUnits.length})`}
          asset={getUnitAsset("default")}
          items={myUnits.map((item, idx) => {
            const config = unitMap[item.unit_type];
            return {
              key: `${item.region_id}-${item.unit_type}-${idx}`,
              name: config?.name || item.unit_type,
              remaining: item.ticks_remaining,
              total: item.total_ticks || 1,
              image: getUnitAsset(config?.asset_key || item.unit_type),
            };
          })}
          accentClass="from-cyan-400 to-cyan-200"
        />
      )}
    </div>
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
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.24em] text-amber-300">
        <Image
          src={asset}
          alt=""
          width={20}
          height={20}
          className="h-5 w-5 object-contain"
        />
        {title}
      </div>
      {items.map((item) => {
        const progress = Math.max(0, Math.min(1, 1 - item.remaining / item.total));
        const percent = Math.round(progress * 100);
        return (
          <div
            key={item.key}
            className="overflow-hidden rounded-[22px] border border-white/10 bg-slate-950/80 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl"
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                <Image
                  src={item.image}
                  alt={item.name}
                  width={56}
                  height={56}
                  className="h-12 w-12 object-contain"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-base text-white">
                  {item.name}
                </div>
                <div className="text-xs text-zinc-400">
                  {item.remaining > 0 ? `${item.remaining} tur do końca` : "Ukończono!"}
                </div>
              </div>
              <span className="text-xs font-mono font-bold text-amber-300">
                {percent}%
              </span>
            </div>
            <div className="h-1.5 w-full bg-white/10">
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
