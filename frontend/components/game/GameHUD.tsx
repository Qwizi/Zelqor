"use client";

import { memo, useMemo } from "react";
import Image from "next/image";
import type { GamePlayer } from "@/hooks/useGameSocket";
import { Badge } from "@/components/ui/badge";

interface GameHUDProps {
  tick: number;
  tickIntervalMs: number;
  status: string;
  players: Record<string, GamePlayer>;
  rankedPlayers: Array<{
    user_id: string;
    username: string;
    color: string;
    regionCount: number;
    unitCount: number;
    isAlive: boolean;
    isBot: boolean;
  }>;
  myUserId: string;
  myRegionCount: number;
  myUnitCount: number;
  myCurrency: number;
}

function formatClock(tick: number, tickIntervalMs: number) {
  const elapsedSeconds = Math.max(0, Math.floor((tick * tickIntervalMs) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function statusLabel(status: string) {
  if (status === "selecting") return "Wybór stolicy";
  if (status === "in_progress") return "W trakcie";
  if (status === "finished") return "Koniec";
  return status;
}

export default memo(function GameHUD({
  tick,
  tickIntervalMs,
  status,
  players,
  rankedPlayers,
  myUserId,
  myRegionCount,
  myUnitCount,
  myCurrency,
}: GameHUDProps) {
  const aliveCount = useMemo(
    () => Object.values(players).filter((player) => player.is_alive).length,
    [players]
  );
  const formattedClock = useMemo(() => formatClock(tick, tickIntervalMs), [tick, tickIntervalMs]);

  return (
    <div data-tutorial="hud" className="absolute left-2 top-2 z-10 flex max-w-[calc(100vw-5rem)] flex-col gap-2 sm:left-4 sm:top-4 sm:max-w-[280px]">
      <div className="inline-flex w-fit max-w-full items-center gap-2 rounded-full border border-white/10 bg-slate-950/86 px-3 py-2 text-[11px] text-zinc-200 shadow-[0_12px_32px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:px-3.5">
        <span className="font-display text-sm text-cyan-200 sm:text-base">{formattedClock}</span>
        <span className="h-1 w-1 rounded-full bg-white/20" />
        <Badge className="h-auto border-0 bg-cyan-400/15 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-400/15">
          {statusLabel(status)}
        </Badge>
        <span className="hidden text-[10px] text-slate-400 sm:inline">{aliveCount} aktywnych</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <CompactStat
          icon="/assets/common/coin_w200.webp"
          label="Waluta"
          value={myCurrency}
        />
        <CompactStat
          icon="/assets/icons/storage_icon.webp"
          label="Regiony"
          value={myRegionCount}
        />
        <CompactStat
          icon="/assets/units/ground_unit.webp"
          label="Siła"
          value={myUnitCount}
        />
      </div>

      <div className="hidden rounded-[22px] border border-white/10 bg-slate-950/82 p-2 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:block">
        <div className="px-1 pb-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">
          Ranking
        </div>
        <div className="space-y-1.5">
          {rankedPlayers.slice(0, 6).map((player, index) => (
            <div
              key={player.user_id}
              className={`grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-2 py-1.5 text-xs ${
                player.user_id === myUserId ? "bg-white/[0.05]" : "bg-transparent"
              }`}
            >
              <div className="font-display text-zinc-500">{index + 1}</div>
              <div className="min-w-0">
                <div className={`truncate ${player.isAlive ? "text-zinc-100" : "text-zinc-500 line-through"}`}>
                  <span
                    className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
                    style={{ backgroundColor: player.color }}
                  />
                  {player.username}
                  {player.user_id === myUserId ? " (Ty)" : ""}
                  {player.isBot && (
                    <span className="ml-1 text-[9px] text-zinc-500" title="Bot AI">BOT</span>
                  )}
                </div>
              </div>
              <div className="text-right text-[11px] text-zinc-500">
                {player.regionCount}r · {player.unitCount}u
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

const CompactStat = memo(function CompactStat({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: number;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/82 px-2.5 py-2 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:px-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-slate-500">
        <Image
          src={icon}
          alt=""
          width={14}
          height={14}
          className="h-3.5 w-3.5 object-contain"
        />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate font-display text-lg leading-none text-zinc-50 sm:text-xl">
        {value}
      </div>
    </div>
  );
});
