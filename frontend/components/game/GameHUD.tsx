"use client";

import { BoltIcon, Handshake, Shield, Swords, Zap } from "lucide-react";
import Image from "next/image";
import { memo, type ReactNode, useCallback, useMemo, useState } from "react";
import ActiveBoosts from "@/components/game/ActiveBoosts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GamePlayer } from "@/hooks/useGameSocket";
import type { CosmeticValue } from "@/lib/animationConfig";
import type { DiplomacyState } from "@/lib/gameTypes";
import { AP_MAX } from "@/lib/gameTypes";

/**
 * Resolve the `emblem` cosmetic slot to a URL string, or return null if absent.
 * The cosmetic value may be a bare URL string or an object with a `url` field.
 */
function resolveEmblemUrl(cosmetics?: Record<string, unknown>): string | null {
  if (!cosmetics) return null;
  const raw = cosmetics.emblem as CosmeticValue | undefined;
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  return raw.url ?? null;
}

interface GameHUDProps {
  tick: number;
  tickIntervalMs: number;
  status: string;
  players: Record<string, GamePlayer>;
  rankedPlayers: Array<{
    user_id: string;
    username: string;
    clan_tag?: string | null;
    color: string;
    regionCount: number;
    unitCount: number;
    isAlive: boolean;
    isBot: boolean;
    cosmetics?: Record<string, unknown>;
  }>;
  myUserId: string;
  myRegionCount: number;
  myUnitCount: number;
  myEnergy: number;
  myActionPoints: number;
  fps?: number;
  ping?: number;
  connected?: boolean;
  // Diplomacy
  diplomacy?: DiplomacyState;
  capitalProtectionTicks?: number;
  onProposePact?: (targetPlayerId: string) => void;
  onRespondPact?: (proposalId: string, accept: boolean) => void;
  onBreakPact?: (pactId: string) => void;
  onDeclareWar?: (targetPlayerId: string) => void;
  onProposePeace?: (targetPlayerId: string, conditionType: string, provincesToReturn?: string[]) => void;
  onRespondPeace?: (proposalId: string, accept: boolean) => void;
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
  if (status === "selecting") return "Wybor stolicy";
  if (status === "in_progress") return "W trakcie";
  if (status === "finished") return "Koniec";
  return status;
}

type PlayerRelation = "war" | "nap" | "neutral";

function getPlayerRelation(diplomacy: DiplomacyState | undefined, myId: string, otherId: string): PlayerRelation {
  if (!diplomacy) return "neutral";
  const isWar = diplomacy.wars.some(
    (w) => (w.player_a === myId && w.player_b === otherId) || (w.player_b === myId && w.player_a === otherId),
  );
  if (isWar) return "war";
  const isNap = diplomacy.pacts.some(
    (p) => (p.player_a === myId && p.player_b === otherId) || (p.player_b === myId && p.player_a === otherId),
  );
  if (isNap) return "nap";
  return "neutral";
}

function findPactId(diplomacy: DiplomacyState | undefined, myId: string, otherId: string): string | null {
  if (!diplomacy) return null;
  const pact = diplomacy.pacts.find(
    (p) => (p.player_a === myId && p.player_b === otherId) || (p.player_b === myId && p.player_a === otherId),
  );
  return pact?.id ?? null;
}

function hasOutgoingProposal(diplomacy: DiplomacyState | undefined, myId: string, otherId: string): boolean {
  if (!diplomacy) return false;
  return diplomacy.proposals.some(
    (p) => p.from_player_id === myId && p.to_player_id === otherId && p.status === "pending",
  );
}

// Teammate badge shown inline in ranking
function TeammateBadge() {
  return (
    <span
      className="ml-auto flex shrink-0 items-center gap-0.5 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-micro font-medium text-blue-400"
      title="Sojusznik"
    >
      SOJUSZNIK
    </span>
  );
}

// Relation badge shown inline in ranking
function RelationBadge({ relation }: { relation: PlayerRelation }) {
  if (relation === "war") {
    return (
      <span
        className="ml-auto flex shrink-0 items-center gap-0.5 rounded-full bg-red-500/15 px-1.5 py-0.5 text-micro font-medium text-red-400"
        title="W wojnie"
      >
        <Swords className="h-2.5 w-2.5" />
        <span className="sr-only">W wojnie</span>
      </span>
    );
  }
  if (relation === "nap") {
    return (
      <span
        className="ml-auto flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-micro font-medium text-emerald-400"
        title="Pakt o nieagresji"
      >
        <Handshake className="h-2.5 w-2.5" />
        <span className="sr-only">Pakt</span>
      </span>
    );
  }
  return null;
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
  myActionPoints,
  fps,
  ping,
  connected,
  diplomacy,
  capitalProtectionTicks,
  onProposePact,
  onRespondPact,
  onBreakPact,
  onDeclareWar,
  onProposePeace,
  onRespondPeace,
}: GameHUDProps) {
  const aliveCount = useMemo(() => Object.values(players).filter((player) => player.is_alive).length, [players]);
  const formattedClock = useMemo(() => formatClock(tick, tickIntervalMs), [tick, tickIntervalMs]);

  // Capital protection
  const protectionTicks = capitalProtectionTicks ?? 0;
  const protectionRemaining = Math.max(0, protectionTicks - tick);
  const isProtected = protectionRemaining > 0 && status === "in_progress";
  const protectionSeconds = Math.ceil((protectionRemaining * tickIntervalMs) / 1000);

  // Incoming proposals
  const incomingProposals = useMemo(
    () => diplomacy?.proposals.filter((p) => p.to_player_id === myUserId && p.status === "pending") ?? [],
    [diplomacy?.proposals, myUserId],
  );

  // Which player's action popover is open
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);

  const toggleExpanded = useCallback(
    (userId: string) => {
      if (userId === myUserId) return;
      setExpandedPlayer((prev) => (prev === userId ? null : userId));
    },
    [myUserId],
  );

  return (
    <div
      data-tutorial="hud"
      className="absolute left-2 top-2 z-10 flex max-w-[calc(100vw-5rem)] flex-col gap-2 sm:left-3 sm:top-3 sm:max-w-[260px]"
    >
      {/* Clock + status bar */}
      <div className="inline-flex w-fit max-w-full items-center gap-2 rounded-full border border-border bg-card sm:bg-card/85 px-2.5 py-1.5 text-caption text-foreground shadow-lg sm:backdrop-blur-xl">
        <span className="font-display text-xs font-bold text-primary sm:text-base">{formattedClock}</span>
        <span className="h-1 w-1 rounded-full bg-white/20" />
        <Badge className="h-auto border-0 bg-primary/15 px-2 py-0.5 text-caption sm:text-xs text-primary hover:bg-primary/15">
          {statusLabel(status)}
        </Badge>
        <span className="hidden text-caption sm:text-xs text-muted-foreground sm:inline">{aliveCount} aktywnych</span>
        {connected === false && (
          <span
            aria-live="assertive"
            className="flex items-center gap-1 text-caption sm:text-xs font-medium text-red-400"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
            Rozlaczono
          </span>
        )}
        {connected !== false && typeof fps === "number" && (
          <span className="text-caption sm:text-xs sm:font-semibold tabular-nums text-muted-foreground">{fps} FPS</span>
        )}
        {connected !== false && typeof ping === "number" && (
          <span className="text-caption sm:text-xs sm:font-semibold tabular-nums text-muted-foreground">{ping}ms</span>
        )}
      </div>

      {/* Capital protection timer */}
      {isProtected && (
        <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs shadow-lg backdrop-blur-xl">
          <Shield className="h-3.5 w-3.5 text-amber-400" />
          <span className="font-medium text-amber-300">Ochrona stolic</span>
          <span className="ml-auto font-display tabular-nums text-amber-400">
            {Math.floor(protectionSeconds / 60)}:{String(protectionSeconds % 60).padStart(2, "0")}
          </span>
        </div>
      )}

      {/* Stats — Energy + AP (large, prominent) */}
      <div className="grid grid-cols-2 gap-2">
        <LargeStat
          icon={<Zap className="h-4 w-4 text-primary" />}
          label="Energia"
          value={myEnergy}
          valueColor="text-primary"
          lowPulse={myEnergy < 50}
        />
        <APStat actionPoints={myActionPoints} />
      </div>

      {/* Stats — Regions + Units (smaller) */}
      <div className="grid grid-cols-2 gap-2">
        <CompactStat icon="/assets/icons/storage_icon.webp" label="Regiony" value={myRegionCount} />
        <CompactStat icon="/assets/units/ground_unit.webp" label="Sila" value={myUnitCount} />
      </div>

      <ActiveBoosts
        boosts={players[myUserId]?.active_boosts ?? []}
        matchBoosts={players[myUserId]?.active_match_boosts}
        tickIntervalMs={tickIntervalMs}
      />

      {/* Incoming diplomacy proposals */}
      {incomingProposals.length > 0 && (
        <div className="military-frame hidden rounded-xl border border-amber-500/30 bg-card/80 p-2 shadow-(--shadow-panel) backdrop-blur-xl sm:block">
          <div className="mb-1.5 px-1 text-caption uppercase tracking-[0.14em] text-amber-400">Propozycje</div>
          <div className="space-y-1.5">
            {incomingProposals.map((proposal) => {
              const fromPlayer = players[proposal.from_player_id];
              if (!fromPlayer) return null;
              const label = proposal.proposal_type === "peace" ? "pokoj" : "pakt o nieagresji";
              const expiresIn = proposal.expires_tick != null ? Math.max(0, proposal.expires_tick - tick) : null;
              const expireSeconds = expiresIn != null ? Math.ceil((expiresIn * tickIntervalMs) / 1000) : null;
              return (
                <div key={proposal.id} className="rounded-lg border border-border bg-muted/10 p-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-label text-foreground">
                      <span className="font-medium" style={{ color: fromPlayer.color }}>
                        {fromPlayer.clan_tag && <span className="text-muted-foreground">[{fromPlayer.clan_tag}] </span>}
                        {fromPlayer.username}
                      </span>{" "}
                      proponuje {label}
                    </p>
                    {expireSeconds != null && (
                      <span
                        className={`ml-2 shrink-0 font-display text-caption tabular-nums ${expireSeconds <= 10 ? "text-red-400 animate-pulse" : "text-muted-foreground"}`}
                      >
                        {expireSeconds}s
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        proposal.proposal_type === "peace"
                          ? onRespondPeace?.(proposal.id, false)
                          : onRespondPact?.(proposal.id, false)
                      }
                      className="h-6 flex-1 text-caption"
                    >
                      Odrzuc
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        proposal.proposal_type === "peace"
                          ? onRespondPeace?.(proposal.id, true)
                          : onRespondPact?.(proposal.id, true)
                      }
                      className="h-6 flex-1 text-caption"
                    >
                      Akceptuj
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ranking + diplomacy */}
      <div className="military-frame hidden rounded-xl border border-border bg-card/80 p-1.5 shadow-(--shadow-panel) backdrop-blur-xl sm:block">
        <div className="military-frame-inner px-1 pb-1.5 text-caption sm:text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Ranking
        </div>
        <div className="space-y-0.5">
          {rankedPlayers.map((player, index) => {
            const emblemUrl = resolveEmblemUrl(player.cosmetics);
            const relation = getPlayerRelation(diplomacy, myUserId, player.user_id);
            const isMe = player.user_id === myUserId;
            const isExpanded = expandedPlayer === player.user_id;
            const hasPending = hasOutgoingProposal(diplomacy, myUserId, player.user_id);
            const myTeam = players[myUserId]?.team;
            const isTeammate = !isMe && !!myTeam && players[player.user_id]?.team === myTeam;

            return (
              <div key={player.user_id}>
                <div
                  role={isMe ? undefined : "button"}
                  tabIndex={isMe ? undefined : 0}
                  onKeyDown={
                    isMe
                      ? undefined
                      : (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleExpanded(player.user_id);
                          }
                        }
                  }
                  className={`grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-1 text-xs sm:text-sm ${
                    isMe ? "bg-muted/30" : "cursor-pointer hover:bg-muted/20"
                  } ${isExpanded ? "bg-muted/25" : ""}`}
                  onClick={() => toggleExpanded(player.user_id)}
                >
                  <div className="font-display text-muted-foreground">{index + 1}</div>
                  <div className="min-w-0">
                    <div
                      className={`flex items-center gap-1 truncate ${player.isAlive ? "text-foreground" : "text-muted-foreground line-through"}`}
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: player.color }}
                      />
                      {emblemUrl && (
                        <Image
                          src={emblemUrl}
                          alt={`Emblem ${player.username}`}
                          width={16}
                          height={16}
                          className="h-4 w-4 shrink-0 rounded-sm object-contain"
                        />
                      )}
                      <span className="truncate">
                        {player.clan_tag && (
                          <span className="text-muted-foreground">
                            [{player.clan_tag}]{"\u00A0"}
                          </span>
                        )}
                        {player.username}
                        {isMe ? " (Ty)" : ""}
                      </span>
                      {player.isBot && (
                        <span
                          className="ml-1 shrink-0 text-caption font-medium uppercase tracking-widest text-muted-foreground"
                          title="Bot AI"
                        >
                          BOT
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-right">
                    {!isMe && isTeammate && <TeammateBadge />}
                    {!isMe && !isTeammate && <RelationBadge relation={relation} />}
                    <span className="font-display text-xs sm:text-sm tabular-nums text-muted-foreground">
                      {player.regionCount}r · {player.unitCount}u
                    </span>
                  </div>
                </div>

                {/* Expanded diplomacy actions */}
                {isExpanded && player.isAlive && !isMe && !isTeammate && (
                  <div className="mx-2 mb-1 mt-0.5 flex flex-wrap gap-1 rounded-lg border border-border/50 bg-muted/10 p-1.5 animate-mil-expand">
                    {hasPending ? (
                      <span className="px-1 text-caption text-muted-foreground">Oczekuje na odpowiedz...</span>
                    ) : relation === "war" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onProposePeace?.(player.user_id, "status_quo");
                        }}
                        className="h-6 text-caption"
                      >
                        Zaproponuj pokoj
                      </Button>
                    ) : relation === "nap" ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          const pactId = findPactId(diplomacy, myUserId, player.user_id);
                          if (pactId) onBreakPact?.(pactId);
                        }}
                        className="h-6 text-caption"
                      >
                        Zerwij pakt
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            onProposePact?.(player.user_id);
                          }}
                          className="h-6 text-caption"
                        >
                          Zaproponuj pakt
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeclareWar?.(player.user_id);
                          }}
                          className="h-6 text-caption"
                        >
                          Wypowiedz wojne
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

const CompactStat = memo(function CompactStat({
  icon,
  label,
  value,
  suffix,
  valueColor,
}: {
  icon: string | ReactNode;
  label: string;
  value: number;
  suffix?: string;
  valueColor?: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card sm:bg-card/80 px-2 py-1.5 shadow-lg sm:backdrop-blur-xl">
      <div className="flex items-center gap-1.5 text-caption sm:text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {typeof icon === "string" ? (
          <Image src={icon} alt="" width={14} height={14} className="h-3.5 w-3.5 object-contain" />
        ) : (
          icon
        )}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={`mt-1 flex items-baseline gap-0.5 truncate font-display text-base font-bold leading-none sm:text-xl ${valueColor ?? "text-foreground"}`}
      >
        <span>{value}</span>
        {suffix && <span className="text-caption font-normal text-muted-foreground sm:text-xs">{suffix}</span>}
      </div>
    </div>
  );
});

/** Large prominent stat tile — used for Energy and AP */
const LargeStat = memo(function LargeStat({
  icon,
  label,
  value,
  valueColor,
  lowPulse,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  valueColor?: string;
  lowPulse?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-2xl border bg-card sm:bg-card/80 px-3 py-2 shadow-lg sm:backdrop-blur-xl transition-colors ${
        lowPulse ? "border-primary/60 animate-pulse" : "border-border"
      }`}
    >
      <div className="flex items-center gap-1.5 text-caption sm:text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={`mt-1 font-display text-2xl font-bold leading-none sm:text-3xl tabular-nums ${valueColor ?? "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
});

/** AP tile with progress bar and regen rate */
const APStat = memo(function APStat({ actionPoints }: { actionPoints: number }) {
  const pct = Math.round((Math.min(actionPoints, AP_MAX) / AP_MAX) * 100);
  const isLow = actionPoints < 3;
  const isMid = actionPoints >= 3 && actionPoints < 6;
  const valueColor = isLow ? "text-red-400" : isMid ? "text-amber-400" : "text-green-400";
  const barColor = isLow ? "bg-red-500" : isMid ? "bg-amber-500" : "bg-green-500";

  return (
    <div
      className={`min-w-0 rounded-2xl border bg-card sm:bg-card/80 px-3 py-2 shadow-lg sm:backdrop-blur-xl transition-colors ${
        isLow ? "border-red-500/60 animate-pulse" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-1 text-caption sm:text-xs uppercase tracking-[0.12em] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <BoltIcon className="h-4 w-4 text-amber-400" />
          <span>AP</span>
        </div>
        <span className="normal-case text-micro sm:text-caption text-muted-foreground/70 tracking-normal">
          +1 co 3s
        </span>
      </div>
      <div className={`mt-1 font-display text-2xl font-bold leading-none sm:text-3xl tabular-nums ${valueColor}`}>
        {actionPoints}
        <span className="text-label font-normal text-muted-foreground sm:text-sm">/{AP_MAX}</span>
      </div>
      {/* Progress bar */}
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted/40">
        <div
          className={`h-full rounded-full transition-transform duration-500 ${barColor}`}
          style={{ transform: `scaleX(${pct / 100})`, transformOrigin: "left" }}
        />
      </div>
    </div>
  );
});
