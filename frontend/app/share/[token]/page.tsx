"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  getSharedResource,
  getSharedSnapshot,
  getRegionsGraph,
  getConfig,
  getRegionTilesUrl,
  type SharedMatchData,
  type RegionGraphEntry,
  type BuildingType,
  type SnapshotTick,
} from "@/lib/api";
import { loadAssetOverrides } from "@/lib/assetOverrides";
import type { GameState, GameRegion, GamePlayer } from "@/hooks/useGameSocket";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Clock,
  Crown,
  Hammer,
  Globe,
  LogIn,
  Loader2,
  UserPlus,
  MapPin,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Skull,
  Swords,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

const GameMap = dynamic(() => import("@/components/map/GameMap"), {
  ssr: false,
});

const SPEEDS = [1, 2, 4, 8];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  finished: { label: "Zakończony", color: "text-muted-foreground" },
  in_progress: { label: "W trakcie", color: "text-green-400" },
  selecting: { label: "Wybór stolic", color: "text-accent" },
  cancelled: { label: "Anulowany", color: "text-destructive" },
  waiting: { label: "Oczekiwanie", color: "text-muted-foreground" },
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
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

  const [sharedData, setSharedData] = useState<SharedMatchData | null>(null);
  const [regionGraph, setRegionGraph] = useState<RegionGraphEntry[]>([]);
  const [buildingTypes, setBuildingTypes] = useState<BuildingType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Replay state
  const [snapshots, setSnapshots] = useState<SnapshotTick[]>([]);
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

  const snapshotCache = useRef<Map<number, GameState>>(new Map());

  // ── Load snapshot via share endpoint ────────────────────
  const loadSnapshot = useCallback(
    async (tick: number, index: number) => {
      const cached = snapshotCache.current.get(tick);
      if (cached) {
        setGameState(cached);
        setCurrentIndex(index);
        return;
      }

      setSnapshotLoading(true);
      try {
        const snap = await getSharedSnapshot(token, tick);
        const state = snap.state_data as unknown as GameState;
        snapshotCache.current.set(tick, state);
        setGameState(state);
        setCurrentIndex(index);
      } catch {
        // ignore
      } finally {
        setSnapshotLoading(false);
      }
    },
    [token]
  );

  // ── Initial data load ────────────────────────────────────
  useEffect(() => {
    Promise.all([
      getSharedResource(token),
      getConfig(),
      loadAssetOverrides(),
    ])
      .then(async ([data, cfg]) => {
        setSharedData(data);
        setBuildingTypes(cfg.buildings);

        const ticks: SnapshotTick[] = data.snapshot_ticks.map((t) => ({
          tick: t,
          created_at: "",
        }));
        setSnapshots(ticks);

        const graph = await getRegionsGraph(data.match.id);
        setRegionGraph(graph);

        setLoading(false);

        if (ticks.length > 0) {
          loadSnapshot(ticks[0].tick, 0);
        }
      })
      .catch(() => {
        setError(
          "Nie można załadować udostępnionych danych. Link może być nieprawidłowy lub wygasł."
        );
        setLoading(false);
      });
  }, [token, loadSnapshot]);

  // ── Prefetch next snapshots ─────────────────────────────
  useEffect(() => {
    if (snapshots.length === 0) return;
    for (
      let i = currentIndex + 1;
      i <= Math.min(currentIndex + 2, snapshots.length - 1);
      i++
    ) {
      const tick = snapshots[i].tick;
      if (!snapshotCache.current.has(tick)) {
        getSharedSnapshot(token, tick)
          .then((snap) => {
            snapshotCache.current.set(
              tick,
              snap.state_data as unknown as GameState
            );
          })
          .catch(() => {});
      }
    }
  }, [currentIndex, token, snapshots]);

  // ── Playback loop ───────────────────────────────────────
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

  // ── Derived data ────────────────────────────────────────
  const centroids = useMemo(() => {
    const c: Record<string, [number, number]> = {};
    for (const entry of regionGraph) {
      if (entry.centroid) c[entry.id] = entry.centroid;
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
  const totalTicks =
    snapshots.length > 0 ? snapshots[snapshots.length - 1].tick : 0;

  const playerList = useMemo(() => {
    const entries = Object.entries(players) as [string, GamePlayer][];
    const regionEntries = Object.values(regions) as GameRegion[];

    return entries
      .map(([id, p]) => {
        const ownedRegions = regionEntries.filter(
          (r) => r.owner_id === id
        ).length;
        const totalUnits = regionEntries
          .filter((r) => r.owner_id === id)
          .reduce((sum, r) => sum + (r.unit_count || 0), 0);
        return { id, ...p, ownedRegions, totalUnits };
      })
      .sort((a, b) => b.ownedRegions - a.ownedRegions);
  }, [players, regions]);

  const playersForMap = useMemo(() => {
    const m: Record<
      string,
      { color: string; username: string; cosmetics?: Record<string, unknown> }
    > = {};
    for (const [id, p] of Object.entries(players)) {
      const gp = p as GamePlayer;
      m[id] = { color: gp.color, username: gp.username, cosmetics: gp.cosmetics };
    }
    return m;
  }, [players]);

  // ── Handlers ────────────────────────────────────────────
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = Number(e.target.value);
    setPlaying(false);
    loadSnapshot(snapshots[idx].tick, idx);
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
    const idx = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  };

  // ── Loading / error states ───────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !sharedData) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
        <p className="text-lg text-muted-foreground">
          {error ?? "Nie znaleziono zasobu."}
        </p>
        <Link
          href="/register"
          className={buttonVariants({ className: "h-12 gap-2 rounded-full px-8 text-base" })}
        >
          <LogIn className="h-5 w-5" />
          Dołącz do gry
        </Link>
      </div>
    );
  }

  const { match, result } = sharedData;
  const status =
    STATUS_LABELS[match.status] ?? {
      label: match.status,
      color: "text-muted-foreground",
    };
  const winner = match.players.find((p) => p.user_id === match.winner_id);
  const hasReplay = snapshots.length > 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Top bar (same as main layout) ── */}
      <header className="fixed inset-x-0 top-0 z-40 h-12 border-b border-border bg-card/80 backdrop-blur-xl">
        <div className="flex h-full items-center gap-3 px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2 mr-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-secondary">
              <Globe size={15} className="text-muted-foreground" />
            </div>
            <span className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-foreground">
              MAPLORD
            </span>
          </Link>
          <div className="flex-1" />
        </div>
      </header>

      {/* ── Sidebar (auth links only) ── */}
      <aside className="fixed left-0 top-12 hidden h-[calc(100vh-3rem)] w-56 flex-col border-r border-border bg-card md:flex">
        <nav className="flex flex-col gap-1 p-4 pt-6">
          <p className="px-3 pb-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">Konto</p>
          <Link
            href="/login"
            className="flex items-center gap-3.5 rounded-lg px-4 py-3.5 text-lg font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogIn size={22} />
            Zaloguj się
          </Link>
          <Link
            href="/register"
            className="flex items-center gap-3.5 rounded-lg px-4 py-3.5 text-lg font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <UserPlus size={22} />
            Zarejestruj się
          </Link>
        </nav>
      </aside>

      {/* ── Main content ── */}
      <main className="pt-12 md:pl-56">
        <div className="space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        {/* Page title */}
        <div>
          <h1 className="font-display text-4xl sm:text-5xl text-foreground">
            Wyniki meczu
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            ID: {match.id.slice(0, 8)}... &mdash; udostępniony replay
          </p>
        </div>

        {/* Match info cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="rounded-2xl">
            <CardContent className="flex flex-col gap-2 p-5">
              <div className="flex items-center gap-2">
                <Swords className="h-5 w-5 text-primary" />
                <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">
                  Status
                </span>
              </div>
              <div className={`font-display text-3xl ${status.color}`}>
                {status.label}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="flex flex-col gap-2 p-5">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">
                  Gracze
                </span>
              </div>
              <div className="font-display text-3xl text-foreground">
                {match.players.length} / {match.max_players}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="flex flex-col gap-2 p-5">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">
                  {result ? "Czas trwania" : "Utworzono"}
                </span>
              </div>
              <div className="font-display text-3xl text-foreground">
                {result
                  ? formatDuration(result.duration_seconds)
                  : formatDate(match.created_at)}
              </div>
            </CardContent>
          </Card>

          {winner && (
            <Card className="rounded-2xl border-accent/25">
              <CardContent className="flex flex-col gap-2 p-5">
                <div className="flex items-center gap-2">
                  <Crown className="h-5 w-5 text-accent" />
                  <span className="text-xs uppercase tracking-[0.2em] text-accent/70 font-medium">
                    Zwycięzca
                  </span>
                </div>
                <div className="font-display text-3xl text-accent">
                  {winner.username}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Timestamps */}
        {(match.started_at || match.finished_at) && (
          <div className="flex flex-wrap gap-6 text-base text-muted-foreground">
            {match.started_at && (
              <span>
                Start:{" "}
                <span className="text-foreground">
                  {formatDate(match.started_at)}
                </span>
              </span>
            )}
            {match.finished_at && (
              <span>
                Koniec:{" "}
                <span className="text-foreground">
                  {formatDate(match.finished_at)}
                </span>
              </span>
            )}
            {result && (
              <span>
                Ticki:{" "}
                <span className="text-foreground">{result.total_ticks}</span>
              </span>
            )}
          </div>
        )}

        {/* Players table */}
        <Card className="rounded-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-6 pt-5 pb-3">
            <Users className="h-6 w-6 text-primary" />
            <h3 className="font-display text-2xl text-foreground">Gracze</h3>
          </div>
          <Table className="text-base">
            <TableHeader>
              <TableRow>
                <TableHead className="h-14 pl-6 text-base font-semibold">
                  Gracz
                </TableHead>
                <TableHead className="h-14 text-base font-semibold text-center">
                  Status
                </TableHead>
                <TableHead className="h-14 text-base font-semibold text-center">
                  Miejsce
                </TableHead>
                <TableHead className="h-14 text-base font-semibold text-center">
                  <span className="flex items-center justify-center gap-1">
                    <MapPin className="h-5 w-5" />
                    Regiony
                  </span>
                </TableHead>
                <TableHead className="h-14 text-base font-semibold text-center">
                  Jednostki
                </TableHead>
                <TableHead className="h-14 text-base font-semibold text-center">
                  Straty
                </TableHead>
                <TableHead className="h-14 text-base font-semibold text-center">
                  <span className="flex items-center justify-center gap-1">
                    <Hammer className="h-5 w-5" />
                    Budynki
                  </span>
                </TableHead>
                <TableHead className="h-14 pr-6 text-base font-semibold text-right">
                  ELO
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {match.players.map((player) => {
                const isWinner = player.user_id === match.winner_id;
                const pr = result?.player_results.find(
                  (r) => r.user_id === player.user_id
                );

                return (
                  <TableRow
                    key={player.id}
                    className={
                      isWinner
                        ? "bg-accent/5 hover:bg-accent/10"
                        : "hover:bg-muted/50"
                    }
                  >
                    <TableCell className="pl-6 py-5">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-8 w-8 rounded-lg border border-border"
                          style={{ backgroundColor: player.color }}
                        />
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-semibold text-foreground">
                            {player.username}
                          </span>
                          {isWinner && (
                            <Crown className="h-5 w-5 text-accent" />
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-5 text-center">
                      {player.is_alive ? (
                        <Badge className="border-0 bg-green-500/15 text-sm text-green-400">
                          Żywy
                        </Badge>
                      ) : (
                        <Badge className="border-0 bg-destructive/15 text-sm text-destructive">
                          <Skull className="mr-1 h-3.5 w-3.5" />
                          Wyeliminowany
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="py-5 text-center font-display text-2xl text-foreground">
                      {pr
                        ? match.players.length > 2
                          ? `#${pr.placement}`
                          : isWinner
                            ? "🏆"
                            : "💀"
                        : "—"}
                    </TableCell>
                    <TableCell className="py-5 text-center text-lg tabular-nums text-primary">
                      {pr?.regions_conquered ?? "—"}
                    </TableCell>
                    <TableCell className="py-5 text-center text-lg tabular-nums text-foreground">
                      {pr?.units_produced ?? "—"}
                    </TableCell>
                    <TableCell className="py-5 text-center text-lg tabular-nums text-destructive">
                      {pr?.units_lost ?? "—"}
                    </TableCell>
                    <TableCell className="py-5 text-center text-lg tabular-nums text-accent">
                      {pr?.buildings_built ?? "—"}
                    </TableCell>
                    <TableCell className="py-5 pr-6 text-right">
                      {pr ? (
                        <span
                          className={`flex items-center justify-end gap-1 font-display text-xl ${
                            pr.elo_change > 0
                              ? "text-green-400"
                              : pr.elo_change < 0
                                ? "text-destructive"
                                : "text-muted-foreground"
                          }`}
                        >
                          {pr.elo_change > 0 ? (
                            <TrendingUp className="h-5 w-5" />
                          ) : pr.elo_change < 0 ? (
                            <TrendingDown className="h-5 w-5" />
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

        {/* Replay section */}
        {hasReplay && (
          <>
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-2xl text-foreground">Replay</h2>
              <div className="flex items-center gap-2 text-base text-muted-foreground">
                <span>
                  Tick{" "}
                  <span className="font-display text-lg text-foreground">
                    {currentTick}
                  </span>{" "}
                  / {totalTicks}
                </span>
                <span className="text-border">|</span>
                <span>{snapshots.length} snapshotów</span>
              </div>
            </div>

            {/* Timeline controls — above map */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    onClick={stepBackward}
                    disabled={currentIndex === 0}
                    className="h-10 w-10 rounded-full p-0 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                  >
                    <SkipBack className="h-5 w-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setPlaying(!playing)}
                    className="h-12 w-12 rounded-full p-0 text-primary hover:bg-primary/10"
                  >
                    {playing ? (
                      <Pause className="h-6 w-6" />
                    ) : (
                      <Play className="h-6 w-6" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={stepForward}
                    disabled={currentIndex >= snapshots.length - 1}
                    className="h-10 w-10 rounded-full p-0 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                  >
                    <SkipForward className="h-5 w-5" />
                  </Button>
                </div>

                <input
                  type="range"
                  min={0}
                  max={snapshots.length - 1}
                  value={currentIndex}
                  onChange={handleSliderChange}
                  className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-primary [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(34,211,238,0.4)]"
                />

                <button
                  onClick={cycleSpeed}
                  className="rounded-full border border-border px-4 py-1.5 text-base font-semibold text-foreground hover:bg-muted"
                >
                  {speed}x
                </button>

                <div className="hidden text-right sm:block">
                  <span className="font-display text-xl text-foreground">
                    {currentTick}
                  </span>
                  <span className="text-base text-muted-foreground">
                    {" "}
                    / {totalTicks}
                  </span>
                </div>
              </div>
            </div>

            {/* Map + player sidebar */}
            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
              {/* Map */}
              <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
                <div className="w-full" style={{ height: "50vh" }}>
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
              <div className="rounded-2xl border border-border bg-card p-5 overflow-y-auto">
                <div className="mb-4 flex items-center gap-2.5">
                  <Users className="h-5 w-5 text-primary" />
                  <h3 className="font-display text-base uppercase tracking-[0.2em] text-foreground">
                    Gracze
                  </h3>
                </div>
                <div className="space-y-3">
                  {playerList.map((p) => {
                    const isWinner = p.id === match.winner_id;
                    return (
                      <div
                        key={p.id}
                        className={`rounded-xl border p-4 ${
                          !p.is_alive
                            ? "border-border/30 opacity-40"
                            : isWinner
                              ? "border-accent/25 bg-accent/5"
                              : "border-border bg-secondary/50"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="h-6 w-6 rounded-lg border border-border"
                            style={{ backgroundColor: p.color }}
                          />
                          <span className="flex-1 truncate text-lg font-semibold text-foreground">
                            {p.username}
                          </span>
                          {isWinner && (
                            <Crown className="h-5 w-5 text-accent" />
                          )}
                          {!p.is_alive && (
                            <Skull className="h-5 w-5 text-destructive" />
                          )}
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                          <div>
                            <div className="text-xs text-muted-foreground">
                              Regiony
                            </div>
                            <div className="font-display text-xl text-primary">
                              {p.ownedRegions}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">
                              Jednostki
                            </div>
                            <div className="font-display text-xl text-foreground">
                              {p.totalUnits}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">
                              Energia
                            </div>
                            <div className="font-display text-xl text-primary">
                              {p.energy}
                            </div>
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

        {/* Footer CTA */}
        <Card className="rounded-2xl border-border p-8 text-center">
          <CardContent className="p-0">
            <h2 className="font-display text-3xl text-foreground">
              Zagraj w MapLord
            </h2>
            <p className="mx-auto mt-3 max-w-md text-base text-muted-foreground">
              Zbuduj armię, podbij terytoria i rywalizuj z graczami z całego
              świata w czasie rzeczywistym.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Link
                href="/register"
                className={buttonVariants({ className: "h-12 gap-2 rounded-full px-8 text-base" })}
              >
                <LogIn className="h-5 w-5" />
                Dołącz do gry
              </Link>
              <Link
                href="/login"
                className={buttonVariants({ variant: "outline", className: "h-12 rounded-full px-8 text-base" })}
              >
                Zaloguj się
              </Link>
            </div>
          </CardContent>
        </Card>
        </div>
      </main>
    </div>
  );
}
