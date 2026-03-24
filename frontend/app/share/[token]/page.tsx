"use client";

import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useConfig, useRegionsGraph, useSharedResource } from "@/hooks/queries";
import type { GamePlayer, GameRegion, GameState } from "@/hooks/useGameSocket";
import { type BuildingType, getRegionTilesUrl, type SnapshotTick } from "@/lib/api";
import { loadAssetOverrides } from "@/lib/assetOverrides";
import { queryKeys } from "@/lib/queryKeys";

const MatchCharts = dynamic(() => import("@/components/match/MatchCharts"), { ssr: false });

import {
  Award,
  Clock,
  Crown,
  Globe,
  Loader2,
  LogIn,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Skull,
  Swords,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const GameMap = dynamic(() => import("@/components/map/GameMap"), { ssr: false });

const SPEEDS = [1, 2, 4, 8];

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m === 0 ? `${s}s` : `${m}m ${s}s`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();

  const { data: sharedData, isLoading: sharedLoading, isError: sharedError } = useSharedResource(token);
  const { data: config, isLoading: configLoading, isError: configError } = useConfig();
  const {
    data: regionGraph = [],
    isLoading: graphLoading,
    isError: graphError,
  } = useRegionsGraph(sharedData?.match.id);

  const loading = sharedLoading || configLoading || (!!sharedData && graphLoading);
  const error = sharedError || configError || graphError;

  const buildingTypes: BuildingType[] = config?.buildings ?? [];

  const snapshots = useMemo<SnapshotTick[]>(() => {
    if (!sharedData) return [];
    return sharedData.snapshot_ticks.map((t) => ({ tick: t, created_at: "" }));
  }, [sharedData]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const currentIndexRef = useRef(0);
  playingRef.current = playing;
  speedRef.current = speed;
  currentIndexRef.current = currentIndex;

  const loadSnapshot = useCallback(
    async (tick: number, index: number) => {
      const queryKey = [...queryKeys.share.snapshot(token), tick];
      const cached = queryClient.getQueryData<{ state_data: Record<string, unknown> }>(queryKey);
      if (cached) {
        setGameState(cached.state_data as unknown as GameState);
        setCurrentIndex(index);
        return;
      }
      setSnapshotLoading(true);
      try {
        const snap = await queryClient.fetchQuery({
          queryKey,
          queryFn: () => import("@/lib/api").then((m) => m.getSharedSnapshot(token, tick)),
          staleTime: Infinity,
        });
        setGameState(snap.state_data as unknown as GameState);
        setCurrentIndex(index);
      } catch {
        /* ignore */
      } finally {
        setSnapshotLoading(false);
      }
    },
    [token, queryClient],
  );

  useEffect(() => {
    loadAssetOverrides();
  }, []);

  // Load first snapshot once snapshots are available
  useEffect(() => {
    if (snapshots.length > 0 && gameState === null && !snapshotLoading) {
      loadSnapshot(snapshots[0].tick, 0);
    }
  }, [snapshots, gameState, snapshotLoading, loadSnapshot]);

  // Prefetch next snapshots
  useEffect(() => {
    if (snapshots.length === 0) return;
    for (let i = currentIndex + 1; i <= Math.min(currentIndex + 2, snapshots.length - 1); i++) {
      const tick = snapshots[i].tick;
      const queryKey = [...queryKeys.share.snapshot(token), tick];
      if (!queryClient.getQueryData(queryKey)) {
        queryClient.prefetchQuery({
          queryKey,
          queryFn: () => import("@/lib/api").then((m) => m.getSharedSnapshot(token, tick)),
          staleTime: Infinity,
        });
      }
    }
  }, [currentIndex, token, snapshots, queryClient]);

  // Playback interval
  useEffect(() => {
    if (!playing || snapshots.length === 0) return;
    const interval = setInterval(() => {
      if (!playingRef.current) return;
      const nextIdx = currentIndexRef.current + 1;
      if (nextIdx >= snapshots.length) {
        setPlaying(false);
        return;
      }
      loadSnapshot(snapshots[nextIdx].tick, nextIdx);
    }, 1000 / speedRef.current);
    return () => clearInterval(interval);
  }, [playing, snapshots, loadSnapshot]);

  const centroids = useMemo(() => {
    const c: Record<string, [number, number]> = {};
    for (const e of regionGraph) {
      if (e.centroid) c[e.id] = e.centroid;
    }
    return c;
  }, [regionGraph]);
  const buildingIcons = useMemo(() => {
    const m: Record<string, string> = {};
    for (const b of buildingTypes) {
      m[b.slug] = b.asset_key || b.slug;
    }
    return m;
  }, [buildingTypes]);
  const regions = useMemo(() => gameState?.regions ?? {}, [gameState?.regions]);
  const players = useMemo(() => gameState?.players ?? {}, [gameState?.players]);
  const currentTick = snapshots[currentIndex]?.tick ?? 0;
  const totalTicks = snapshots.length > 0 ? snapshots[snapshots.length - 1].tick : 0;

  const playerList = useMemo(() => {
    const entries = Object.entries(players) as [string, GamePlayer][];
    const regionEntries = Object.values(regions) as GameRegion[];
    return entries
      .map(([id, p]) => ({
        id,
        ...p,
        ownedRegions: regionEntries.filter((r) => r.owner_id === id).length,
        totalUnits: regionEntries.filter((r) => r.owner_id === id).reduce((sum, r) => sum + (r.unit_count || 0), 0),
      }))
      .sort((a, b) => b.ownedRegions - a.ownedRegions);
  }, [players, regions]);

  const playersForMap = useMemo(() => {
    const m: Record<string, { color: string; username: string; cosmetics?: Record<string, unknown> }> = {};
    for (const [id, p] of Object.entries(players)) {
      const gp = p as GamePlayer;
      m[id] = { color: gp.color, username: gp.username, cosmetics: gp.cosmetics };
    }
    return m;
  }, [players]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPlaying(false);
    loadSnapshot(snapshots[Number(e.target.value)].tick, Number(e.target.value));
  };
  const stepForward = () => {
    if (currentIndex < snapshots.length - 1) {
      setPlaying(false);
      loadSnapshot(snapshots[currentIndex + 1].tick, currentIndex + 1);
    }
  };
  const stepBackward = () => {
    if (currentIndex > 0) {
      setPlaying(false);
      loadSnapshot(snapshots[currentIndex - 1].tick, currentIndex - 1);
    }
  };
  const cycleSpeed = () => {
    setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !sharedData) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground px-4">
        <Globe className="h-12 w-12 text-muted-foreground/30" />
        <p className="text-sm md:text-lg text-muted-foreground text-center">{"Link nieprawidłowy lub wygasł."}</p>
        <Link href="/register" className={buttonVariants({ className: "h-11 gap-2 rounded-full px-6 text-sm" })}>
          <LogIn className="h-4 w-4" /> Dołącz do MapLord
        </Link>
      </div>
    );
  }

  const { match, result } = sharedData;
  const winner = match.players.find((p) => p.user_id === match.winner_id);
  const hasReplay = snapshots.length > 0;
  const _durationMin = result ? result.duration_seconds / 60 : 0;

  const mvp =
    result && result.player_results.length > 0
      ? [...result.player_results].sort((a, b) => {
          const sa = a.regions_conquered * 3 + a.units_produced + a.buildings_built * 2 - a.units_lost;
          const sb = b.regions_conquered * 3 + b.units_produced + b.buildings_built * 2 - b.units_lost;
          return sb - sa;
        })[0]
      : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="fixed inset-x-0 top-0 z-40 h-12 border-b border-border bg-card/80 backdrop-blur-xl">
        <div className="flex h-full items-center gap-3 px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-secondary">
              <Globe size={15} className="text-muted-foreground" />
            </div>
            <span className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-foreground">
              MAPLORD
            </span>
          </Link>
          <div className="flex-1" />
          <Link
            href="/login"
            className="text-xs md:text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Zaloguj
          </Link>
          <Link
            href="/register"
            className="rounded-full bg-primary px-3 py-1.5 md:px-4 md:py-2 text-xs md:text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition-all"
          >
            Graj
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="pt-12">
        <div className="space-y-3 md:space-y-6 px-4 py-4 md:py-8 sm:px-6 lg:px-8">
          {/* Title */}
          <div>
            <h1 className="font-display text-2xl md:text-4xl text-foreground">Wyniki meczu</h1>
            <p className="mt-0.5 text-xs md:text-sm text-muted-foreground">Udostępniony replay</p>
          </div>

          {/* Stats — horizontal scroll on mobile */}
          <div className="flex gap-2.5 overflow-x-auto pb-1 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
            {[
              {
                icon: Swords,
                label: "Status",
                value: match.status === "finished" ? "Zakończony" : match.status,
                color: "text-muted-foreground",
              },
              {
                icon: Users,
                label: "Gracze",
                value: `${match.players.length}/${match.max_players}`,
                color: "text-foreground",
              },
              {
                icon: Clock,
                label: "Czas",
                value: result ? formatDuration(result.duration_seconds) : "—",
                color: "text-foreground",
              },
              ...(winner ? [{ icon: Crown, label: "Zwycięzca", value: winner.username, color: "text-accent" }] : []),
            ].map((s) => (
              <div
                key={s.label}
                className="flex shrink-0 items-center gap-2.5 rounded-2xl bg-card border border-border px-3.5 py-3 md:p-5 md:flex-col md:items-start md:gap-2 min-w-[110px] md:min-w-0"
              >
                <s.icon className="h-4 w-4 md:h-5 md:w-5 text-muted-foreground md:text-primary" />
                <span className="text-[10px] md:text-xs uppercase tracking-[0.15em] md:tracking-[0.2em] text-muted-foreground font-medium">
                  {s.label}
                </span>
                <span className={`font-display text-base md:text-3xl ml-auto md:ml-0 ${s.color}`}>{s.value}</span>
              </div>
            ))}
          </div>

          {/* Timestamps */}
          {(match.started_at || match.finished_at) && (
            <div className="flex flex-wrap gap-3 text-xs md:text-sm text-muted-foreground">
              {match.started_at && (
                <span>
                  Start: <span className="text-foreground">{formatDate(match.started_at)}</span>
                </span>
              )}
              {match.finished_at && (
                <span>
                  Koniec: <span className="text-foreground">{formatDate(match.finished_at)}</span>
                </span>
              )}
            </div>
          )}

          {/* MVP + ELO */}
          {mvp && result && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* MVP */}
              <div className="flex items-center gap-3 md:gap-4 rounded-2xl border border-accent/20 bg-accent/5 p-3 md:p-5">
                <div className="flex h-10 w-10 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-xl bg-accent/15">
                  <Award className="h-5 w-5 md:h-6 md:w-6 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] md:text-xs uppercase tracking-[0.15em] text-accent/70 font-medium">
                    MVP meczu
                  </p>
                  <span className="font-display text-lg md:text-xl text-foreground">{mvp.username}</span>
                </div>
                <div className="flex gap-3 md:gap-4 text-center shrink-0">
                  <div>
                    <div className="font-display text-sm md:text-lg text-primary tabular-nums">
                      {mvp.regions_conquered}
                    </div>
                    <div className="text-[8px] md:text-[10px] text-muted-foreground uppercase">Regiony</div>
                  </div>
                  <div>
                    <div className="font-display text-sm md:text-lg text-foreground tabular-nums">
                      {mvp.units_produced}
                    </div>
                    <div className="text-[8px] md:text-[10px] text-muted-foreground uppercase">Jednostki</div>
                  </div>
                  <div className="hidden md:block">
                    <div className="font-display text-lg text-accent tabular-nums">{mvp.buildings_built}</div>
                    <div className="text-[10px] text-muted-foreground uppercase">Budynki</div>
                  </div>
                </div>
              </div>

              {/* ELO changes */}
              <div className="rounded-2xl border border-border bg-card p-3 md:p-5">
                <p className="text-[10px] md:text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-2 md:mb-3">
                  Zmiana ELO
                </p>
                <div className="space-y-1.5 md:space-y-2">
                  {result.player_results.map((pr) => {
                    const player = match.players.find((p) => p.user_id === pr.user_id);
                    return (
                      <div key={pr.user_id} className="flex items-center gap-2 md:gap-3">
                        {player && (
                          <div
                            className="h-3.5 w-3.5 md:h-4 md:w-4 rounded border border-border"
                            style={{ backgroundColor: player.color }}
                          />
                        )}
                        <span className="text-xs md:text-sm text-foreground flex-1 truncate">{pr.username}</span>
                        <span
                          className={`font-display text-sm md:text-base tabular-nums flex items-center gap-1 ${pr.elo_change > 0 ? "text-green-400" : pr.elo_change < 0 ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {pr.elo_change > 0 ? (
                            <TrendingUp className="h-3.5 w-3.5" />
                          ) : pr.elo_change < 0 ? (
                            <TrendingDown className="h-3.5 w-3.5" />
                          ) : null}
                          {pr.elo_change > 0 ? "+" : ""}
                          {pr.elo_change}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Players — mobile: compact cards, desktop: full table */}
          <div>
            <p className="text-[11px] md:hidden uppercase tracking-[0.18em] text-muted-foreground font-medium mb-2">
              Gracze
            </p>

            {/* Mobile cards */}
            <div className="md:hidden space-y-1.5">
              {match.players.map((player) => {
                const isWinner = player.user_id === match.winner_id;
                const pr = result?.player_results.find((r) => r.user_id === player.user_id);
                return (
                  <div
                    key={player.id}
                    className={`flex items-center gap-3 rounded-xl p-3 border ${isWinner ? "border-accent/20 bg-accent/5" : "border-border bg-card"}`}
                  >
                    <div
                      className="h-6 w-6 rounded-lg border border-border shrink-0"
                      style={{ backgroundColor: player.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-foreground truncate">{player.username}</span>
                        {isWinner && <Crown className="h-3.5 w-3.5 text-accent shrink-0" />}
                        {!player.is_alive && <Skull className="h-3.5 w-3.5 text-destructive shrink-0" />}
                      </div>
                    </div>
                    {pr && (
                      <span
                        className={`font-display text-sm tabular-nums ${pr.elo_change > 0 ? "text-green-400" : pr.elo_change < 0 ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {pr.elo_change > 0 ? "+" : ""}
                        {pr.elo_change}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <Card className="hidden md:block rounded-2xl overflow-hidden">
              <div className="flex items-center gap-3 px-6 pt-5 pb-3">
                <Users className="h-5 w-5 text-primary" />
                <h3 className="font-display text-xl text-foreground">Gracze</h3>
              </div>
              <Table className="text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-12 pl-6 text-sm font-semibold">Gracz</TableHead>
                    <TableHead className="h-12 text-sm font-semibold text-center">Status</TableHead>
                    <TableHead className="h-12 text-sm font-semibold text-center">Regiony</TableHead>
                    <TableHead className="h-12 text-sm font-semibold text-center">Jednostki</TableHead>
                    <TableHead className="h-12 text-sm font-semibold text-center">Straty</TableHead>
                    <TableHead className="h-12 text-sm font-semibold text-center">Budynki</TableHead>
                    <TableHead className="h-12 pr-6 text-sm font-semibold text-right">ELO</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {match.players.map((player) => {
                    const isWinner = player.user_id === match.winner_id;
                    const pr = result?.player_results.find((r) => r.user_id === player.user_id);
                    return (
                      <TableRow key={player.id} className={isWinner ? "bg-accent/5" : ""}>
                        <TableCell className="pl-6 py-4">
                          <div className="flex items-center gap-3">
                            <div
                              className="h-7 w-7 rounded-lg border border-border"
                              style={{ backgroundColor: player.color }}
                            />
                            <span className="text-base font-semibold text-foreground">{player.username}</span>
                            {isWinner && <Crown className="h-4 w-4 text-accent" />}
                          </div>
                        </TableCell>
                        <TableCell className="py-4 text-center">
                          {player.is_alive ? (
                            <Badge className="border-0 bg-green-500/15 text-xs text-green-400">Żywy</Badge>
                          ) : (
                            <Badge className="border-0 bg-destructive/15 text-xs text-destructive">
                              <Skull className="mr-1 h-3 w-3" />
                              Wyeliminowany
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="py-4 text-center text-base tabular-nums text-primary">
                          {pr?.regions_conquered ?? "—"}
                        </TableCell>
                        <TableCell className="py-4 text-center text-base tabular-nums text-foreground">
                          {pr?.units_produced ?? "—"}
                        </TableCell>
                        <TableCell className="py-4 text-center text-base tabular-nums text-destructive">
                          {pr?.units_lost ?? "—"}
                        </TableCell>
                        <TableCell className="py-4 text-center text-base tabular-nums text-accent">
                          {pr?.buildings_built ?? "—"}
                        </TableCell>
                        <TableCell className="py-4 pr-6 text-right">
                          {pr ? (
                            <span
                              className={`flex items-center justify-end gap-1 font-display text-lg ${pr.elo_change > 0 ? "text-green-400" : pr.elo_change < 0 ? "text-destructive" : "text-muted-foreground"}`}
                            >
                              {pr.elo_change > 0 ? (
                                <TrendingUp className="h-4 w-4" />
                              ) : pr.elo_change < 0 ? (
                                <TrendingDown className="h-4 w-4" />
                              ) : null}
                              {pr.elo_change > 0 ? "+" : ""}
                              {pr.elo_change}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </div>

          {/* Charts */}
          {result && result.player_results.length > 0 && <MatchCharts match={match} result={result} />}

          {/* Replay */}
          {hasReplay && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg md:text-2xl text-foreground">Replay</h2>
                <span className="text-xs md:text-sm text-muted-foreground tabular-nums">
                  <span className="font-display text-foreground">{currentTick}</span> / {totalTicks}
                </span>
              </div>

              {/* Timeline */}
              <div className="rounded-none md:rounded-2xl border-y md:border border-border bg-card/80 md:bg-card px-3 py-2.5 md:p-4 -mx-4 md:mx-0">
                <div className="flex items-center gap-2 md:gap-4">
                  <div className="flex items-center gap-0.5 md:gap-1.5">
                    <Button
                      variant="ghost"
                      onClick={stepBackward}
                      disabled={currentIndex === 0}
                      className="h-8 w-8 md:h-10 md:w-10 rounded-full p-0 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <SkipBack className="h-4 w-4 md:h-5 md:w-5" />
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setPlaying(!playing)}
                      className="h-10 w-10 md:h-12 md:w-12 rounded-full p-0 text-primary hover:bg-primary/10"
                    >
                      {playing ? (
                        <Pause className="h-5 w-5 md:h-6 md:w-6" />
                      ) : (
                        <Play className="h-5 w-5 md:h-6 md:w-6" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={stepForward}
                      disabled={currentIndex >= snapshots.length - 1}
                      className="h-8 w-8 md:h-10 md:w-10 rounded-full p-0 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <SkipForward className="h-4 w-4 md:h-5 md:w-5" />
                    </Button>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={snapshots.length - 1}
                    value={currentIndex}
                    onChange={handleSliderChange}
                    className="h-1.5 md:h-2 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-primary [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 md:[&::-webkit-slider-thumb]:h-5 md:[&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                  />
                  <button
                    onClick={cycleSpeed}
                    className="rounded-full border border-border px-3 py-1 text-sm font-semibold text-foreground hover:bg-muted active:scale-[0.95]"
                  >
                    {speed}x
                  </button>
                </div>
              </div>

              {/* Map + players */}
              <div className="grid gap-3 md:gap-4 lg:grid-cols-[1fr_280px] lg:h-[calc(100vh-20rem)]">
                <div className="relative overflow-hidden rounded-2xl border border-border bg-card h-[50vh] md:h-full">
                  <div className="h-full w-full">
                    {gameState && (
                      <GameMap
                        tilesUrl={getRegionTilesUrl(match.id)}
                        centroids={centroids}
                        regions={regions as Record<string, GameRegion>}
                        players={playersForMap}
                        selectedRegion={null}
                        targetRegions={[]}
                        highlightedNeighbors={[]}
                        dimmedRegions={[]}
                        onRegionClick={() => {}}
                        myUserId=""
                        animations={[]}
                        buildingIcons={buildingIcons}
                        activeEffects={gameState.active_effects}
                        initialZoom={2.5}
                      />
                    )}
                  </div>
                  {snapshotLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-card/70">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>

                {/* Player panel */}
                <div>
                  <div className="flex gap-2 overflow-x-auto pb-1 md:pb-0 md:flex-col md:gap-2.5 md:rounded-2xl md:border md:border-border md:bg-card md:p-4 md:overflow-y-auto scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
                    {playerList.map((p) => {
                      const isWinner = p.id === match.winner_id;
                      return (
                        <div
                          key={p.id}
                          className={`shrink-0 rounded-xl border p-3 w-32 md:w-auto ${
                            !p.is_alive
                              ? "border-border/30 opacity-40"
                              : isWinner
                                ? "border-accent/25 bg-accent/5"
                                : "border-border bg-secondary/50"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1.5 md:mb-2">
                            <div
                              className="h-4 w-4 md:h-5 md:w-5 rounded-md border border-border"
                              style={{ backgroundColor: p.color }}
                            />
                            <span className="flex-1 truncate text-xs md:text-sm font-semibold text-foreground">
                              {p.username}
                            </span>
                            {isWinner && <Crown className="h-3 w-3 md:h-4 md:w-4 text-accent shrink-0" />}
                          </div>
                          <div className="grid grid-cols-3 gap-1 text-center">
                            <div>
                              <div className="text-[9px] text-muted-foreground">Reg</div>
                              <div className="font-display text-xs md:text-sm text-primary">{p.ownedRegions}</div>
                            </div>
                            <div>
                              <div className="text-[9px] text-muted-foreground">Jedn</div>
                              <div className="font-display text-xs md:text-sm text-foreground">{p.totalUnits}</div>
                            </div>
                            <div>
                              <div className="text-[9px] text-muted-foreground">Ener</div>
                              <div className="font-display text-xs md:text-sm text-primary">{p.energy}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* CTA */}
          <div className="rounded-2xl border border-border bg-card p-6 md:p-8 text-center">
            <h2 className="font-display text-xl md:text-3xl text-foreground">Zagraj w MapLord</h2>
            <p className="mt-2 text-xs md:text-sm text-muted-foreground max-w-xs mx-auto">
              Zbuduj armię, podbij terytoria i rywalizuj w czasie rzeczywistym.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2 md:gap-3">
              <Link href="/register" className={buttonVariants({ className: "h-11 gap-2 rounded-full px-6 text-sm" })}>
                <UserPlus className="h-4 w-4" /> Dołącz
              </Link>
              <Link
                href="/login"
                className={buttonVariants({ variant: "outline", className: "h-11 rounded-full px-6 text-sm" })}
              >
                Zaloguj się
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
