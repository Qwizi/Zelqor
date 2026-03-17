"use client";

import { memo, useMemo, type ReactNode } from "react";
import Image from "next/image";
import { Zap, Shield, Swords, TrendingUp, Coins } from "lucide-react";
import type { GamePlayer } from "@/hooks/useGameSocket";
import { Badge } from "@/components/ui/badge";

const BOOST_ICONS: Record<string, ReactNode> = {
  unit_bonus: <TrendingUp className="h-3 w-3" />,
  defense_bonus: <Shield className="h-3 w-3" />,
  attack_bonus: <Swords className="h-3 w-3" />,
  energy_bonus: <Coins className="h-3 w-3" />,
};

const BOOST_COLORS: Record<string, string> = {
  unit_bonus: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  defense_bonus: "text-blue-300 border-blue-500/30 bg-blue-500/10",
  attack_bonus: "text-red-300 border-red-500/30 bg-red-500/10",
  energy_bonus: "text-amber-300 border-amber-500/30 bg-amber-500/10",
};

const BOOST_LABELS: Record<string, string> = {
  unit_bonus: "Mobilizacja",
  defense_bonus: "Fortyfikacja",
  attack_bonus: "Blitzkrieg",
  energy_bonus: "Ekonomia",
};

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
  myEnergy: number;
  fps?: number;
  ping?: number;
  connected?: boolean;
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
  myEnergy,
  fps,
  ping,
  connected,
}: GameHUDProps) {
  const aliveCount = useMemo(
    () => Object.values(players).filter((player) => player.is_alive).length,
    [players]
  );
  const formattedClock = useMemo(() => formatClock(tick, tickIntervalMs), [tick, tickIntervalMs]);

  return (
    <div data-tutorial="hud" className="absolute left-2 top-2 z-10 flex max-w-[calc(100vw-5rem)] flex-col gap-2 sm:left-3 sm:top-3 sm:max-w-[240px]">
      <div className="inline-flex w-fit max-w-full items-center gap-2 rounded-full border border-border bg-card sm:bg-card/85 px-2.5 py-1.5 text-[10px] text-foreground shadow-lg sm:backdrop-blur-xl">
        <span className="font-display text-xs font-bold text-primary sm:text-base">{formattedClock}</span>
        <span className="h-1 w-1 rounded-full bg-white/20" />
        <Badge className="h-auto border-0 bg-primary/15 px-2 py-0.5 text-[10px] sm:text-xs text-primary hover:bg-primary/15">
          {statusLabel(status)}
        </Badge>
        <span className="hidden text-[10px] sm:text-xs text-muted-foreground sm:inline">{aliveCount} aktywnych</span>
        {connected === false && (
          <span className="flex items-center gap-1 text-[10px] sm:text-xs font-medium text-red-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
            Rozłączono
          </span>
        )}
        {connected !== false && typeof fps === "number" && (
          <span className="text-[10px] sm:text-xs sm:font-semibold tabular-nums text-muted-foreground">{fps} FPS</span>
        )}
        {connected !== false && typeof ping === "number" && (
          <span className="text-[10px] sm:text-xs sm:font-semibold tabular-nums text-muted-foreground">{ping}ms</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <CompactStat icon={<Zap className="h-3.5 w-3.5 text-primary" />} label="Energia" value={myEnergy} />
        <CompactStat icon="/assets/icons/storage_icon.webp" label="Regiony" value={myRegionCount} />
        <CompactStat icon="/assets/units/ground_unit.webp" label="Siła" value={myUnitCount} />
      </div>

      <ActiveBoostsPanel players={players} myUserId={myUserId} tickIntervalMs={tickIntervalMs} />

      <div className="hidden rounded-xl border border-border bg-card/80 p-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:block">
        <div className="px-1 pb-1.5 text-[10px] sm:text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Ranking
        </div>
        <div className="space-y-0.5">
          {rankedPlayers.map((player, index) => (
            <div
              key={player.user_id}
              className={`grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-1 text-xs sm:text-sm ${
                player.user_id === myUserId ? "bg-muted/30" : "bg-transparent"
              }`}
            >
              <div className="font-display text-muted-foreground">{index + 1}</div>
              <div className="min-w-0">
                <div className={`truncate ${player.isAlive ? "text-foreground" : "text-muted-foreground line-through"}`}>
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: player.color }} />
                  {player.username}
                  {player.user_id === myUserId ? " (Ty)" : ""}
                  {player.isBot && <span className="ml-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground" title="Bot AI">BOT</span>}
                </div>
              </div>
              <div className="text-right font-display text-xs sm:text-sm tabular-nums text-muted-foreground">
                {player.regionCount}r · {player.unitCount}u
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

const ActiveBoostsPanel = memo(function ActiveBoostsPanel({
  players, myUserId, tickIntervalMs,
}: { players: Record<string, GamePlayer>; myUserId: string; tickIntervalMs: number }) {
  const myPlayer = players[myUserId];
  const deckBoosts = myPlayer?.active_boosts ?? [];
  const matchBoosts = myPlayer?.active_match_boosts ?? [];

  if (deckBoosts.length === 0 && matchBoosts.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {deckBoosts.map((b) => {
        const effectType = (b.params?.effect_type as string) ?? "";
        const value = (b.params?.value as number) ?? 0;
        const colors = BOOST_COLORS[effectType] ?? "text-muted-foreground border-border bg-muted/30";
        return (
          <div key={b.slug} className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] sm:text-xs font-medium ${colors}`}
            title={`${BOOST_LABELS[effectType] ?? effectType}: +${Math.round(value * 100)}% (cały mecz)`}>
            {BOOST_ICONS[effectType] ?? <Zap className="h-3 w-3" />}
            <span>+{Math.round(value * 100)}%</span>
          </div>
        );
      })}
      {matchBoosts.map((b, i) => {
        const colors = BOOST_COLORS[b.effect_type] ?? "text-muted-foreground border-border bg-muted/30";
        const remainingSec = Math.ceil((b.ticks_remaining * tickIntervalMs) / 1000);
        return (
          <div key={`${b.slug}-${i}`} className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] sm:text-xs font-medium ${colors}`}
            title={`${BOOST_LABELS[b.effect_type] ?? b.effect_type}: +${Math.round(b.value * 100)}% (${remainingSec}s)`}>
            {BOOST_ICONS[b.effect_type] ?? <Zap className="h-3 w-3" />}
            <span>+{Math.round(b.value * 100)}%</span>
            <span className="font-display text-[10px] tabular-nums opacity-70">{remainingSec}s</span>
          </div>
        );
      })}
    </div>
  );
});

const CompactStat = memo(function CompactStat({
  icon, label, value,
}: { icon: string | ReactNode; label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card sm:bg-card/80 px-2 py-1.5 shadow-lg sm:backdrop-blur-xl">
      <div className="flex items-center gap-1.5 text-[10px] sm:text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {typeof icon === "string" ? (
          <Image src={icon} alt="" width={14} height={14} className="h-3.5 w-3.5 object-contain" />
        ) : icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate font-display text-base font-bold leading-none text-foreground sm:text-xl">{value}</div>
    </div>
  );
});
