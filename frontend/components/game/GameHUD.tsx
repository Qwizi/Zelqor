"use client";

import Image from "next/image";
import type { GamePlayer, GameEvent } from "@/hooks/useGameSocket";
import { getActionAsset, getUnitAsset, getBuildingAsset } from "@/lib/gameAssets";
import { Badge } from "@/components/ui/badge";

interface GameHUDProps {
  tick: number;
  tickIntervalMs: number;
  status: string;
  players: Record<string, GamePlayer>;
  events: GameEvent[];
  myUserId: string;
  myRegionCount: number;
  myUnitCount: number;
  myCurrency: number;
}

export default function GameHUD({
  tick,
  tickIntervalMs,
  status,
  players,
  events,
  myUserId,
  myRegionCount,
  myUnitCount,
  myCurrency,
}: GameHUDProps) {
  const recentEvents = events.slice(-8).reverse();
  const aliveCount = Object.values(players).filter((player) => player.is_alive).length;
  const elapsedSeconds = Math.max(0, Math.floor((tick * tickIntervalMs) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  const formattedClock =
    hours > 0
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return (
    <div className="absolute left-0 top-0 z-10 flex w-[360px] max-w-[calc(100vw-1rem)] flex-col gap-3 p-3 sm:p-4">
      <div className="overflow-hidden rounded-[26px] border border-cyan-300/10 bg-slate-950/82 shadow-[0_18px_60px_rgba(0,0,0,0.4)] backdrop-blur-xl">
        <div className="flex items-center gap-4 border-b border-white/10 px-4 py-4">
          <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
            <Image
              src="/assets/time_play/timer_edges.png"
              alt=""
              fill
              sizes="96px"
              loading="eager"
              className="object-contain opacity-95"
            />
            <Image
              src="/assets/time_play/timer_holo.png"
              alt=""
              fill
              sizes="96px"
              loading="eager"
              className="object-contain opacity-80"
            />
            <div className="relative font-display text-3xl text-cyan-200 drop-shadow-[0_0_18px_rgba(34,211,238,0.35)]">
              {formattedClock}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
              Czas meczu
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Badge className="border-0 bg-cyan-400/15 px-3 py-1 text-cyan-200 hover:bg-cyan-400/15">
                {status === "selecting"
                  ? "Wybierz stolicę"
                  : status === "in_progress"
                    ? "W trakcie"
                    : status}
              </Badge>
              <span className="text-xs text-slate-400">{aliveCount} aktywnych</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-300/85">
              Panel dowodzenia powinien byc czytelny z pierwszego spojrzenia,
              wiec timer jest teraz glowym akcentem zamiast malym detalem.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 px-4 py-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
            <div className="flex items-center gap-2">
              <Image
                src="/assets/units/capital_star.png"
                alt=""
                width={18}
                height={18}
                className="h-[18px] w-[18px] object-contain"
              />
              <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                Regiony
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Image
                src="/assets/units/capital_tag.webp"
                alt=""
                width={18}
                height={18}
                className="h-[18px] w-[18px] object-contain"
              />
              <span className="font-display text-2xl text-zinc-50">{myRegionCount}</span>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
            <div className="flex items-center gap-2">
              <Image
                src={getUnitAsset()}
                alt=""
                width={18}
                height={18}
                className="h-[18px] w-[18px] object-contain"
              />
              <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                Jednostki
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Image
                src={getUnitAsset()}
                alt=""
                width={20}
                height={20}
                className="h-5 w-5 object-contain"
              />
              <span className="font-display text-2xl text-zinc-50">{myUnitCount}</span>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
            <div className="flex items-center gap-2">
              <Image
                src="/assets/common/coin_w200.webp"
                alt=""
                width={18}
                height={18}
                className="h-[18px] w-[18px] object-contain"
              />
              <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                Waluta
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Image
                src="/assets/common/coin_w200.webp"
                alt=""
                width={20}
                height={20}
                className="h-5 w-5 object-contain"
              />
              <span className="font-display text-2xl text-zinc-50">{myCurrency}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/78 backdrop-blur-xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-xs uppercase tracking-[0.24em] text-slate-400">
          <Image
            src={getActionAsset("players")}
            alt=""
            width={14}
            height={14}
            className="h-3.5 w-3.5 object-contain"
          />
          Gracze
        </div>
        <div className="space-y-2 px-4 py-3">
          {Object.entries(players).map(([pid, player]) => (
            <div
              key={pid}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm"
            >
              <div
                className="h-3 w-3 rounded-full ring-2 ring-white/10"
                style={{ backgroundColor: player.color }}
              />
              <span
                className={`flex-1 truncate ${!player.is_alive ? "text-zinc-500 line-through" : "text-zinc-100"}`}
              >
                {player.username}
                {pid === myUserId && " (Ty)"}
              </span>
              {!player.is_alive ? (
                <span className="text-[11px] uppercase tracking-[0.2em] text-red-400">
                  poza grą
                </span>
              ) : (
                <Badge className="border-0 bg-emerald-400/12 text-emerald-300 hover:bg-emerald-400/12">
                  aktywny
                </Badge>
              )}
            </div>
          ))}
        </div>
      </div>

      {recentEvents.length > 0 && (
        <div className="overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/78 backdrop-blur-xl">
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
            <Image
              src="/assets/notifications/friends_match_invitation.webp"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 rounded-lg object-cover"
            />
            <div className="text-xs uppercase tracking-[0.24em] text-slate-400">
              Zdarzenia
            </div>
          </div>
          <div className="max-h-56 space-y-2 overflow-y-auto px-4 py-3">
            {recentEvents.map((ev, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs leading-5 text-zinc-300"
              >
                <EventAsset event={ev} />
                <span>{formatEvent(ev, players)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EventAsset({ event }: { event: GameEvent }) {
  if (
    event.type === "building_complete" ||
    event.type === "build_started"
  ) {
    const buildingAsset =
      typeof event.building_type === "string"
        ? getBuildingAsset(event.building_type)
        : null;

    if (buildingAsset) {
      return (
        <Image
          src={buildingAsset}
          alt=""
          width={18}
          height={18}
          className="h-[18px] w-[18px] shrink-0 object-contain"
        />
      );
    }
  }

  return (
    <Image
      src={getUnitAsset(typeof event.unit_type === "string" ? event.unit_type : event.type === "units_moved" ? "moving" : "default")}
      alt=""
      width={18}
      height={18}
      className="h-[18px] w-[18px] shrink-0 object-contain"
    />
  );
}

function formatEvent(
  event: GameEvent,
  players: Record<string, GamePlayer>
): string {
  const getPlayerName = (id: unknown) =>
    typeof id === "string" ? players[id]?.username || "?" : "?";

  switch (event.type) {
    case "attack_success":
      return `${getPlayerName(event.player_id)} przejal ${event.target_region_id}`;
    case "attack_failed":
      return `Atak ${getPlayerName(event.player_id)} odparty`;
    case "capital_captured":
      return `${getPlayerName(event.captured_by)} zdobyl stolice ${getPlayerName(event.lost_by)}`;
    case "player_eliminated":
      return `${getPlayerName(event.player_id)} wyeliminowany`;
    case "game_over":
      return `${getPlayerName(event.winner_id)} wygrywa`;
    case "building_complete":
      return `${getPlayerName(event.player_id)} zbudowal ${event.building_type}`;
    case "build_started":
      return `${getPlayerName(event.player_id)} rozpoczal budowe ${event.building_type}`;
    case "units_moved":
      return `${getPlayerName(event.player_id)} przeniosl ${event.units} jednostek`;
    case "troops_sent":
      return `${getPlayerName(event.player_id)} wyslal ${event.units} jednostek`;
    case "unit_production_started":
      return `${getPlayerName(event.player_id)} rozpoczal produkcje ${event.unit_type}`;
    case "unit_production_complete":
      return `${getPlayerName(event.player_id)} ukonczyl produkcje ${event.unit_type}`;
    case "action_rejected":
      return `${getPlayerName(event.player_id)}: ${String(event.message ?? "Akcja odrzucona")}`;
    default:
      return `${event.type}`;
  }
}
