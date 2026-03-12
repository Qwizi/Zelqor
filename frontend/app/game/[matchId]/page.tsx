"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, use } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/hooks/useAuth";
import { useGameSocket } from "@/hooks/useGameSocket";
import { useAudio } from "@/hooks/useAudio";
import {
  getRegionsGraph,
  getRegionTilesUrl,
  getConfig,
  type RegionGraphEntry,
  type BuildingType,
  type UnitType,
} from "@/lib/api";
import { getSeaTravelRange, getTravelDistance } from "@/lib/gameTravel.js";
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

function getUnitRules(units: UnitType[], unitSlug: string | null | undefined) {
  return (
    units.find((unit) => unit.slug === unitSlug) ?? {
      id: "default",
      name: "Infantry",
      slug: "infantry",
      asset_key: "ground_unit",
      description: "",
      icon: "",
      attack: 1,
      defense: 1,
      speed: 1,
      attack_range: 1,
      sea_range: 0,
      sea_hop_distance_km: 0,
      movement_type: "land",
      manpower_cost: 1,
    }
  );
}

function getAnimationPower(
  unitsConfig: UnitType[],
  unitType: string | null | undefined,
  carrierCount: number
) {
  const rules = getUnitRules(unitsConfig, unitType);
  const scale = Math.max(1, rules.manpower_cost || 1);
  return carrierCount * scale;
}

function intOrZero(value: unknown) {
  return typeof value === "number" ? value : Number(value || 0) || 0;
}

type ReachabilityEntry = {
  moveTargets: Set<string>;
  attackTargets: Set<string>;
  moveDistanceByTarget: Map<string, number>;
  attackDistanceByTarget: Map<string, number>;
};

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
    produceUnit,
    leaveMatch,
  } = useGameSocket(matchId);

  const { startMusic, stopMusic, playSound, toggleMute, muted } = useAudio();

  const [regionGraph, setRegionGraph] = useState<RegionGraphEntry[]>([]);
  const [buildings, setBuildings] = useState<BuildingType[]>([]);
  const [unitsConfig, setUnitsConfig] = useState<UnitType[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selectedActionUnitType, setSelectedActionUnitType] = useState<string | null>(null);
  const [actionTargets, setActionTargets] = useState<string[]>([]);
  const [animations, setAnimations] = useState<TroopAnimation[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const myUserId = user?.id || "";
  const status = gameState?.meta?.status || "loading";

  // Keep a ref to gameState so event-driven animation effect can read latest players/colors
  const gameStateRef = useRef(gameState);
  useLayoutEffect(() => { gameStateRef.current = gameState; });

  // Track the last processed event batch so animation derivation survives event list trimming.
  const lastProcessedEventKeyRef = useRef<string | null>(null);
  const lastProcessedAudioKeyRef = useRef<string | null>(null);
  const localDispatchKeysRef = useRef(new Map<string, number>());

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
      .then((cfg) => {
        setBuildings(cfg.buildings);
        setUnitsConfig(cfg.units);
      })
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

  useEffect(() => {
    if (status !== "selecting") return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);

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

  // Building slug -> asset key for asset-based symbol markers on the map.
  const buildingIcons = useMemo(() => {
    const m: Record<string, string> = {};
    for (const b of buildings) {
      m[b.slug] = b.asset_key || b.slug;
    }
    return m;
  }, [buildings]);

  const unitConfigBySlug = useMemo(() => {
    return Object.fromEntries(unitsConfig.map((unit) => [unit.slug, unit] as const));
  }, [unitsConfig]);

  // Guard against double capital selection while waiting for server confirmation
  const hasSelectedCapital = !!gameState?.players[myUserId]?.capital_region_id;

  // ── Derived state ──────────────────────────────────────────

  const sourceRegionData = selectedRegion
    ? gameState?.regions[selectedRegion]
    : null;
  const availableSourceUnitTypes = Object.entries(sourceRegionData?.units ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const isSource =
    !!sourceRegionData &&
    sourceRegionData.owner_id === myUserId &&
    sourceRegionData.unit_count > 0;

  const reachabilityByUnitType = useMemo(() => {
    if (!selectedRegion || status !== "in_progress") {
      return {} as Record<string, ReachabilityEntry>;
    }

    const mapRegions = gameState?.regions || {};
    const sourceRegion = mapRegions[selectedRegion];
    if (!sourceRegion) {
      return {} as Record<string, ReachabilityEntry>;
    }

    const result: Record<string, ReachabilityEntry> = {};

    for (const [unitType, count] of Object.entries(sourceRegion.units ?? {})) {
      if (count < 1) continue;

      const rules = unitConfigBySlug[unitType] ?? getUnitRules(unitsConfig, unitType);
      const movementType = rules.movement_type;
      const seaRange = getSeaTravelRange(rules);
      const moveRange = Math.max(1, rules.speed || 1, rules.attack_range || 1);
      const attackRange = Math.max(1, rules.attack_range || 1);
      const moveTargets = new Set<string>();
      const attackTargets = new Set<string>();
      const moveDistanceByTarget = new Map<string, number>();
      const attackDistanceByTarget = new Map<string, number>();

      for (const [regionId, region] of Object.entries(mapRegions)) {
        if (regionId === selectedRegion) continue;
        if (movementType === "sea" && !region.is_coastal) continue;

        if (region.owner_id === myUserId) {
          const moveDistance = getTravelDistance(
            selectedRegion,
            regionId,
            mapRegions,
            neighborMap,
            movementType,
            seaRange,
            moveRange,
            (candidateRegionId: string) => {
              const candidate = mapRegions[candidateRegionId];
              if (!candidate) return false;
              if (movementType === "sea" && !candidate.is_coastal) return false;
              if (movementType === "air") return true;
              return candidate.owner_id === myUserId;
            }
          );
          if (moveDistance !== null) {
            moveTargets.add(regionId);
            moveDistanceByTarget.set(regionId, moveDistance);
          }
          continue;
        }

        const attackDistance = getTravelDistance(
          selectedRegion,
          regionId,
          mapRegions,
          neighborMap,
          movementType,
          seaRange,
          attackRange,
          (candidateRegionId: string) => {
            const candidate = mapRegions[candidateRegionId];
            if (!candidate) return false;
            if (movementType === "sea" && !candidate.is_coastal) return false;
            return true;
          }
        );
        if (attackDistance !== null) {
          attackTargets.add(regionId);
          attackDistanceByTarget.set(regionId, attackDistance);
        }
      }

      result[unitType] = {
        moveTargets,
        attackTargets,
        moveDistanceByTarget,
        attackDistanceByTarget,
      };
    }

    return result;
  }, [gameState?.regions, myUserId, neighborMap, selectedRegion, status, unitConfigBySlug, unitsConfig]);

  const getPreferredReachableUnitType = useCallback((targetId: string) => {
    if (!sourceRegionData) return null;
    const targetRegion = gameState?.regions[targetId];
    if (!targetRegion) return null;

    const candidates = Object.entries(sourceRegionData.units ?? {})
      .filter(([, count]) => count > 0)
      .map(([unitType]) => unitType)
      .filter((unitType) => {
        const entry = reachabilityByUnitType[unitType];
        if (!entry) return false;
        return targetRegion.owner_id === myUserId
          ? entry.moveTargets.has(targetId)
          : entry.attackTargets.has(targetId);
      });

    if (candidates.length === 0) return null;
    if (candidates.includes("infantry")) return "infantry";

    return candidates.sort((left, right) => {
      const leftOrder = unitConfigBySlug[left]?.order ?? 9999;
      const rightOrder = unitConfigBySlug[right]?.order ?? 9999;
      return leftOrder - rightOrder;
    })[0];
  }, [gameState?.regions, myUserId, reachabilityByUnitType, sourceRegionData, unitConfigBySlug]);

  const selectedUnitTypeForAction =
    (selectedActionUnitType &&
    availableSourceUnitTypes.some(([unitType]) => unitType === selectedActionUnitType)
      ? selectedActionUnitType
      : null) ||
    (actionTargets.length > 0 ? getPreferredReachableUnitType(actionTargets[0]) : null) ||
    availableSourceUnitTypes[0]?.[0] ||
    sourceRegionData?.unit_type ||
    null;

  const isTargetReachableForUnitType = useCallback((targetId: string, unitType: string | null | undefined) => {
    if (!unitType) return false;
    const targetRegion = gameState?.regions[targetId];
    if (!targetRegion) return false;

    const reachability = reachabilityByUnitType[unitType];
    if (!reachability) return false;

    return targetRegion.owner_id === myUserId
      ? reachability.moveTargets.has(targetId)
      : reachability.attackTargets.has(targetId);
  }, [gameState?.regions, myUserId, reachabilityByUnitType]);

  const highlightedNeighbors = useMemo(() => {
    if (!isSource || !selectedRegion || status !== "in_progress") return [];
    const sourceRegion = gameState?.regions?.[selectedRegion];
    if (!sourceRegion) return [];

    const candidateUnitTypes = selectedUnitTypeForAction
      ? [selectedUnitTypeForAction]
      : Object.keys(sourceRegion.units ?? {});
    const reachable = new Set<string>();

    for (const unitType of candidateUnitTypes) {
      const entry = reachabilityByUnitType[unitType];
      if (!entry) continue;
      entry.moveTargets.forEach((regionId) => reachable.add(regionId));
      entry.attackTargets.forEach((regionId) => reachable.add(regionId));
    }

    return Array.from(reachable);
  }, [gameState?.regions, isSource, reachabilityByUnitType, selectedRegion, selectedUnitTypeForAction, status]);

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

  const players = useMemo(() => gameState?.players || {}, [gameState?.players]);
  const regions = useMemo(() => gameState?.regions || {}, [gameState?.regions]);
  const currentTick = parseInt(gameState?.meta?.current_tick || "0", 10);
  const tickIntervalMs = parseInt(gameState?.meta?.tick_interval_ms || "1000", 10);

  // My stats
  const { myRegionCount, myUnitCount, myCurrency } = useMemo(() => {
    if (!gameState) return { myRegionCount: 0, myUnitCount: 0, myCurrency: 0 };
    let rc = 0;
    let uc = 0;
    for (const r of Object.values(gameState.regions)) {
      if (r.owner_id === myUserId) {
        rc++;
        uc += r.unit_count;
      }
    }
    return {
      myRegionCount: rc,
      myUnitCount: uc,
      myCurrency: gameState.players[myUserId]?.currency ?? 0,
    };
  }, [gameState, myUserId]);

  const rankedPlayers = useMemo(() => {
    // Single pass over regions to aggregate per-player stats: O(regions) instead of O(players * regions)
    const statsMap = new Map<string, { regionCount: number; unitCount: number }>();
    for (const region of Object.values(regions)) {
      if (!region.owner_id) continue;
      let stats = statsMap.get(region.owner_id);
      if (!stats) {
        stats = { regionCount: 0, unitCount: 0 };
        statsMap.set(region.owner_id, stats);
      }
      stats.regionCount++;
      stats.unitCount += intOrZero(region.unit_count);
    }
    return Object.values(players)
      .filter((player) => player.is_alive)
      .map((player) => {
        const stats = statsMap.get(player.user_id);
        return {
          user_id: player.user_id,
          username: player.username,
          color: player.color,
          regionCount: stats?.regionCount ?? 0,
          unitCount: stats?.unitCount ?? 0,
          isAlive: player.is_alive,
        };
      })
      .sort((left, right) =>
        Number(right.isAlive) - Number(left.isAlive) ||
        right.regionCount - left.regionCount ||
        right.unitCount - left.unitCount ||
        left.username.localeCompare(right.username)
      );
  }, [players, regions]);

  // ── Event-driven animations (visible to ALL clients) ───────
  //
  // Instead of triggering animations locally (only visible to the acting player),
  // we derive them from server events so every connected client sees the same
  // troop movements and attacks.

  useEffect(() => {
    if (events.length === 0) return;

    const eventKeys = events.map((event, index) => event.__eventKey || `${event.type}:${index}`);
    const lastProcessedKey = lastProcessedEventKeyRef.current;
    const startIndex =
      lastProcessedKey === null
        ? 0
        : Math.max(0, eventKeys.findIndex((key) => key === lastProcessedKey) + 1);
    const newEvents = events.slice(startIndex);
    const latestEventKey = eventKeys.at(-1) ?? null;
    if (latestEventKey) {
      lastProcessedEventKeyRef.current = latestEventKey;
    }
    if (newEvents.length === 0) return;

    const newAnims: TroopAnimation[] = [];
    for (const e of newEvents) {
      if (e.type === "troops_sent") {
        const eventKey = [
          e.action_type,
          e.player_id,
          e.source_region_id,
          e.target_region_id,
          e.unit_type,
          e.units,
        ].join(":");
        const localDispatchAt = localDispatchKeysRef.current.get(eventKey);
        if (
          e.player_id === myUserId &&
          localDispatchAt &&
          Date.now() - localDispatchAt < 3000
        ) {
          localDispatchKeysRef.current.delete(eventKey);
          continue;
        }
        const playerId = e.player_id as string;
        const color = gameStateRef.current?.players[playerId]?.color ?? "#3b82f6";
        const carrierCount = (e.units as number) || 0;
        const travelTicks = Math.max(1, (e.travel_ticks as number) || 1);
        const tickMs = parseInt(gameStateRef.current?.meta?.tick_interval_ms || "1000", 10);
        newAnims.push({
          id: crypto.randomUUID(),
          sourceId: e.source_region_id as string,
          targetId: e.target_region_id as string,
          color,
          units: getAnimationPower(unitsConfig, e.unit_type as string, carrierCount),
          unitType: (e.unit_type as string) || null,
          type: ((e.action_type as string) === "attack" ? "attack" : "move"),
          startTime: Date.now(),
          durationMs: travelTicks * tickMs,
        });
      } else if (e.type === "attack_success" || e.type === "attack_failed") {
        // Arrival/combat resolution only; travel animation is driven by troops_sent.
      } else if (e.type === "units_moved") {
        // Arrival event only; travel animation is driven by troops_sent.
      }
    }

    if (newAnims.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnimations((prev) => [...prev, ...newAnims]);
    }
  }, [events, myUserId, unitsConfig]);

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
        const sourceRegion = gameState?.regions[selectedRegion];
        const preferredUnitType = sourceRegion ? getPreferredReachableUnitType(regionId) : null;

        const effectiveUnitType = selectedActionUnitType || preferredUnitType;
        if (
          sourceRegion &&
          effectiveUnitType &&
          !isTargetReachableForUnitType(regionId, effectiveUnitType)
        ) {
          toast.error("Ten cel nie jest osiągalny dla wybranego typu jednostki");
          return;
        }

        if (!selectedActionUnitType && preferredUnitType) {
          setSelectedActionUnitType(preferredUnitType);
        }

        // Toggle target in/out of selection
        setActionTargets((prev) => {
          if (prev.includes(regionId)) {
            return prev.filter((id) => id !== regionId);
          }
          if (prev.length >= 3) {
            toast.error("Mozesz wybrac maksymalnie 3 cele");
            return prev;
          }
          return [...prev, regionId];
        });
        return;
      }

      // Click same region → deselect everything
      if (regionId === selectedRegion) {
        setSelectedRegion(null);
        setSelectedActionUnitType(null);
        setActionTargets([]);
        return;
      }

      // Select new region (switch source or info-only)
      setSelectedRegion(regionId);
      setSelectedActionUnitType(null);
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
      getPreferredReachableUnitType,
      isTargetReachableForUnitType,
      selectedActionUnitType,
    ]
  );

  // ── Action handlers ────────────────────────────────────────

  // Confirm from ActionBar
  const handleConfirmAction = useCallback(
    ({ allocations, unitType }: { allocations: { regionId: string; units: number }[]; unitType: string }) => {
      if (!selectedRegion || !gameState) return;
      const localAnims: TroopAnimation[] = [];
      const tickMs = parseInt(gameState.meta?.tick_interval_ms || "1000", 10);
      for (const { regionId, units } of allocations) {
        const target = gameState.regions[regionId];
        if (!target) continue;
        const reachability = reachabilityByUnitType[unitType];
        const isAttackTarget = target.owner_id !== myUserId;
        const distance = isAttackTarget
          ? (reachability?.attackDistanceByTarget.get(regionId) ?? null)
          : (reachability?.moveDistanceByTarget.get(regionId) ?? null);
        if (distance === null) {
          toast.error("Wybrany typ jednostki nie moze dosiegnac tego celu");
          continue;
        }
        const rules = unitConfigBySlug[unitType] ?? getUnitRules(unitsConfig, unitType);
        const travelTicks = Math.max(1, Math.ceil(Math.max(1, distance) / Math.max(1, rules.speed || 1)));
        const actionType = isAttackTarget ? "attack" : "move";
        const dispatchKey = [
          actionType,
          myUserId,
          selectedRegion,
          regionId,
          unitType,
          units,
        ].join(":");
        localDispatchKeysRef.current.set(dispatchKey, Date.now());
        localAnims.push({
          id: crypto.randomUUID(),
          sourceId: selectedRegion,
          targetId: regionId,
          color: gameState.players[myUserId]?.color ?? "#3b82f6",
          units: getAnimationPower(unitsConfig, unitType, units),
          unitType,
          type: actionType,
          startTime: Date.now(),
          durationMs: travelTicks * tickMs,
        });
        if (target.owner_id !== myUserId) {
          attack(selectedRegion, regionId, units, unitType);
        } else {
          move(selectedRegion, regionId, units, unitType);
        }
      }
      if (localAnims.length > 0) {
        setAnimations((prev) => [...prev, ...localAnims]);
      }
      setSelectedRegion(null);
      setSelectedActionUnitType(null);
      setActionTargets([]);
    },
    [selectedRegion, gameState, myUserId, attack, move, reachabilityByUnitType, unitConfigBySlug, unitsConfig]
  );

  const handleBuild = useCallback(
    (buildingType: string) => {
      if (selectedRegion) {
        build(selectedRegion, buildingType);
      }
    },
    [selectedRegion, build]
  );

  const handleProduceUnit = useCallback(
    (unitType: string) => {
      if (selectedRegion) {
        produceUnit(selectedRegion, unitType);
      }
    },
    [selectedRegion, produceUnit]
  );

  const handleSelectedActionUnitTypeChange = useCallback((unitType: string) => {
    setSelectedActionUnitType(unitType);
    setActionTargets((prev) => prev.filter((targetId) => isTargetReachableForUnitType(targetId, unitType)));
  }, [isTargetReachableForUnitType]);

  const handleMapReady = useCallback(() => setMapReady(true), []);

  const handleCancelAction = useCallback(() => {
    setSelectedRegion(null);
    setSelectedActionUnitType(null);
    setActionTargets([]);
  }, []);

  const handleRemoveTarget = useCallback((rid: string) => {
    setActionTargets((prev) => prev.filter((id) => id !== rid));
  }, []);

  const buildingsQueue = useMemo(() => gameState?.buildings_queue || [], [gameState?.buildings_queue]);
  const unitQueue = useMemo(() => gameState?.unit_queue || [], [gameState?.unit_queue]);

  // ── Music ───────────────────────────────────────────────────

  useEffect(() => {
    if (status === "in_progress" || status === "selecting") {
      startMusic();
    } else if (status === "finished") {
      stopMusic();
    }
  }, [status, startMusic, stopMusic]);

  // ── Events ─────────────────────────────────────────────────

  useEffect(() => {
    if (events.length === 0) return;

    const eventKeys = events.map((e, i) => e.__eventKey || `${e.type}:${i}`);
    const lastAudioKey = lastProcessedAudioKeyRef.current;
    const startIndex =
      lastAudioKey === null
        ? 0
        : Math.max(0, eventKeys.findIndex((k) => k === lastAudioKey) + 1);
    const newEvents = events.slice(startIndex);
    const latestKey = eventKeys.at(-1) ?? null;
    if (latestKey) lastProcessedAudioKeyRef.current = latestKey;
    if (newEvents.length === 0) return;

    for (const e of newEvents) {
      if (e.type === "game_over") {
        const winnerId = e.winner_id as string;
        const winner = gameState?.players[winnerId];
        if (winnerId === myUserId) {
          toast.success("Wygrales");
          playSound("popup");
        } else {
          toast.error(`Przegrales. Wygrywa: ${winner?.username || "?"}`);
          playSound("buzzer");
        }
      }
      if (e.type === "player_eliminated" && e.player_id === myUserId) {
        if (e.reason === "disconnect_timeout") {
          toast.error("Zostales usuniety z meczu przez brak powrotu na czas");
        } else if (e.reason === "left_match") {
          toast.error("Opuściłeś mecz");
        } else {
          toast.error("Twoja stolica zostala zdobyta");
        }
        playSound("buzzer");
      }
      if (e.type === "player_disconnected" && e.player_id !== myUserId) {
        const disconnectedPlayer = gameStateRef.current?.players[String(e.player_id)];
        const graceSeconds = Number(e.grace_seconds || 0);
        toast.warning(`${disconnectedPlayer?.username || "Gracz"} rozlaczyl sie. Limit powrotu: ${graceSeconds}s`);
      }
      if (e.type === "build_started" && e.player_id === myUserId) {
        playSound("build");
      }
      if (e.type === "troops_sent") {
        const unitType = e.unit_type as string | undefined;
        const actionType = e.action_type as string | undefined;
        const targetRegionId = e.target_region_id as string | undefined;
        const attackerId = e.player_id as string | undefined;

        if (unitType === "fighter") playSound("plane_start");
        else playSound("click2");

        // Incoming attack on my region
        if (
          actionType === "attack" &&
          attackerId !== myUserId &&
          targetRegionId &&
          gameStateRef.current?.regions[targetRegionId]?.owner_id === myUserId
        ) {
          const attackerName = gameStateRef.current?.players[attackerId ?? ""]?.username ?? "Wróg";
          const regionName = gameStateRef.current?.regions[targetRegionId]?.name ?? targetRegionId;
          playSound("alert");
          toast.warning(`⚔️ ${attackerName} atakuje ${regionName}!`, {
            duration: 5000,
          });
        }
      }
      if (e.type === "attack_success" && e.player_id !== myUserId) {
        const targetRegionId = e.target_region_id as string | undefined;
        // Region was mine before — lost
        if (targetRegionId && gameStateRef.current?.regions[targetRegionId]?.owner_id === myUserId) {
          playSound("missile_explosion");
        }
      }
      if (e.type === "action_rejected" && e.player_id === myUserId) {
        toast.error(String(e.message ?? "Akcja zostala odrzucona"));
        playSound("fail");
      }
      if (e.type === "server_error") {
        toast.error(e.message as string);
      }
    }
  }, [events, myUserId, gameState?.players, playSound]);

  // ── Render ─────────────────────────────────────────────────

  if (authLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  const visibleActionTargets = actionTargets.filter((regionId) => {
    if (!highlightedNeighbors.includes(regionId)) return false;
    return true;
  });
  const targets: TargetEntry[] = visibleActionTargets
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
  const capitalSelectionEndsAt = Number(gameState?.meta?.capital_selection_ends_at || 0);
  const capitalSelectionRemaining = status === "selecting" && capitalSelectionEndsAt > 0
    ? Math.max(0, capitalSelectionEndsAt - Math.floor(nowMs / 1000))
    : 0;
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#050b14]">
      <div className="pointer-events-none absolute inset-0 bg-[url('/assets/ui/hex_bg_tile.webp')] bg-[size:240px] opacity-[0.04]" />

      {status === "selecting" && (
        <div className="absolute left-1/2 top-2 z-20 -translate-x-1/2 sm:top-4">
          <div className="rounded-full border border-amber-300/20 bg-slate-950/88 px-4 py-2 text-center shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl">
            <div className="text-[10px] uppercase tracking-[0.18em] text-amber-200/70">
              Wybór stolicy
            </div>
            <div className="mt-0.5 flex items-center justify-center gap-2 text-sm text-zinc-100">
              <span>Wybierz region startowy</span>
              <span className="font-display text-amber-200">
                {capitalSelectionRemaining}s
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="absolute right-2 top-2 z-20 flex items-center gap-2 sm:right-4 sm:top-4">
        <button
          onClick={toggleMute}
          title={muted ? "Włącz dźwięk" : "Wycisz dźwięk"}
          className="rounded-full border border-white/10 bg-slate-950/84 p-2 text-slate-300 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <button
          onClick={() => router.push("/dashboard")}
          className="rounded-full border border-white/10 bg-slate-950/84 px-3 py-2 text-xs text-slate-200 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl transition-colors hover:bg-white/[0.08] sm:px-4"
        >
          Wyjdz
        </button>
        {status !== "finished" && (
          <button
            onClick={async () => {
              if (!window.confirm("Na pewno chcesz opuscic mecz calkowicie?")) return;
              const confirmed = await leaveMatch();
              if (!confirmed) {
                toast.error("Nie udalo sie potwierdzic opuszczenia meczu");
                return;
              }
              router.push("/dashboard");
            }}
            className="rounded-full border border-red-400/20 bg-red-950/70 px-3 py-2 text-xs text-red-100 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl transition-colors hover:bg-red-900/80 sm:px-4"
          >
            Opuść mecz
          </button>
        )}
      </div>

      {!connected && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="flex items-center gap-3 rounded-[24px] border border-white/10 bg-slate-950/88 px-6 py-4 backdrop-blur-xl">
            <Image
              src="/assets/common/world.webp"
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 object-contain"
            />
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Łączenie z serwerem...</span>
          </div>
        </div>
      )}

      {!mapReady && connected && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-zinc-950/90">
          <div className="flex flex-col items-center gap-3 rounded-[26px] border border-white/10 bg-slate-950/88 px-8 py-6 backdrop-blur-xl">
            <Image
              src="/assets/match_making/circle291.webp"
              alt=""
              width={52}
              height={52}
              className="h-12 w-12 animate-spin object-contain"
            />
            <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
            <span className="text-sm text-zinc-300">Ładowanie mapy...</span>
          </div>
        </div>
      )}

      {status === "finished" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
          <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/92 p-0 text-center shadow-[0_32px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl">
            <div className="relative h-36 w-full overflow-hidden">
              <Image
                src="/assets/match_gui/finish/g77116.webp"
                alt=""
                fill
                className="object-cover opacity-60"
              />
              <Image
                src="/assets/match_gui/finish/g86466.webp"
                alt=""
                fill
                className="object-cover opacity-40 mix-blend-screen"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Image
                  src="/assets/match_gui/finish/g208476.webp"
                  alt=""
                  width={80}
                  height={80}
                  className="h-20 w-20 object-contain drop-shadow-[0_0_24px_rgba(255,200,50,0.5)]"
                />
              </div>
            </div>
            <div className="px-10 py-6">
              <h2 className="mb-1 font-display text-4xl text-zinc-50">Koniec gry</h2>
              <p className="mb-6 text-sm text-slate-400">Rozgrywka zakończona</p>
              <button
                onClick={() => router.push("/dashboard")}
                className="rounded-full bg-cyan-500 px-8 py-2.5 font-medium text-slate-950 transition-colors hover:bg-cyan-400"
              >
                Wróć do lobby
              </button>
            </div>
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
        onMapReady={handleMapReady}
      />

      {/* HUD */}
      <GameHUD
        tick={currentTick}
        tickIntervalMs={tickIntervalMs}
        status={status}
        players={players}
        rankedPlayers={rankedPlayers}
        myUserId={myUserId}
        myRegionCount={myRegionCount}
        myUnitCount={myUnitCount}
        myCurrency={myCurrency}
      />

      {/* Build queue progress */}
      <BuildQueue
        queue={buildingsQueue}
        unitQueue={unitQueue}
        buildings={buildings}
        units={unitsConfig}
        myUserId={myUserId}
      />

      {/* Action Bar (multi-target) */}
      {sourceRegionData && selectedRegion && isSource && (visibleActionTargets.length > 0 || Boolean(selectedUnitTypeForAction)) && (
        <ActionBar
          key={`${selectedRegion}:${selectedUnitTypeForAction ?? sourceRegionData.unit_type ?? "infantry"}`}
          sourceRegion={sourceRegionData}
          sourceName={sourceRegionData.name}
          targets={targets}
          selectedUnitType={selectedUnitTypeForAction ?? sourceRegionData.unit_type ?? "infantry"}
          selectedUnitScale={
            unitsConfig.find((unit) => unit.slug === (selectedUnitTypeForAction ?? sourceRegionData.unit_type ?? "infantry"))?.manpower_cost ?? 1
          }
          onSelectedUnitTypeChange={handleSelectedActionUnitTypeChange}
          onConfirm={handleConfirmAction}
          onRemoveTarget={handleRemoveTarget}
          onCancel={handleCancelAction}
        />
      )}

      {/* Region panel (info + panel-based actions) */}
      {sourceRegionData && selectedRegion && actionTargets.length === 0 && (
        <div className="hidden sm:block">
          <RegionPanel
            regionId={selectedRegion}
            region={sourceRegionData}
            players={players}
            myUserId={myUserId}
            myCurrency={myCurrency}
            buildings={buildings}
            buildingQueue={buildingsQueue}
            units={unitsConfig}
            onBuild={handleBuild}
            onProduceUnit={handleProduceUnit}
            onClose={handleCancelAction}
          />
        </div>
      )}
    </div>
  );
}
