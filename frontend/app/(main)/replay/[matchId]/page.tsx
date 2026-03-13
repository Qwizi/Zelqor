"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useAuth } from "@/hooks/useAuth";
import {
  getMatch,
  getMatchSnapshots,
  getSnapshot,
  getRegionsGraph,
  getConfig,
  getRegionTilesUrl,
  type Match,
  type SnapshotTick,
  type RegionGraphEntry,
  type BuildingType,
} from "@/lib/api";
import type { GameState, GameRegion, GamePlayer } from "@/hooks/useGameSocket";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Crown,
  Skull,
  Users,
} from "lucide-react";

const GameMap = dynamic(
  () => import("@/components/map/GameMap"),
  { ssr: false }
);

const SPEEDS = [1, 2, 4, 8];

export default function ReplayPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();

  const [match, setMatch] = useState<Match | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotTick[]>([]);
  const [regionGraph, setRegionGraph] = useState<RegionGraphEntry[]>([]);
  const [buildingTypes, setBuildingTypes] = useState<BuildingType[]>([]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const currentIndexRef = useRef(0);
  playingRef.current = playing;
  speedRef.current = speed;
  currentIndexRef.current = currentIndex;

  // Cache loaded snapshots
  const snapshotCache = useRef<Map<number, GameState>>(new Map());

  // ── Load initial data ───────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    if (!user || !token) {
      router.replace("/login");
      return;
    }

    Promise.all([
      getMatch(token, matchId),
      getMatchSnapshots(token, matchId),
      getRegionsGraph(matchId),
      getConfig(),
    ]).then(([matchData, snapshotList, graph, cfg]) => {
      setMatch(matchData);
      setSnapshots(snapshotList);
      setRegionGraph(graph);
      setBuildingTypes(cfg.buildings);
      setLoading(false);

      // Load first snapshot
      if (snapshotList.length > 0) {
        loadSnapshot(snapshotList[0].tick, 0);
      }
    }).catch(() => setLoading(false));
  }, [authLoading, user, token, matchId, router, loadSnapshot]);

  // ── Load a snapshot ─────────────────────────────────────
  const loadSnapshot = useCallback(async (tick: number, index: number) => {
    if (!token) return;

    // Check cache first
    const cached = snapshotCache.current.get(tick);
    if (cached) {
      setGameState(cached);
      setCurrentIndex(index);
      return;
    }

    setSnapshotLoading(true);
    try {
      const snap = await getSnapshot(token, matchId, tick);
      const state = snap.state_data as unknown as GameState;
      snapshotCache.current.set(tick, state);
      setGameState(state);
      setCurrentIndex(index);
    } catch {
      // ignore
    } finally {
      setSnapshotLoading(false);
    }
  }, [token, matchId]);

  // ── Prefetch next snapshots ─────────────────────────────
  useEffect(() => {
    if (!token || snapshots.length === 0) return;
    // Prefetch next 2 snapshots
    for (let i = currentIndex + 1; i <= Math.min(currentIndex + 2, snapshots.length - 1); i++) {
      const tick = snapshots[i].tick;
      if (!snapshotCache.current.has(tick)) {
        getSnapshot(token, matchId, tick)
          .then((snap) => {
            snapshotCache.current.set(tick, snap.state_data as unknown as GameState);
          })
          .catch(() => {});
      }
    }
  }, [currentIndex, token, matchId, snapshots]);

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
  const totalTicks = snapshots.length > 0 ? snapshots[snapshots.length - 1].tick : 0;

  // Player stats for current snapshot
  const playerList = useMemo(() => {
    const entries = Object.entries(players) as [string, GamePlayer][];
    const regionEntries = Object.values(regions) as GameRegion[];

    return entries.map(([id, p]) => {
      const ownedRegions = regionEntries.filter((r) => r.owner_id === id).length;
      const totalUnits = regionEntries
        .filter((r) => r.owner_id === id)
        .reduce((sum, r) => sum + (r.unit_count || 0), 0);
      return { id, ...p, ownedRegions, totalUnits };
    }).sort((a, b) => b.ownedRegions - a.ownedRegions);
  }, [players, regions]);

  const playersForMap = useMemo(() => {
    const m: Record<string, { color: string; username: string }> = {};
    for (const [id, p] of Object.entries(players)) {
      m[id] = { color: (p as GamePlayer).color, username: (p as GamePlayer).username };
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

  // ── Loading state ───────────────────────────────────────
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
      <div className="space-y-4">
        <Link
          href={`/match/${matchId}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Powrot do meczu
        </Link>
        <div className="rounded-[24px] border border-white/10 bg-slate-950/55 px-6 py-12 text-center backdrop-blur-xl">
          <p className="text-slate-400">
            Brak snapshotow dla tego meczu. Replay nie jest dostepny.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href={`/match/${matchId}`}
            className="mb-2 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Szczegoly meczu
          </Link>
          <h1 className="font-display text-2xl text-zinc-50">Replay</h1>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span>Tick {currentTick} / {totalTicks}</span>
          <span className="text-slate-600">|</span>
          <span>{snapshots.length} snapshotow</span>
        </div>
      </div>

      {/* Map + players sidebar */}
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        {/* Map container */}
        <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/55 backdrop-blur-xl">
          <div className="aspect-[16/10] w-full">
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
              />
            )}
          </div>
          {snapshotLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/50">
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

        {/* Player panel */}
        <div className="rounded-[24px] border border-white/10 bg-slate-950/55 p-4 backdrop-blur-xl">
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-cyan-300" />
            <h3 className="font-display text-sm uppercase tracking-[0.2em] text-slate-300">
              Gracze
            </h3>
          </div>
          <div className="space-y-2">
            {playerList.map((p) => {
              const isWinner = p.id === match.winner_id;
              return (
                <div
                  key={p.id}
                  className={`rounded-xl border p-3 ${
                    !p.is_alive
                      ? "border-white/5 bg-white/[0.02] opacity-50"
                      : isWinner
                        ? "border-amber-300/20 bg-amber-400/5"
                        : "border-white/10 bg-white/[0.04]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="h-4 w-4 rounded border border-white/15"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="flex-1 truncate text-sm font-medium text-zinc-100">
                      {p.username}
                    </span>
                    {isWinner && <Crown className="h-3.5 w-3.5 text-amber-300" />}
                    {!p.is_alive && <Skull className="h-3.5 w-3.5 text-red-400" />}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[10px]">
                    <div>
                      <div className="text-slate-500">Regiony</div>
                      <div className="font-display text-sm text-cyan-200">{p.ownedRegions}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Jednostki</div>
                      <div className="font-display text-sm text-zinc-100">{p.totalUnits}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Waluta</div>
                      <div className="font-display text-sm text-amber-200">{p.currency}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Timeline controls */}
      <div className="rounded-[24px] border border-white/10 bg-slate-950/55 p-4 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          {/* Controls */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={stepBackward}
              disabled={currentIndex === 0}
              className="h-8 w-8 rounded-full p-0 text-slate-300 hover:bg-white/[0.08] hover:text-zinc-100 disabled:opacity-30"
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPlaying(!playing)}
              className="h-9 w-9 rounded-full p-0 text-cyan-200 hover:bg-cyan-400/10 hover:text-cyan-100"
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={stepForward}
              disabled={currentIndex >= snapshots.length - 1}
              className="h-8 w-8 rounded-full p-0 text-slate-300 hover:bg-white/[0.08] hover:text-zinc-100 disabled:opacity-30"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          {/* Slider */}
          <input
            type="range"
            min={0}
            max={snapshots.length - 1}
            value={currentIndex}
            onChange={handleSliderChange}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-cyan-400 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400 [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(34,211,238,0.4)]"
          />

          {/* Speed */}
          <button
            onClick={cycleSpeed}
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-zinc-100"
          >
            {speed}x
          </button>

          {/* Tick counter */}
          <div className="hidden text-right text-xs text-slate-500 sm:block">
            <span className="font-display text-sm text-zinc-100">{currentTick}</span>
            <span> / {totalTicks}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
