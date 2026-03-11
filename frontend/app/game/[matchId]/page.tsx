"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, use } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/hooks/useAuth";
import { useGameSocket } from "@/hooks/useGameSocket";
import {
  getRegionsGraph,
  getRegionTilesUrl,
  getConfig,
  type RegionGraphEntry,
  type BuildingType,
  type UnitType,
} from "@/lib/api";
import { getBuildingAsset, getUnitAsset } from "@/lib/gameAssets";
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
import type { GameRegion } from "@/hooks/useGameSocket";

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

function getSeaDistanceScore(sourceRegion: GameRegion, targetId: string) {
  for (const band of sourceRegion.sea_distances ?? []) {
    if ((band.provinces ?? []).includes(targetId)) {
      return Math.max(0, band.r || 0);
    }
  }
  return null;
}

function getReachableRegionIds(
  sourceId: string,
  regions: Record<string, GameRegion>,
  neighborMap: Record<string, string[]>,
  centroids: Record<string, [number, number]>,
  movementType: string,
  seaRange: number,
  maxDepth: number,
  canVisit: (regionId: string) => boolean
) {
  if (movementType === "sea") {
    const sourceRegion = regions[sourceId];
    if (!sourceRegion?.is_coastal) return [];
    const reachable = new Set<string>();
    for (const [candidateId, candidate] of Object.entries(regions)) {
      if (candidateId === sourceId || !candidate?.is_coastal || !canVisit(candidateId)) continue;
      const score = getSeaDistanceScore(sourceRegion, candidateId);
      if (score !== null && score <= seaRange) {
        reachable.add(candidateId);
      }
    }
    return Array.from(reachable);
  }

  const visited = new Set([sourceId]);
  const queue: Array<{ regionId: string; depth: number }> = [{ regionId: sourceId, depth: 0 }];
  const reachable = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    for (const neighborId of neighborMap[current.regionId] || []) {
      if (visited.has(neighborId) || !(neighborId in regions) || !canVisit(neighborId)) {
        continue;
      }
      visited.add(neighborId);
      reachable.add(neighborId);
      queue.push({ regionId: neighborId, depth: current.depth + 1 });
    }
  }

  return Array.from(reachable);
}

function getTravelDistance(
  sourceId: string,
  targetId: string,
  regions: Record<string, GameRegion>,
  neighborMap: Record<string, string[]>,
  centroids: Record<string, [number, number]>,
  movementType: string,
  seaRange: number,
  maxDepth: number,
  canVisit: (regionId: string) => boolean
) {
  if (movementType === "sea") {
    const sourceRegion = regions[sourceId];
    if (!sourceRegion?.is_coastal) return null;
    const score = getSeaDistanceScore(sourceRegion, targetId);
    if (score === null || score > seaRange || !canVisit(targetId)) return null;
    return Math.max(1, Math.ceil(score / 20));
  }

  const visited = new Set([sourceId]);
  const queue: Array<{ regionId: string; depth: number }> = [{ regionId: sourceId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.regionId === targetId) return current.depth;
    if (current.depth >= maxDepth) continue;

    for (const neighborId of neighborMap[current.regionId] || []) {
      const region = regions[neighborId];
      if (!region || visited.has(neighborId) || !canVisit(neighborId)) continue;
      visited.add(neighborId);
      queue.push({ regionId: neighborId, depth: current.depth + 1 });
    }
  }

  return null;
}

function getPreferredUnitTypeForTarget(params: {
  sourceId: string;
  targetId: string;
  sourceRegion: GameRegion;
  regions: Record<string, GameRegion>;
  neighborMap: Record<string, string[]>;
  centroids: Record<string, [number, number]>;
  unitsConfig: UnitType[];
  myUserId: string;
}) {
  const {
    sourceId,
    targetId,
    sourceRegion,
    regions,
    neighborMap,
    centroids,
    unitsConfig,
    myUserId,
  } = params;

  const targetRegion = regions[targetId];
  if (!targetRegion) return null;

  const availableUnitTypes = Object.entries(sourceRegion.units ?? {})
    .filter(([, count]) => count > 0)
    .map(([unitType]) => unitType);
  if (availableUnitTypes.length === 0) return null;

  const isFriendlyTarget = targetRegion.owner_id === myUserId;
  const reachableTypes = availableUnitTypes.filter((unitType) => {
    const rules = getUnitRules(unitsConfig, unitType);
    const movementType = rules.movement_type;
    const seaRange = Math.max(0, rules.sea_range || 0);
    const maxDepth = Math.max(1, isFriendlyTarget ? rules.speed || 1 : rules.attack_range || 1);
    const reachable = getReachableRegionIds(
      sourceId,
      regions,
      neighborMap,
      centroids,
      movementType,
      seaRange,
      maxDepth,
      (regionId) => {
        const region = regions[regionId];
        if (!region) return false;
        if (movementType === "sea" && !region.is_coastal) return false;
        return isFriendlyTarget ? region.owner_id === myUserId : true;
      }
    );
    return reachable.includes(targetId);
  });

  if (reachableTypes.length === 0) return null;
  if (reachableTypes.includes("infantry")) return "infantry";

  return reachableTypes.sort((left, right) => {
    const leftOrder = unitsConfig.find((unit) => unit.slug === left)?.order ?? 9999;
    const rightOrder = unitsConfig.find((unit) => unit.slug === right)?.order ?? 9999;
    return leftOrder - rightOrder;
  })[0];
}

function isTargetReachableByUnitType(params: {
  sourceId: string;
  targetId: string;
  sourceRegion: GameRegion;
  regions: Record<string, GameRegion>;
  neighborMap: Record<string, string[]>;
  centroids: Record<string, [number, number]>;
  unitsConfig: UnitType[];
  myUserId: string;
  unitType: string;
}) {
  const {
    sourceId,
    targetId,
    sourceRegion,
    regions,
    neighborMap,
    centroids,
    unitsConfig,
    myUserId,
    unitType,
  } = params;

  if ((sourceRegion.units?.[unitType] ?? 0) < 1) return false;

  const targetRegion = regions[targetId];
  if (!targetRegion) return false;

  const rules = getUnitRules(unitsConfig, unitType);
  const movementType = rules.movement_type;
  const seaRange = Math.max(0, rules.sea_range || 0);
  const isFriendlyTarget = targetRegion.owner_id === myUserId;
  const maxDepth = Math.max(1, isFriendlyTarget ? rules.speed || 1 : rules.attack_range || 1);
  const reachable = getReachableRegionIds(
    sourceId,
    regions,
    neighborMap,
    centroids,
    movementType,
    seaRange,
    maxDepth,
    (regionId) => {
      const region = regions[regionId];
      if (!region) return false;
      if (movementType === "sea" && !region.is_coastal) return false;
      return isFriendlyTarget ? region.owner_id === myUserId : true;
    }
  );

  return reachable.includes(targetId);
}

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
  } = useGameSocket(matchId);

  const [regionGraph, setRegionGraph] = useState<RegionGraphEntry[]>([]);
  const [buildings, setBuildings] = useState<BuildingType[]>([]);
  const [unitsConfig, setUnitsConfig] = useState<UnitType[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selectedActionUnitType, setSelectedActionUnitType] = useState<string | null>(null);
  const [actionTargets, setActionTargets] = useState<string[]>([]);
  const [animations, setAnimations] = useState<TroopAnimation[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));
  const myUserId = user?.id || "";
  const status = gameState?.meta?.status || "loading";

  // Keep a ref to gameState so event-driven animation effect can read latest players/colors
  const gameStateRef = useRef(gameState);
  useLayoutEffect(() => { gameStateRef.current = gameState; });

  // Track the last processed event batch so animation derivation survives event list trimming.
  const lastProcessedEventKeyRef = useRef<string | null>(null);
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
    const interval = setInterval(() => {
      setNowTs(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
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

  // Guard against double capital selection while waiting for server confirmation
  const hasSelectedCapital = !!gameState?.players[myUserId]?.capital_region_id;

  // ── Derived state ──────────────────────────────────────────

  const sourceRegionData = selectedRegion
    ? gameState?.regions[selectedRegion]
    : null;
  const availableSourceUnitTypes = Object.entries(sourceRegionData?.units ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const selectedUnitTypeForAction =
    (selectedActionUnitType &&
    availableSourceUnitTypes.some(([unitType]) => unitType === selectedActionUnitType)
      ? selectedActionUnitType
      : null) ||
    availableSourceUnitTypes[0]?.[0] ||
    sourceRegionData?.unit_type ||
    null;

  const isSource =
    !!sourceRegionData &&
    sourceRegionData.owner_id === myUserId &&
    sourceRegionData.unit_count > 0;

  const highlightedNeighbors = useMemo(() => {
    if (!isSource || !selectedRegion || status !== "in_progress") return [];
    const mapRegions = gameState?.regions || {};
    const sourceRegion = mapRegions[selectedRegion];
    if (!sourceRegion) return [];

    const candidateUnitTypes = selectedActionUnitType
      ? [selectedActionUnitType]
      : Object.keys(sourceRegion.units ?? {});
    const reachable = new Set<string>();

    for (const unitType of candidateUnitTypes) {
      if ((sourceRegion.units?.[unitType] ?? 0) < 1) continue;
      const rules = getUnitRules(unitsConfig, unitType);
      const movementType = rules.movement_type;
      const seaRange = Math.max(0, rules.sea_range || 0);
      const moveRange = Math.max(1, rules.speed || 1);
      const attackRange = Math.max(1, rules.attack_range || 1);

      const moveTargets = getReachableRegionIds(
        selectedRegion,
        mapRegions,
        neighborMap,
        centroids,
        movementType,
        seaRange,
        moveRange,
        (regionId) => {
          const region = mapRegions[regionId];
          if (!region) return false;
          if (movementType === "sea" && !region.is_coastal) return false;
          return region.owner_id === myUserId;
        }
      );

      const attackTargets = getReachableRegionIds(
        selectedRegion,
        mapRegions,
        neighborMap,
        centroids,
        movementType,
        seaRange,
        attackRange,
        (regionId) => {
          const region = mapRegions[regionId];
          if (!region) return false;
          if (movementType === "sea" && !region.is_coastal) return false;
          return true;
        }
      ).filter((regionId) => mapRegions[regionId]?.owner_id !== myUserId);

      [...moveTargets, ...attackTargets].forEach((regionId) => reachable.add(regionId));
    }

    return Array.from(reachable);
  }, [centroids, selectedActionUnitType, gameState?.regions, isSource, myUserId, neighborMap, selectedRegion, status, unitsConfig]);

  // Per-map minimum distance between capitals (comes from MapConfig → settings_snapshot → Redis meta)
  const MIN_CAPITAL_DISTANCE = parseInt(
    gameState?.meta?.min_capital_distance || "3",
    10
  );
  const capitalSelectionEndsAt = parseInt(
    gameState?.meta?.capital_selection_ends_at || "0",
    10
  );
  const capitalSelectionSecondsLeft = Math.max(0, capitalSelectionEndsAt - nowTs);

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

  // ── Event-driven animations (visible to ALL clients) ───────
  //
  // Instead of triggering animations locally (only visible to the acting player),
  // we derive them from server events so every connected client sees the same
  // troop movements and attacks.

  useEffect(() => {
    if (events.length === 0) return;

    const eventKeys = events.map((event, index) => JSON.stringify([event.type, event, index]));
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
        const preferredUnitType =
          sourceRegion
            ? getPreferredUnitTypeForTarget({
                sourceId: selectedRegion,
                targetId: regionId,
                sourceRegion,
                regions: gameState?.regions || {},
                neighborMap,
                centroids,
                unitsConfig,
                myUserId,
              })
            : null;

        const effectiveUnitType = selectedActionUnitType || preferredUnitType;
        if (
          sourceRegion &&
          effectiveUnitType &&
          !isTargetReachableByUnitType({
            sourceId: selectedRegion,
            targetId: regionId,
            sourceRegion,
            regions: gameState?.regions || {},
            neighborMap,
            centroids,
            unitsConfig,
            myUserId,
            unitType: effectiveUnitType,
          })
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
      neighborMap,
      centroids,
      unitsConfig,
      myUserId,
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
        const sourceRegion = gameState.regions[selectedRegion];
        if (!target || !sourceRegion) continue;
        if (
          !isTargetReachableByUnitType({
            sourceId: selectedRegion,
            targetId: regionId,
            sourceRegion,
            regions: gameState.regions,
            neighborMap,
            centroids,
            unitsConfig,
            myUserId,
            unitType,
          })
        ) {
          toast.error("Wybrany typ jednostki nie moze dosiegnac tego celu");
          continue;
        }
        const rules = getUnitRules(unitsConfig, unitType);
        const maxDepth =
          target.owner_id !== myUserId
            ? Math.max(1, rules.attack_range || 1)
            : Math.max(1, rules.speed || 1);
        const seaRange = Math.max(0, rules.sea_range || 0);
        const distance = getTravelDistance(
          selectedRegion,
          regionId,
          gameState.regions,
          neighborMap,
          centroids,
          rules.movement_type,
          seaRange,
          maxDepth,
          (candidateRegionId) => {
            const candidate = gameState.regions[candidateRegionId];
            if (!candidate) return false;
            return target.owner_id !== myUserId ? true : candidate.owner_id === myUserId;
          }
        );
        const travelTicks = Math.max(
          1,
          Math.ceil((Math.max(1, distance ?? 1)) / Math.max(1, rules.speed || 1))
        );
        const actionType = target.owner_id !== myUserId ? "attack" : "move";
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
    [selectedRegion, gameState, myUserId, attack, move, neighborMap, centroids, unitsConfig]
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

  // ── Events ─────────────────────────────────────────────────

  useEffect(() => {
    if (events.length === 0) return;
    const last = events[events.length - 1];
    if (last.type === "game_over") {
      const winnerId = last.winner_id as string;
      const winner = gameState?.players[winnerId];
      if (winnerId === myUserId) {
        toast.success("Wygrales");
      } else {
        toast.error(`Przegrales. Wygrywa: ${winner?.username || "?"}`);
      }
    }
    if (last.type === "player_eliminated" && last.player_id === myUserId) {
      toast.error("Twoja stolica zostala zdobyta");
    }
    if (last.type === "action_rejected" && last.player_id === myUserId) {
      toast.error(String(last.message ?? "Akcja zostala odrzucona"));
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
  const tickIntervalMs = parseInt(gameState?.meta?.tick_interval_ms || "1000", 10);

  const visibleActionTargets = actionTargets.filter((regionId) => {
    if (!highlightedNeighbors.includes(regionId)) return false;
    if (!selectedRegion || !sourceRegionData || !selectedUnitTypeForAction) return true;
    return isTargetReachableByUnitType({
      sourceId: selectedRegion,
      targetId: regionId,
      sourceRegion: sourceRegionData,
      regions,
      neighborMap,
      centroids,
      unitsConfig,
      myUserId,
      unitType: selectedUnitTypeForAction,
    });
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
  const selectedOwner =
    sourceRegionData?.owner_id ? players[sourceRegionData.owner_id] : null;
  const intelLabel =
    status === "selecting"
      ? "Wybierz bezpieczna stolice z dala od innych graczy."
      : selectedRegion && sourceRegionData
        ? isSource
          ? "Region aktywny. Szczegoly akcji i rozdzial wojsk sa w dolnym action panelu."
          : "Region podgladowy. Sprawdz wlasciciela, obrone i budynki."
        : "Kliknij region, aby zobaczyc jego stan i mozliwe akcje.";
  const topBarMessage =
    status === "selecting"
      ? "Wybierz stolice"
      : status === "finished"
        ? "Rozgrywka zakonczona"
        : visibleActionTargets.length > 0
          ? `Gotowe cele: ${visibleActionTargets.length}`
          : selectedRegion
            ? sourceRegionData?.name ?? "Wybrany region"
            : "Brak aktywnego wyboru";

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#050b14]">
      <div className="pointer-events-none absolute inset-0 bg-[url('/assets/ui/hex_bg_tile.webp')] bg-[size:240px] opacity-[0.04]" />

      <div className="absolute left-4 right-4 top-4 z-20">
        <div className="mx-auto flex max-w-[980px] items-center justify-between gap-4 rounded-[26px] border border-white/10 bg-slate-950/82 px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-2">
              <Image
                src="/assets/common/world.webp"
                alt="MapLord"
                width={22}
                height={22}
                className="h-[22px] w-[22px] object-contain"
              />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                Battle Navbar
              </div>
              <div className="truncate font-display text-xl text-zinc-50">
                {topBarMessage}
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2">
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                Match
              </div>
              <div className="font-display text-lg text-cyan-200">
                {matchId.slice(0, 8)}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2">
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                Gracz
              </div>
              <div className="font-display text-lg text-zinc-50">
                {user.username}
              </div>
            </div>
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-white/[0.08]"
            >
              Wyjdz do lobby
            </button>
          </div>
        </div>
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

      {mapReady && status === "selecting" && (
        <div className="absolute left-1/2 top-[92px] z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-yellow-300/20 bg-slate-950/82 px-5 py-3 text-center text-sm font-medium text-yellow-200 backdrop-blur-xl">
          <Image
            src="/assets/units/capital_star.png"
            alt=""
            width={22}
            height={22}
            className="h-[22px] w-[22px] object-contain"
          />
          <span>
            Wszyscy gracze wybieraja stolice rownoczesnie. Kliknij swoj region.
          </span>
          <span className="rounded-full border border-yellow-300/20 bg-yellow-300/10 px-3 py-1 font-display text-base text-yellow-100">
            {capitalSelectionSecondsLeft}s
          </span>
        </div>
      )}

      {mapReady && status === "in_progress" && !selectedRegion && (
        <div className="absolute left-1/2 top-[92px] z-20 -translate-x-1/2 rounded-full border border-white/10 bg-slate-950/82 px-4 py-2 text-sm text-zinc-300 backdrop-blur-xl">
          Kliknij swój region, aby wybrać źródło
        </div>
      )}

      {mapReady && status === "in_progress" && isSource && actionTargets.length === 0 && (
        <div className="absolute left-1/2 top-[92px] z-20 -translate-x-1/2 rounded-full border border-cyan-300/15 bg-slate-950/82 px-4 py-2 text-sm text-cyan-200 backdrop-blur-xl">
          {availableSourceUnitTypes.length > 1
            ? "Mapa pokazuje zasieg wszystkich typow jednostek. Dokladny typ wybierzesz w action barze."
            : "Kliknij region w zasiegu, aby zaatakować lub przenieść jednostki"}
        </div>
      )}

      {mapReady && !(sourceRegionData && selectedRegion && actionTargets.length === 0) && (
        <div className="absolute right-4 top-[104px] z-20 hidden w-[340px] overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/82 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl lg:block">
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
            <Image
              src="/assets/units/cursor.webp"
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 object-contain"
            />
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                Map Intel
              </p>
              <h3 className="font-display text-xl text-zinc-50">Stan planszy</h3>
            </div>
          </div>
          <div className="space-y-3 px-4 py-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-300">
              {intelLabel}
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                  Stolice
                </div>
                <div className="mt-2 font-display text-2xl text-amber-200">
                  {Object.values(regions).filter((region) => region.is_capital).length}
                </div>
              </div>
            </div>

            {selectedRegion && sourceRegionData ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="mb-3 flex items-center gap-3">
                  <div
                    className="h-3 w-3 rounded-full ring-2 ring-white/10"
                    style={{ backgroundColor: selectedOwner?.color ?? "#64748b" }}
                  />
                  <div className="min-w-0">
                    <div className="truncate font-display text-lg text-zinc-50">
                      {sourceRegionData.name}
                    </div>
                    <div className="text-xs text-slate-400">
                      {selectedOwner?.username ?? "Region neutralny"}
                    </div>
                  </div>
                </div>
                <div className="grid gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="min-w-0 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2.5">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                        Jednostki
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-2 font-display text-lg text-zinc-50">
                        <Image
                          src={getUnitAsset(selectedUnitTypeForAction ?? sourceRegionData.unit_type ?? "default")}
                          alt=""
                          width={16}
                          height={16}
                          className="h-4 w-4 object-contain"
                        />
                        <span className="truncate">{isSource ? sourceRegionData.unit_count : "?"}</span>
                      </div>
                    </div>
                    <div className="min-w-0 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2.5">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                        Obrona
                      </div>
                      <div className="mt-1 font-display text-lg text-emerald-300">
                        {Math.round(sourceRegionData.defense_bonus * 100)}%
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      Infrastruktura
                    </div>
                    <div className="mt-2 flex min-w-0 items-center gap-2 text-amber-200">
                      {getBuildingAsset(sourceRegionData.building_type) && (
                        <Image
                          src={getBuildingAsset(sourceRegionData.building_type)!}
                          alt=""
                          width={16}
                          height={16}
                          className="h-4 w-4 shrink-0 object-contain"
                        />
                      )}
                      <span className="truncate font-display text-sm">
                        {sourceRegionData.building_type ?? "Brak"}
                      </span>
                    </div>
                  </div>

                  {Object.entries(sourceRegionData.buildings ?? {}).filter(([, count]) => count > 0).length > 0 && (
                    <div className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2.5">
                      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                        Budynki w regionie
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(sourceRegionData.buildings ?? {})
                          .filter(([, count]) => count > 0)
                          .map(([slug, count]) => (
                            <span
                              key={slug}
                              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-200"
                            >
                              {getBuildingAsset(slug) && (
                                <Image
                                  src={getBuildingAsset(slug)!}
                                  alt=""
                                  width={14}
                                  height={14}
                                  className="h-3.5 w-3.5 shrink-0 object-contain"
                                />
                              )}
                              <span className="truncate">{slug}</span>
                              <span className="text-zinc-500">x{count}</span>
                            </span>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-3 text-sm text-slate-500">
                Brak aktywnego regionu. Kliknij na mape, aby odczytac dane prowincji.
              </div>
            )}
          </div>
        </div>
      )}

      {status === "finished" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="rounded-[28px] border border-white/10 bg-slate-950/90 p-8 text-center backdrop-blur-xl">
            <Image
              src="/assets/notifications/shop_new_special_offer.webp"
              alt=""
              width={72}
              height={72}
              className="mx-auto mb-4 h-[72px] w-[72px] rounded-2xl object-cover"
            />
            <h2 className="mb-4 font-display text-3xl text-zinc-50">Koniec gry</h2>
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-full bg-cyan-500 px-6 py-2 font-medium text-slate-950 hover:bg-cyan-400"
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
        tickIntervalMs={tickIntervalMs}
        status={status}
        players={players}
        events={events}
        myUserId={myUserId}
        myRegionCount={myRegionCount}
        myUnitCount={myUnitCount}
        myCurrency={myCurrency}
      />

      {/* Build queue progress */}
      <BuildQueue
        queue={gameState?.buildings_queue || []}
        unitQueue={gameState?.unit_queue || []}
        buildings={buildings}
        units={unitsConfig}
        myUserId={myUserId}
      />

      {/* Action Bar (multi-target) */}
      {visibleActionTargets.length > 0 && sourceRegionData && selectedRegion && (
        <ActionBar
          sourceRegion={sourceRegionData}
          sourceName={sourceRegionData.name}
          targets={targets}
          selectedUnitType={selectedUnitTypeForAction ?? sourceRegionData.unit_type ?? "infantry"}
          selectedUnitScale={
            unitsConfig.find((unit) => unit.slug === (selectedUnitTypeForAction ?? sourceRegionData.unit_type ?? "infantry"))?.manpower_cost ?? 1
          }
          onSelectedUnitTypeChange={setSelectedActionUnitType}
          onConfirm={handleConfirmAction}
          onRemoveTarget={(rid) =>
            setActionTargets((prev) => prev.filter((id) => id !== rid))
          }
          onCancel={() => {
            setSelectedRegion(null);
            setSelectedActionUnitType(null);
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
          myCurrency={myCurrency}
          buildings={buildings}
          buildingQueue={gameState?.buildings_queue || []}
          units={unitsConfig}
          onBuild={handleBuild}
          onProduceUnit={handleProduceUnit}
          onClose={() => {
            setSelectedRegion(null);
            setSelectedActionUnitType(null);
            setActionTargets([]);
          }}
        />
      )}
    </div>
  );
}
