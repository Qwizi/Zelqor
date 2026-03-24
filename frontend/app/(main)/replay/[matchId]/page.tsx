"use client";

import { ArrowLeft, Crown, Pause, Play, SkipBack, SkipForward, Skull, Users } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useConfig, useMatch, useMatchSnapshots, useRegionsGraph } from "@/hooks/queries";
import { useAuth } from "@/hooks/useAuth";
import type { GamePlayer, GameRegion, GameState } from "@/hooks/useGameSocket";
import { getRegionTilesUrl, getSnapshot } from "@/lib/api";
import { loadAssetOverrides } from "@/lib/assetOverrides";
import { requireToken } from "@/lib/queryClient";

const GameMap = dynamic(() => import("@/components/map/GameMap"), { ssr: false });

const SPEEDS = [1, 2, 4, 8];

export default function ReplayPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const { data: match } = useMatch(matchId);
  const { data: snapshots = [] } = useMatchSnapshots(matchId);
  const { data: regionGraph = [] } = useRegionsGraph(matchId);
  const { data: configData } = useConfig();
  const buildingTypes = configData?.buildings ?? [];
  const loading = !match || !configData;

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
        const snap = await getSnapshot(requireToken(), matchId, tick);
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
    [matchId],
  );

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    loadAssetOverrides();
  }, []);

  useEffect(() => {
    if (snapshots.length > 0 && !gameState) {
      loadSnapshot(snapshots[0].tick, 0);
    }
  }, [snapshots, gameState, loadSnapshot]);

  useEffect(() => {
    if (snapshots.length === 0) return;
    for (let i = currentIndex + 1; i <= Math.min(currentIndex + 2, snapshots.length - 1); i++) {
      const tick = snapshots[i].tick;
      if (!snapshotCache.current.has(tick)) {
        getSnapshot(requireToken(), matchId, tick)
          .then((snap) => {
            snapshotCache.current.set(tick, snap.state_data as unknown as GameState);
          })
          .catch(() => {});
      }
    }
  }, [currentIndex, matchId, snapshots]);

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
  const totalTicks = snapshots.length > 0 ? snapshots[snapshots.length - 1].tick : 0;

  const playerList = useMemo(() => {
    const entries = Object.entries(players) as [string, GamePlayer][];
    const regionEntries = Object.values(regions) as GameRegion[];
    return entries
      .map(([id, p]) => {
        const ownedRegions = regionEntries.filter((r) => r.owner_id === id).length;
        const totalUnits = regionEntries
          .filter((r) => r.owner_id === id)
          .reduce((sum, r) => sum + (r.unit_count || 0), 0);
        return { id, ...p, ownedRegions, totalUnits };
      })
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

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Image
          src="/assets/match_making/circle291.webp"
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 animate-spin object-contain"
        />
      </div>
    );
  }

  if (!match || snapshots.length === 0) {
    return (
      <div className="space-y-4 px-4 md:px-0">
        <Link
          href={`/match/${matchId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Powrót do meczu
        </Link>
        <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center">
          <p className="text-sm md:text-base text-muted-foreground">Brak snapshotów. Replay nie jest dostępny.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 md:px-0">
        <div className="flex items-center gap-2">
          <Link
            href={`/match/${matchId}`}
            className="inline-flex items-center justify-center h-9 w-9 md:h-auto md:w-auto md:gap-2 rounded-full md:rounded-lg text-muted-foreground transition-all hover:text-foreground hover:bg-muted active:scale-[0.95]"
          >
            <ArrowLeft className="h-4 w-4 md:h-5 md:w-5" />
            <span className="hidden md:inline text-base">Szczegóły meczu</span>
          </Link>
          <h1 className="font-display text-lg md:text-4xl text-foreground">Replay</h1>
        </div>
        <div className="flex items-center gap-2 text-xs md:text-base text-muted-foreground">
          <span className="font-display text-sm md:text-lg text-foreground tabular-nums">{currentTick}</span>
          <span>/ {totalTicks}</span>
        </div>
      </div>

      {/* Timeline controls */}
      <div className="rounded-none md:rounded-2xl border-y md:border border-border bg-card/80 md:bg-card px-3 py-2.5 md:p-5 mx-0 md:mx-0">
        <div className="flex items-center gap-2 md:gap-4">
          <div className="flex items-center gap-0.5 md:gap-1.5">
            <Button
              variant="ghost"
              onClick={stepBackward}
              disabled={currentIndex === 0}
              className="h-8 w-8 md:h-10 md:w-10 rounded-full p-0 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <SkipBack className="h-4 w-4 md:h-5 md:w-5" />
            </Button>
            <Button
              variant="ghost"
              onClick={() => setPlaying(!playing)}
              className="h-10 w-10 md:h-12 md:w-12 rounded-full p-0 text-primary hover:bg-primary/10"
            >
              {playing ? <Pause className="h-5 w-5 md:h-6 md:w-6" /> : <Play className="h-5 w-5 md:h-6 md:w-6" />}
            </Button>
            <Button
              variant="ghost"
              onClick={stepForward}
              disabled={currentIndex >= snapshots.length - 1}
              className="h-8 w-8 md:h-10 md:w-10 rounded-full p-0 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
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
            className="h-1.5 md:h-2 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-primary [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 md:[&::-webkit-slider-thumb]:h-5 md:[&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(34,211,238,0.4)]"
          />
          <button
            onClick={cycleSpeed}
            className="rounded-full border border-border px-3 py-1 md:px-4 md:py-1.5 text-sm md:text-base font-semibold text-foreground hover:bg-muted active:scale-[0.95]"
          >
            {speed}x
          </button>
        </div>
      </div>

      {/* Map + players */}
      <div className="grid gap-3 md:gap-4 lg:grid-cols-[1fr_320px] px-4 md:px-0 lg:h-[calc(100vh-20rem)]">
        {/* Map */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card h-[50vh] md:h-full">
          <div className="h-full w-full">
            {gameState && (
              <GameMap
                tilesUrl={getRegionTilesUrl(matchId)}
                centroids={centroids}
                regions={regions as Record<string, GameRegion>}
                players={playersForMap}
                selectedRegion={null}
                targetRegions={[]}
                highlightedNeighbors={[]}
                dimmedRegions={[]}
                onRegionClick={() => {}}
                myUserId={user?.id ?? ""}
                animations={[]}
                buildingIcons={buildingIcons}
                activeEffects={gameState.active_effects}
                initialZoom={2.5}
              />
            )}
          </div>
          {snapshotLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-card/70">
              <Image
                src="/assets/match_making/circle291.webp"
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 animate-spin object-contain"
              />
            </div>
          )}
        </div>

        {/* Player panel — horizontal scroll on mobile, sidebar on desktop */}
        <div>
          <div className="mb-2 md:mb-4 flex items-center gap-2 md:gap-2.5">
            <Users className="h-4 w-4 md:h-5 md:w-5 text-primary" />
            <h3 className="text-[11px] md:text-base font-display uppercase tracking-[0.15em] md:tracking-[0.2em] text-foreground">
              Gracze
            </h3>
          </div>

          {/* Mobile: horizontal scroll */}
          <div className="flex gap-2 overflow-x-auto pb-1 md:hidden scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
            {playerList.map((p) => {
              const isWinner = p.id === match.winner_id;
              return (
                <div
                  key={p.id}
                  className={`shrink-0 rounded-xl border p-3 w-36 ${
                    !p.is_alive
                      ? "border-border/30 opacity-40"
                      : isWinner
                        ? "border-accent/25 bg-accent/5"
                        : "border-border bg-secondary/50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-5 w-5 rounded-md border border-border" style={{ backgroundColor: p.color }} />
                    <span className="flex-1 truncate text-xs font-semibold text-foreground">{p.username}</span>
                    {isWinner && <Crown className="h-3.5 w-3.5 text-accent shrink-0" />}
                    {!p.is_alive && <Skull className="h-3.5 w-3.5 text-destructive shrink-0" />}
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-center">
                    <div>
                      <div className="text-[9px] text-muted-foreground">Reg</div>
                      <div className="font-display text-sm text-primary">{p.ownedRegions}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-muted-foreground">Jedn</div>
                      <div className="font-display text-sm text-foreground">{p.totalUnits}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-muted-foreground">Ener</div>
                      <div className="font-display text-sm text-primary">{p.energy}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop: vertical sidebar */}
          <div className="hidden md:block rounded-2xl border border-border bg-card p-5 overflow-y-auto space-y-3">
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
                    <div className="h-6 w-6 rounded-lg border border-border" style={{ backgroundColor: p.color }} />
                    <span className="flex-1 truncate text-base font-semibold text-foreground">{p.username}</span>
                    {isWinner && <Crown className="h-5 w-5 text-accent" />}
                    {!p.is_alive && <Skull className="h-5 w-5 text-destructive" />}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-xs text-muted-foreground">Regiony</div>
                      <div className="font-display text-lg text-primary">{p.ownedRegions}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Jednostki</div>
                      <div className="font-display text-lg text-foreground">{p.totalUnits}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Energia</div>
                      <div className="font-display text-lg text-primary">{p.energy}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
