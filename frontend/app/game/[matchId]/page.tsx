"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useGameSocket } from "@/hooks/useGameSocket";
import {
  getRegionsGraph,
  getRegionTilesUrl,
  getConfig,
  type RegionGraphEntry,
  type BuildingType,
} from "@/lib/api";
import GameMap, {
  type TroopAnimation,
  ANIMATION_DURATION_MS,
} from "@/components/map/GameMap";
import GameHUD from "@/components/game/GameHUD";
import RegionPanel from "@/components/game/RegionPanel";
import ActionBar, { type TargetEntry } from "@/components/game/ActionBar";
import BuildQueue from "@/components/game/BuildQueue";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function GamePage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = use(params);
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const {
    connected,
    gameState,
    events,
    selectCapital,
    attack,
    move,
    build,
  } = useGameSocket(matchId);

  const [regionGraph, setRegionGraph] = useState<RegionGraphEntry[]>([]);
  const [buildings, setBuildings] = useState<BuildingType[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [actionTargets, setActionTargets] = useState<string[]>([]);
  const [animations, setAnimations] = useState<TroopAnimation[]>([]);
  const [mapReady, setMapReady] = useState(false);

  // Keep a ref to gameState so event-driven animation effect can read latest players/colors
  const gameStateRef = useRef(gameState);
  useLayoutEffect(() => { gameStateRef.current = gameState; });

  // Track how many events we've already processed for animations
  const processedEventCountRef = useRef(0);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [user, authLoading, router]);

  // Load geo graph filtered to this match's map config, plus global config
  useEffect(() => {
    getRegionsGraph(matchId).then(setRegionGraph).catch(console.error);
    getConfig()
      .then((cfg) => setBuildings(cfg.buildings))
      .catch(console.error);
  }, [matchId]);

  // Prune finished animations
  useEffect(() => {
    const timer = setInterval(() => {
      setAnimations((prev) => {
        const now = Date.now();
        const active = prev.filter(
          (a) => now - a.startTime < ANIMATION_DURATION_MS + 500
        );
        return active.length !== prev.length ? active : prev;
      });
    }, 500);
    return () => clearInterval(timer);
  }, []);

  // Build neighbor lookup and centroid map from the lightweight graph
  const { neighborMap, centroids } = useMemo(() => {
    const neighborMap: Record<string, string[]> = {};
    const centroids: Record<string, [number, number]> = {};
    for (const entry of regionGraph) {
      neighborMap[entry.id] = entry.neighbor_ids;
      if (entry.centroid) centroids[entry.id] = entry.centroid;
    }
    return { neighborMap, centroids };
  }, [regionGraph]);

  // Building slug → emoji icon lookup
  const buildingIcons = useMemo(() => {
    const m: Record<string, string> = {};
    for (const b of buildings) {
      m[b.slug] = b.icon;
    }
    return m;
  }, [buildings]);

  const myUserId = user?.id || "";
  const status = gameState?.meta?.status || "loading";

  // Guard against double capital selection while waiting for server confirmation
  const hasSelectedCapital = !!gameState?.players[myUserId]?.capital_region_id;

  // ── Derived state ──────────────────────────────────────────

  const sourceRegionData = selectedRegion
    ? gameState?.regions[selectedRegion]
    : null;

  const isSource =
    !!sourceRegionData &&
    sourceRegionData.owner_id === myUserId &&
    sourceRegionData.unit_count > 0;

  const highlightedNeighbors = useMemo(() => {
    if (!isSource || !selectedRegion || status !== "in_progress") return [];
    const allNeighbors = neighborMap[selectedRegion] || [];
    // Only highlight neighbors that exist on the current map
    const mapRegions = gameState?.regions || {};
    return allNeighbors.filter((nid) => nid in mapRegions);
  }, [isSource, selectedRegion, status, neighborMap, gameState?.regions]);

  // Per-map minimum distance between capitals (comes from MapConfig → settings_snapshot → Redis meta)
  const MIN_CAPITAL_DISTANCE = parseInt(
    gameState?.meta?.min_capital_distance || "3",
    10
  );

  // Regions too close to any existing capital — dimmed on the map during selection
  const dimmedRegions = useMemo(() => {
    if (status !== "selecting") return [];
    const mapRegions = gameState?.regions || {};
    const existingCapitals = Object.entries(mapRegions)
      .filter(([, r]) => r.is_capital)
      .map(([id]) => id);
    if (existingCapitals.length === 0) return [];

    const tooClose = new Set<string>();
    for (const capitalId of existingCapitals) {
      const visited = new Set([capitalId]);
      const queue: [string, number][] = [[capitalId, 0]];
      while (queue.length > 0) {
        const [current, dist] = queue.shift()!;
        if (dist > 0 && current in mapRegions) tooClose.add(current);
        if (dist >= MIN_CAPITAL_DISTANCE) continue;
        for (const neighbor of neighborMap[current] || []) {
          // Only traverse through match regions — keeps hop count within game graph
          if (neighbor in mapRegions && !visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push([neighbor, dist + 1]);
          }
        }
      }
      tooClose.delete(capitalId); // capital itself is already owned, not a candidate
    }

    // Safety net: if every unowned match region would be blocked, lift the restriction
    const unowned = Object.entries(mapRegions)
      .filter(([, r]) => !r.owner_id)
      .map(([id]) => id);
    if (unowned.length > 0 && unowned.every((id) => tooClose.has(id))) {
      return [];
    }

    return Array.from(tooClose);
  }, [status, gameState?.regions, neighborMap, MIN_CAPITAL_DISTANCE]);

  // My stats
  const { myRegionCount, myUnitCount } = useMemo(() => {
    if (!gameState) return { myRegionCount: 0, myUnitCount: 0 };
    let rc = 0;
    let uc = 0;
    for (const r of Object.values(gameState.regions)) {
      if (r.owner_id === myUserId) {
        rc++;
        uc += r.unit_count;
      }
    }
    return { myRegionCount: rc, myUnitCount: uc };
  }, [gameState, myUserId]);

  // ── Event-driven animations (visible to ALL clients) ───────
  //
  // Instead of triggering animations locally (only visible to the acting player),
  // we derive them from server events so every connected client sees the same
  // troop movements and attacks.

  useEffect(() => {
    if (events.length <= processedEventCountRef.current) return;
    const newEvents = events.slice(processedEventCountRef.current);
    processedEventCountRef.current = events.length;

    const newAnims: TroopAnimation[] = [];
    for (const e of newEvents) {
      if (e.type === "attack_success" || e.type === "attack_failed") {
        const playerId = e.player_id as string;
        const color = gameStateRef.current?.players[playerId]?.color ?? "#3b82f6";
        newAnims.push({
          id: crypto.randomUUID(),
          sourceId: e.source_region_id as string,
          targetId: e.target_region_id as string,
          color,
          units: (e.units as number) || 0,
          type: "attack",
          startTime: Date.now(),
        });
      } else if (e.type === "units_moved") {
        const playerId = e.player_id as string;
        const color = gameStateRef.current?.players[playerId]?.color ?? "#3b82f6";
        newAnims.push({
          id: crypto.randomUUID(),
          sourceId: e.source_region_id as string,
          targetId: e.target_region_id as string,
          color,
          units: (e.units as number) || 0,
          type: "move",
          startTime: Date.now(),
        });
      }
    }

    if (newAnims.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnimations((prev) => [...prev, ...newAnims]);
    }
  }, [events]);

  // ── Click handler ──────────────────────────────────────────

  const handleRegionClick = useCallback(
    (regionId: string) => {
      if (!mapReady) return;

      // Capital selection phase
      if (status === "selecting") {
        if (hasSelectedCapital) return; // already selected, waiting for server confirmation
        const region = gameState?.regions[regionId];
        // Region not part of this match — silently ignore (player may have clicked
        // on a neighbouring country rendered in the tiles but not in the game)
        if (!region) return;
        // Already owned — player likely clicked near the border of another capital;
        // silently ignore so they can try clicking a different region
        if (region.owner_id) return;
        // Too close to an existing capital
        if (dimmedRegions.includes(regionId)) {
          const minDist = parseInt(gameState?.meta?.min_capital_distance || "3", 10);
          toast.error(
            `Stolica musi być co najmniej ${minDist} regiony od stolicy innego gracza`
          );
          return;
        }
        selectCapital(regionId);
        toast.success(`Stolica ustawiona: ${region.name}`);
        return;
      }

      if (status !== "in_progress") return;

      const region = gameState?.regions[regionId];
      if (!region) return;

      // If we have a source and clicked a valid neighbor → set as target
      if (
        selectedRegion &&
        selectedRegion !== regionId &&
        isSource &&
        highlightedNeighbors.includes(regionId)
      ) {
        // Toggle target in/out of selection
        setActionTargets((prev) =>
          prev.includes(regionId)
            ? prev.filter((id) => id !== regionId)
            : [...prev, regionId]
        );
        return;
      }

      // Click same region → deselect everything
      if (regionId === selectedRegion) {
        setSelectedRegion(null);
        setActionTargets([]);
        return;
      }

      // Select new region (switch source or info-only)
      setSelectedRegion(regionId);
      setActionTargets([]);
    },
    [
      status,
      gameState,
      selectedRegion,
      isSource,
      highlightedNeighbors,
      dimmedRegions,
      selectCapital,
      mapReady,
      hasSelectedCapital,
    ]
  );

  // ── Action handlers ────────────────────────────────────────

  // Confirm from ActionBar
  const handleConfirmAction = useCallback(
    (allocations: { regionId: string; units: number }[]) => {
      if (!selectedRegion || !gameState) return;
      for (const { regionId, units } of allocations) {
        const target = gameState.regions[regionId];
        if (!target) continue;
        if (target.owner_id !== myUserId) {
          attack(selectedRegion, regionId, units);
        } else {
          move(selectedRegion, regionId, units);
        }
      }
      toast.info(`Wysłano wojska do ${allocations.length} region${allocations.length > 1 ? "ów" : "u"}`);
      setSelectedRegion(null);
      setActionTargets([]);
    },
    [selectedRegion, gameState, myUserId, attack, move]
  );

  // Attack/move from RegionPanel
  const handleAttack = useCallback(
    (targetId: string, units: number) => {
      if (!selectedRegion) return;
      attack(selectedRegion, targetId, units);
      toast.info(`⚔️ Atak: ${units} jednostek`);
      setSelectedRegion(null);
      setActionTargets([]);
    },
    [selectedRegion, attack]
  );

  const handleMove = useCallback(
    (targetId: string, units: number) => {
      if (!selectedRegion) return;
      move(selectedRegion, targetId, units);
      toast.info(`📦 Przeniesienie: ${units} jednostek`);
      setSelectedRegion(null);
      setActionTargets([]);
    },
    [selectedRegion, move]
  );

  const handleBuild = useCallback(
    (buildingType: string) => {
      if (selectedRegion) {
        build(selectedRegion, buildingType);
        toast.info(`🔨 Budowa: ${buildingType}`);
      }
    },
    [selectedRegion, build]
  );

  // ── Events ─────────────────────────────────────────────────

  useEffect(() => {
    if (events.length === 0) return;
    const last = events[events.length - 1];
    if (last.type === "game_over") {
      const winnerId = last.winner_id as string;
      const winner = gameState?.players[winnerId];
      if (winnerId === myUserId) {
        toast.success("🏆 Wygrałeś!");
      } else {
        toast.error(`Przegrałeś! Wygrywa: ${winner?.username || "?"}`);
      }
    }
    if (last.type === "player_eliminated" && last.player_id === myUserId) {
      toast.error("💀 Twoja stolica została zdobyta!");
    }
    if (last.type === "server_error") {
      toast.error(last.message as string);
    }
  }, [events, myUserId, gameState?.players]);

  // ── Render ─────────────────────────────────────────────────

  if (authLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  const players = gameState?.players || {};
  const regions = gameState?.regions || {};
  const currentTick = parseInt(gameState?.meta?.current_tick || "0", 10);

  const targets: TargetEntry[] = actionTargets
    .map((rid) => {
      const r = regions[rid];
      if (!r) return null;
      return {
        regionId: rid,
        region: r,
        name: r.name,
        isAttack: r.owner_id !== myUserId,
      } satisfies TargetEntry;
    })
    .filter(Boolean) as TargetEntry[];

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-zinc-950">
      {/* Connection status */}
      {!connected && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="flex items-center gap-3 rounded-lg bg-zinc-900 px-6 py-4">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Łączenie z serwerem...</span>
          </div>
        </div>
      )}

      {/* Map loading overlay */}
      {!mapReady && connected && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-zinc-950/90">
          <div className="flex flex-col items-center gap-3 rounded-lg bg-zinc-900 px-8 py-6">
            <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
            <span className="text-sm text-zinc-300">Ładowanie mapy...</span>
          </div>
        </div>
      )}

      {/* Capital selection overlay */}
      {mapReady && status === "selecting" && (
        <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-lg bg-yellow-600/90 px-6 py-3 text-center font-bold text-white backdrop-blur">
          👑 Kliknij na region, aby wybrać stolicę
        </div>
      )}

      {/* Source selection hint */}
      {mapReady && status === "in_progress" && !selectedRegion && (
        <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-lg bg-zinc-800/80 px-4 py-2 text-sm text-zinc-300 backdrop-blur">
          Kliknij swój region, aby wybrać źródło
        </div>
      )}

      {/* Target selection hint */}
      {mapReady && status === "in_progress" && isSource && actionTargets.length === 0 && (
        <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-lg bg-blue-800/80 px-4 py-2 text-sm text-blue-200 backdrop-blur">
          Kliknij sąsiedni region, aby zaatakować lub przenieść jednostki
        </div>
      )}

      {/* Game over overlay */}
      {status === "finished" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="rounded-xl bg-zinc-900 p-8 text-center">
            <h2 className="mb-4 text-3xl font-bold">🏆 Koniec gry!</h2>
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-lg bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-500"
            >
              Wróć do lobby
            </button>
          </div>
        </div>
      )}

      {/* Map */}
      <GameMap
        tilesUrl={getRegionTilesUrl(matchId)}
        dimmedRegions={dimmedRegions}
        centroids={centroids}
        regions={regions}
        players={players}
        selectedRegion={selectedRegion}
        targetRegions={actionTargets}
        highlightedNeighbors={highlightedNeighbors}
        onRegionClick={handleRegionClick}
        myUserId={myUserId}
        animations={animations}
        buildingIcons={buildingIcons}
        onMapReady={() => setMapReady(true)}
      />

      {/* HUD */}
      <GameHUD
        tick={currentTick}
        status={status}
        players={players}
        events={events}
        myUserId={myUserId}
        myRegionCount={myRegionCount}
        myUnitCount={myUnitCount}
      />

      {/* Build queue progress */}
      <BuildQueue
        queue={gameState?.buildings_queue || []}
        buildings={buildings}
        myUserId={myUserId}
      />

      {/* Action Bar (multi-target) */}
      {actionTargets.length > 0 && sourceRegionData && selectedRegion && (
        <ActionBar
          sourceRegion={sourceRegionData}
          sourceName={sourceRegionData.name}
          targets={targets}
          onConfirm={handleConfirmAction}
          onRemoveTarget={(rid) =>
            setActionTargets((prev) => prev.filter((id) => id !== rid))
          }
          onCancel={() => {
            setSelectedRegion(null);
            setActionTargets([]);
          }}
        />
      )}

      {/* Region panel (info + panel-based actions) */}
      {sourceRegionData && selectedRegion && actionTargets.length === 0 && (
        <RegionPanel
          regionId={selectedRegion}
          region={sourceRegionData}
          players={players}
          myUserId={myUserId}
          neighborIds={neighborMap[selectedRegion] || []}
          regions={regions}
          buildings={buildings}
          onAttack={handleAttack}
          onMove={handleMove}
          onBuild={handleBuild}
          onClose={() => {
            setSelectedRegion(null);
            setActionTargets([]);
          }}
        />
      )}
    </div>
  );
}
