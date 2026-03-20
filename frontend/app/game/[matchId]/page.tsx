"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, use } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/hooks/useAuth";
import { useGameSocket } from "@/hooks/useGameSocket";
import { useAudio, MUSIC_TRACKS } from "@/hooks/useAudio";
import {
  getRegionsGraph,
  getConfig,
  type RegionGraphEntry,
  type BuildingType,
  type UnitType,
  type AbilityType,
} from "@/lib/api";
import { loadAssetOverrides } from "@/lib/assetOverrides";
import { getSeaTravelRange, getTravelDistance } from "@/lib/gameTravel.js";
import dynamic from "next/dynamic";
import type { TroopAnimation } from "@/lib/gameTypes";
import { getEliminationVfx, getVictoryVfx } from "@/lib/animationConfig";
import { useShapesData } from "@/hooks/useShapesData";
const ANIMATION_DURATION_MS = 2200;
const GameCanvas = dynamic(() => import("@/components/map/GameCanvas"), { ssr: false });
import GameHUD from "@/components/game/GameHUD";
import QuickActionBar from "@/components/game/QuickActionBar";
import BuildQueue from "@/components/game/BuildQueue";
import MobileBuildSheet from "@/components/game/MobileBuildSheet";
import AbilityBar from "@/components/game/AbilityBar";
import { Loader2 } from "lucide-react";
import MatchIntroOverlay from "@/components/game/MatchIntroOverlay";
import { toast } from "sonner";
import { useTutorial } from "@/hooks/useTutorial";
import TutorialOverlay from "@/components/game/TutorialOverlay";
import MatchChatPanel from "@/components/chat/MatchChatPanel";
import VoicePanel from "@/components/chat/VoicePanel";
import DesktopChatVoice from "@/components/game/DesktopChatVoice";
import WeatherIndicator from "@/components/game/WeatherIndicator";
import { useVoiceChat } from "@/hooks/useVoiceChat";

const BOOST_EFFECT_LABELS: Record<string, string> = {
  unit_bonus: "Mobilizacja (+jednostki)",
  defense_bonus: "Fortyfikacja (+obrona)",
  energy_bonus: "Ekonomia (+energia)",
  attack_bonus: "Blitzkrieg (+atak)",
};

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
      combat_target: "ground",
      ticks_per_hop: 0,
      air_speed_ticks_per_hop: 0,
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

function getAvailableUnits(
  units: Record<string, number> | undefined,
  unitType: string,
  unitConfigBySlug: Record<string, { manpower_cost?: number }>
): number {
  const raw = units?.[unitType] ?? 0;
  if (unitType !== "infantry") return raw;
  // Subtract infantry reserved as crew for embarked units (tanks, etc.)
  const reserved = Object.entries(units ?? {})
    .filter(([type]) => type !== "infantry")
    .reduce((sum, [type, count]) => {
      const scale = Math.max(1, unitConfigBySlug[type]?.manpower_cost ?? 1);
      return sum + count * scale;
    }, 0);
  return Math.max(0, raw - reserved);
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
    matchChatMessages,
    voiceToken,
    voiceUrl,
    bannedReason,
    ping,
    selectCapital,
    attack,
    move,
    bombard,
    interceptFlight,
    build,
    produceUnit,
    useAbility: castAbility,
    leaveMatch,
    send,
    sendChat,
  } = useGameSocket(matchId);

  // Expose combat actions for UI components
  void bombard;
  void interceptFlight;

  const voice = useVoiceChat();
  const effectiveVoiceUrl =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_LIVEKIT_URL) || voiceUrl;

  const handleVoiceJoin = useCallback(async () => {
    if (!effectiveVoiceUrl || !voiceToken) return;
    try { await voice.join(effectiveVoiceUrl, voiceToken); } catch (e) { console.error("Voice join failed:", e); }
  }, [voice, effectiveVoiceUrl, voiceToken]);

  const speakingPlayerIds = useMemo(() => {
    const ids: string[] = [];
    if (voice.isSpeaking) ids.push(user?.id ?? "");
    for (const peer of voice.peers) {
      if (peer.isSpeaking) ids.push(peer.identity);
    }
    return ids;
  }, [voice.isSpeaking, voice.peers, user?.id]);

  const { startMusic, stopMusic, playSound, toggleMute, muted, currentTrackIndex, selectTrack } = useAudio();
  const [musicPickerOpen, setMusicPickerOpen] = useState(false);

  const [regionGraph, setRegionGraph] = useState<RegionGraphEntry[]>([]);
  const { shapesData } = useShapesData(matchId);
  const [buildings, setBuildings] = useState<BuildingType[]>([]);
  const [unitsConfig, setUnitsConfig] = useState<UnitType[]>([]);
  const [abilitiesConfig, setAbilitiesConfig] = useState<AbilityType[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selectedActionUnitType, setSelectedActionUnitType] = useState<string | null>(null);
  const [unitPercent, setUnitPercent] = useState<number>(100);
  const [selectedAbility, setSelectedAbility] = useState<string | null>(null);
  const [animations, setAnimations] = useState<TroopAnimation[]>([]);
  const [nukeBlackout, setNukeBlackout] = useState<Array<{ rid: string; startTime: number }>>([]);
  const [mapReady, setMapReady] = useState(false);

  // Listen for air transit animations from GameCanvas (dispatched via custom event).
  useEffect(() => {
    const handler = (e: Event) => {
      const anims = (e as CustomEvent<TroopAnimation[]>).detail;
      if (anims.length > 0) {
        setAnimations((prev) => [...prev, ...anims]);
      }
    };
    window.addEventListener("air-transit-anims", handler);
    return () => window.removeEventListener("air-transit-anims", handler);
  }, []);
  const mapReadyRef = useRef(false);
  const [showIntro, setShowIntro] = useState(true);
  const showIntroRef = useRef(true);
  const handleIntroComplete = useCallback(() => {
    showIntroRef.current = false;
    setShowIntro(false);
    // Signal to gateway that this player is ready
    send({ action: "player_ready" });
  }, [send]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [gameEndCountdown, setGameEndCountdown] = useState(10);
  const [fps, setFps] = useState(0);
  const myUserId = user?.id || "";
  const status = gameState?.meta?.status || "loading";

  // Tutorial
  const isTutorial = gameState?.meta?.is_tutorial === "1";
  const tutorial = useTutorial(gameState, user?.id, isTutorial, send);

  // Keep a ref to gameState so event-driven animation effect can read latest players/colors
  const gameStateRef = useRef(gameState);
  useLayoutEffect(() => { gameStateRef.current = gameState; });

  // Track processed events by their unique keys (survives ring-buffer trimming).
  const processedAnimKeysRef = useRef(new Set<string>());
  const processedAudioKeysRef = useRef(new Set<string>());
  const localDispatchKeysRef = useRef(new Map<string, number>());

  // FPS counter via requestAnimationFrame
  useEffect(() => {
    let frameCount = 0;
    let lastTime = performance.now();
    let rafId: number;
    const measure = () => {
      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setFps(frameCount);
        frameCount = 0;
        lastTime = now;
      }
      rafId = requestAnimationFrame(measure);
    };
    rafId = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [user, authLoading, router]);

  // Redirect if account is banned via WebSocket close code 4003
  useEffect(() => {
    if (bannedReason) {
      router.replace("/login?banned=1");
    }
  }, [bannedReason, router]);

  // Load geo graph filtered to this match's map config, plus global config
  useEffect(() => {
    getRegionsGraph(matchId).then(setRegionGraph).catch(console.error);
    Promise.all([getConfig(), loadAssetOverrides()])
      .then(([cfg]) => {
        setBuildings(cfg.buildings);
        setUnitsConfig(cfg.units);
        setAbilitiesConfig(cfg.abilities || []);
      })
      .catch(console.error);
  }, [matchId]);

  // Prune finished animations + nuke blackout — only run when there are items to prune
  const pruneTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const hasItems = animations.length > 0 || nukeBlackout.length > 0;
    if (hasItems && !pruneTimerRef.current) {
      const NUKE_BLACKOUT_DURATION = 3000;
      pruneTimerRef.current = setInterval(() => {
        const now = Date.now();
        setAnimations((prev) => {
          if (prev.length === 0) return prev;
          const active = prev.filter((a) => {
            const maxDur = a.unitType === "nuke_rocket" ? (a.durationMs || 8000) + 2000 : ANIMATION_DURATION_MS + 500;
            return now - a.startTime < maxDur;
          });
          return active.length !== prev.length ? active : prev;
        });
        setNukeBlackout((prev) => {
          if (prev.length === 0) return prev;
          const active = prev.filter((b) => now - b.startTime < NUKE_BLACKOUT_DURATION);
          return active.length !== prev.length ? active : prev;
        });
      }, 500);
    } else if (!hasItems && pruneTimerRef.current) {
      clearInterval(pruneTimerRef.current);
      pruneTimerRef.current = null;
    }
    return () => {
      if (pruneTimerRef.current) {
        clearInterval(pruneTimerRef.current);
        pruneTimerRef.current = null;
      }
    };
  }, [animations.length > 0, nukeBlackout.length > 0]);

  useEffect(() => {
    if (status !== "selecting") return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  // Build neighbor lookup and centroid map from the lightweight graph
  const neighborMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const entry of regionGraph) {
      map[entry.id] = entry.neighbor_ids;
    }
    return map;
  }, [regionGraph]);

  const tutorialHighlightRegions = useMemo(() => {
    if (!tutorial.isActive || !tutorial.currentStep?.getHighlightRegions || !gameState || !user?.id) return [];
    return tutorial.currentStep.getHighlightRegions(gameState, user.id, neighborMap);
  }, [tutorial.isActive, tutorial.currentStep, gameState, user?.id, neighborMap]);

  // In tutorial, override ability/building costs to match the snapshot values.
  // Also inject synthetic AbilityType entries for deck boosts so they show in AbilityBar.
  const effectiveAbilities = useMemo(() => {
    const base = isTutorial
      ? abilitiesConfig.map((a) => ({ ...a, energy_cost: 10, cooldown_ticks: 5 }))
      : [...abilitiesConfig];

    // Create synthetic ability entries for boosts from the player's active_boosts
    const myPlayer = gameState?.players[myUserId];
    const boosts = myPlayer?.active_boosts ?? [];
    for (const boost of boosts) {
      // Skip if already in config (shouldn't happen, but be safe)
      if (base.some((a) => a.slug === boost.slug)) continue;
      const params = boost.params as Record<string, unknown>;
      const effectType = (params?.effect_type as string) ?? "";
      const value = (params?.value as number) ?? 0;
      const level = (params?.level as number) ?? 1;
      // Human-readable name from slug: "boost-mobilization-1" → "Mobilizacja"
      const nameFromSlug = boost.slug
        .replace(/^boost-/, "")
        .replace(/-\d+$/, "")
        .replace(/-/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());
      base.push({
        id: boost.slug,
        name: nameFromSlug,
        slug: boost.slug,
        asset_key: "",
        asset_url: null,
        description: `${effectType}: +${Math.round(value * 100)}%`,
        icon: "",
        sound_key: "",
        sound_url: null,
        target_type: "own" as const,
        energy_cost: 0,
        cooldown_ticks: 0,
        effect_duration_ticks: 60,
        effect_params: { [effectType]: value },
        order: 100 + level,
        max_level: 3,
        level_stats: {},
      } as AbilityType);
    }

    return base;
  }, [isTutorial, abilitiesConfig, gameState?.players, myUserId]);
  const effectiveBuildings = useMemo(() => {
    if (!isTutorial) return buildings;
    return buildings.map((b) => ({ ...b, cost: 0, energy_cost: 10, build_time_ticks: 3 }));
  }, [isTutorial, buildings]);

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

  const unitManpowerMap = useMemo(() => {
    return Object.fromEntries(unitsConfig.map((u) => [u.slug, u.manpower_cost ?? 1]));
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

  // Stable reference to regions for reachability — only recompute when selectedRegion's
  // owner or units change, not on every tick's region delta.
  const selectedRegionKey = useMemo(() => {
    if (!selectedRegion || status !== "in_progress") return "";
    const r = gameState?.regions?.[selectedRegion];
    if (!r || r.owner_id !== myUserId) return "";
    // Key on unit composition so we recompute only when units in selected region change
    const unitEntries = Object.entries(r.units ?? {}).filter(([, c]) => c > 0).sort().map(([t, c]) => `${t}:${c}`).join(",");
    return `${selectedRegion}|${unitEntries}`;
  }, [selectedRegion, status, gameState?.regions, myUserId]);

  const reachabilityByUnitType = useMemo(() => {
    if (!selectedRegionKey) {
      return {} as Record<string, ReachabilityEntry>;
    }

    const mapRegions = gameState?.regions || {};
    const sourceRegion = selectedRegion ? mapRegions[selectedRegion] : undefined;
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
          // Fighters (combat_target="air") can only attack provinces with enemy air units.
          if (rules.combat_target === "air") {
            const targetUnits = region.units ?? {};
            const hasEnemyAir = Object.entries(targetUnits).some(([ut, c]) => {
              const utRules = unitConfigBySlug[ut] ?? getUnitRules(unitsConfig, ut);
              return (c ?? 0) > 0 && utRules.movement_type === "air";
            });
            if (!hasEnemyAir) continue;
          }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- gated by selectedRegionKey to avoid BFS on every tick
  }, [selectedRegionKey, gameState?.regions, myUserId, neighborMap, selectedRegion, unitConfigBySlug, unitsConfig]);

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

  // Ability targeting: compute valid target regions via BFS from owned regions
  const abilityTargets = useMemo(() => {
    if (!selectedAbility || status !== "in_progress") return [];
    const abilityDef = effectiveAbilities.find((a) => a.slug === selectedAbility);
    if (!abilityDef) return [];

    const mapRegions = gameState?.regions || {};

    // Collect all owned region IDs
    const ownedRegions = new Set<string>();
    for (const [rid, r] of Object.entries(mapRegions)) {
      if (r.owner_id === myUserId) ownedRegions.add(rid);
    }

    // BFS from all owned regions up to ability range
    const inRange = new Set<string>();
    if (abilityDef.range === 0 && abilityDef.target_type === "own") {
      // range 0 + own target = own regions only (shield, conscription)
      for (const rid of ownedRegions) inRange.add(rid);
    } else if (abilityDef.range === 0) {
      // range 0 + enemy/any = unlimited range (nuke)
      for (const rid of Object.keys(mapRegions)) inRange.add(rid);
    } else {
      const visited = new Set<string>();
      const queue: [string, number][] = [];
      for (const rid of ownedRegions) {
        visited.add(rid);
        queue.push([rid, 0]);
      }
      let qi = 0;
      while (qi < queue.length) {
        const [current, dist] = queue[qi++];
        inRange.add(current);
        if (dist >= abilityDef.range) continue;
        for (const neighbor of neighborMap[current] || []) {
          if (neighbor in mapRegions && !visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push([neighbor, dist + 1]);
          }
        }
      }
    }

    // Filter by target_type
    const validTargets: string[] = [];
    for (const rid of inRange) {
      const region = mapRegions[rid];
      if (!region) continue;
      if (abilityDef.target_type === "any") {
        validTargets.push(rid);
      } else if (abilityDef.target_type === "enemy" && region.owner_id && region.owner_id !== myUserId) {
        validTargets.push(rid);
      } else if (abilityDef.target_type === "own" && region.owner_id === myUserId) {
        validTargets.push(rid);
      }
    }

    return validTargets;
  }, [selectedAbility, effectiveAbilities, gameState?.regions, myUserId, neighborMap, status]);

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
      let qi = 0;
      while (qi < queue.length) {
        const [current, dist] = queue[qi++];
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
  const { myRegionCount, myUnitCount, myEnergy } = useMemo(() => {
    if (!gameState) return { myRegionCount: 0, myUnitCount: 0, myEnergy: 0 };
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
      myEnergy: gameState.players[myUserId]?.energy ?? 0,
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
      .map((player) => {
        const stats = statsMap.get(player.user_id);
        return {
          user_id: player.user_id,
          username: player.username,
          color: player.color,
          regionCount: stats?.regionCount ?? 0,
          unitCount: stats?.unitCount ?? 0,
          isAlive: player.is_alive,
          isBot: player.is_bot ?? false,
          cosmetics: player.cosmetics,
        };
      })
      .sort((left, right) =>
        Number(right.isAlive) - Number(left.isAlive) ||
        right.regionCount - left.regionCount ||
        right.unitCount - left.unitCount ||
        left.username.localeCompare(right.username)
      );
  }, [players, regions]);

  const finalRanking = useMemo(() => {
    if (status !== "finished") return [];
    return Object.values(players)
      .map((player) => ({
        user_id: player.user_id,
        username: player.username,
        color: player.color,
        regionsConquered: player.total_regions_conquered ?? 0,
        unitsProduced: player.total_units_produced ?? 0,
        unitsLost: player.total_units_lost ?? 0,
        buildingsBuilt: player.total_buildings_built ?? 0,
        isAlive: player.is_alive,
        isBot: player.is_bot ?? false,
        eliminatedTick: player.eliminated_tick ?? null,
      }))
      .sort((a, b) =>
        Number(b.isAlive) - Number(a.isAlive) ||
        (b.eliminatedTick ?? 0) - (a.eliminatedTick ?? 0) ||
        b.regionsConquered - a.regionsConquered ||
        b.unitsProduced - a.unitsProduced
      );
  }, [status, players]);

  // ── Event-driven animations (visible to ALL clients) ───────
  //
  // Instead of triggering animations locally (only visible to the acting player),
  // we derive them from server events so every connected client sees the same
  // troop movements and attacks.

  useEffect(() => {
    if (events.length === 0) return;

    const seen = processedAnimKeysRef.current;
    const newEvents = events.filter((e) => {
      const key = e.__eventKey;
      return key ? !seen.has(key) : true;
    });
    if (newEvents.length === 0) return;
    for (const e of newEvents) { if (e.__eventKey) seen.add(e.__eventKey); }
    // Cap set size to prevent unbounded growth
    if (seen.size > 200) {
      const keep = new Set<string>();
      for (const e of events) { if (e.__eventKey) keep.add(e.__eventKey); }
      processedAnimKeysRef.current = keep;
    }

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
          playerId,
        });
      } else if (e.type === "attack_success" || e.type === "attack_failed") {
        // Arrival/combat resolution only; travel animation is driven by troops_sent.
      } else if (e.type === "units_moved") {
        // Arrival event only; travel animation is driven by troops_sent.
      } else if (e.type === "boost_activated" && e.player_id === myUserId) {
        const effectLabel = BOOST_EFFECT_LABELS[e.effect_type as string] ?? (e.effect_type as string);
        toast.success(`Boost aktywowany: ${effectLabel}`);
      } else if (e.type === "boost_expired" && e.player_id === myUserId) {
        const slug = e.boost_slug as string;
        const label = slug.replace(/^boost-/, "").replace(/-\d+$/, "").replace(/-/g, " ");
        toast.warning(`Boost wygasł: ${label}`);
      } else if (e.type === "bombard") {
        const sourceId = e.source_region_id as string;
        const targetId = e.target_region_id as string;
        const artilleryCount = (e.artillery_count as number) ?? 1;
        const playerId = e.player_id as string;
        const color = gameStateRef.current?.players[playerId]?.color ?? "#ef4444";
        const rocketCount = Math.min(artilleryCount, 5);
        for (let i = 0; i < rocketCount; i++) {
          newAnims.push({
            id: crypto.randomUUID(),
            sourceId,
            targetId,
            color,
            units: artilleryCount,
            unitType: "artillery",
            type: "attack" as const,
            startTime: Date.now() + i * 200,
            durationMs: 2000,
            playerId,
          });
        }
      } else if (e.type === "air_mission_launched") {
        // No TroopAnimation needed — flights are rendered from air_transit_queue
        // state in GameCanvas (state-driven, position from progress field).
      } else if (e.type === "air_combat_resolved") {
        // Mid-air combat — show explosion at approximate position
        // (no specific animation needed; the flight animation continues or stops)
        const flightId = e.flight_id as string;
        const bombersRemaining = (e.bombers_remaining as number) ?? 0;
        if (bombersRemaining <= 0) {
          // Remove the flight animation if bombers destroyed
          setAnimations((prev) => prev.filter((a) => a.id !== flightId));
        }
      } else if (e.type === "path_damage") {
        // Bomb drop animation on the province that took real damage during flight.
        const targetId = e.target_region_id as string;
        const playerId = e.player_id as string;
        const killed = (e.units_killed as number) ?? 0;
        if (killed > 0) {
          const color = gameStateRef.current?.players[playerId]?.color ?? "#ef4444";
          newAnims.push({
            id: crypto.randomUUID(),
            sourceId: targetId,
            targetId,
            color,
            units: killed,
            unitCount: killed,
            unitType: "bomber",
            type: "attack" as const,
            startTime: Date.now(),
            durationMs: 1200,
            playerId,
          });
        }
      } else if (e.type === "bomber_strike") {
        // Final strike on target province.
        const targetId = e.target_region_id as string;
        const playerId = e.player_id as string;
        const groundKilled = (e.ground_units_destroyed as number) ?? 0;
        const neutralized = e.province_neutralized as boolean;
        const regionName = gameStateRef.current?.regions[targetId]?.name ?? targetId;
        if (groundKilled > 0) {
          const color = gameStateRef.current?.players[playerId]?.color ?? "#ef4444";
          // Bomb drop animation on target.
          newAnims.push({
            id: crypto.randomUUID(),
            sourceId: targetId,
            targetId,
            color,
            units: groundKilled,
            unitCount: groundKilled,
            unitType: "bomber",
            type: "attack" as const,
            startTime: Date.now(),
            durationMs: 1500,
            playerId,
          });
          toast.info(`Bombardowanie ${regionName}: -${groundKilled} jednostek`);
        }
        if (neutralized) {
          toast.info(`${regionName} zneutralizowana przez bombardowanie!`);
        }
      } else if (e.type === "province_neutralized") {
        const regionId = e.region_id as string;
        const previousOwner = e.previous_owner_id as string;
        if (previousOwner === myUserId) {
          const regionName = gameStateRef.current?.regions[regionId]?.name ?? regionId;
          toast.error(`Stracono prowincję ${regionName} — zneutralizowana!`);
        }
      } else if (e.type === "air_intercept_dispatched") {
        // Interceptors sent — could add toast for own player
        const interceptorPlayer = e.interceptor_player_id as string;
        if (interceptorPlayer === myUserId) {
          toast.info("Myśliwce wysłane na przechwycenie!");
        }
      }
    }

    if (newAnims.length > 0) {
      setAnimations((prev) => [...prev, ...newAnims]);
    }
  }, [events, myUserId, unitsConfig]);

  // ── Instant dispatch helper (used by both drag and click-click) ────

  const dispatchTroops = useCallback(
    (sourceId: string, targetId: string, unitType: string, unitCount: number) => {
      if (!gameState) return;
      const target = gameState.regions[targetId];
      if (!target) return;
      const reachability = reachabilityByUnitType[unitType];
      const isAttackTarget = target.owner_id !== myUserId;
      const distance = isAttackTarget
        ? (reachability?.attackDistanceByTarget.get(targetId) ?? null)
        : (reachability?.moveDistanceByTarget.get(targetId) ?? null);
      if (distance === null) return;

      const rules = unitConfigBySlug[unitType] ?? getUnitRules(unitsConfig, unitType);
      const tickMs = parseInt(gameState.meta?.tick_interval_ms || "1000", 10);
      // Match engine's get_travel_ticks: ticks_per_hop takes priority over legacy speed.
      const tph = rules.ticks_per_hop ?? 0;
      const travelTicks = tph > 0
        ? Math.max(1, Math.max(1, distance) * tph)
        : Math.max(1, Math.ceil(Math.max(1, distance) / Math.max(1, rules.speed || 1)));
      const actionType = isAttackTarget ? "attack" : "move";

      const dispatchKey = [actionType, myUserId, sourceId, targetId, unitType, unitCount].join(":");
      localDispatchKeysRef.current.set(dispatchKey, Date.now());
      if (localDispatchKeysRef.current.size > 50) {
        const now = Date.now();
        for (const [k, t] of localDispatchKeysRef.current) {
          if (now - t > 5000) localDispatchKeysRef.current.delete(k);
        }
      }

      // Air units are rendered from air_transit_queue state — no local TroopAnimation.
      const isAir = rules.movement_type === "air";
      if (!isAir) {
        setAnimations((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sourceId,
            targetId,
            color: gameState.players[myUserId]?.color ?? "#3b82f6",
            units: getAnimationPower(unitsConfig, unitType, unitCount),
            unitCount,
            unitType,
            type: actionType,
            startTime: Date.now(),
            durationMs: travelTicks * tickMs,
            playerId: myUserId,
          },
        ]);
      }

      if (isAttackTarget) {
        // When sending bombers, auto-escort with 25% of available fighters.
        let escortCount = 0;
        if (unitType === "bomber" && gameState.regions[sourceId]) {
          const availableFighters = gameState.regions[sourceId].units?.fighter ?? 0;
          escortCount = Math.ceil(availableFighters * 0.25);
        }
        attack(sourceId, targetId, unitCount, unitType, escortCount > 0 ? escortCount : undefined);
      } else {
        move(sourceId, targetId, unitCount, unitType);
      }
    },
    [gameState, myUserId, attack, move, reachabilityByUnitType, unitConfigBySlug, unitsConfig]
  );

  // ── Click handler ──────────────────────────────────────────

  const handleRegionClick = useCallback(
    (regionId: string) => {
      if (showIntroRef.current) return;
      if (!mapReadyRef.current) return;

      // Capital selection phase
      if (status === "selecting") {
        if (hasSelectedCapital) return;
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
          toast.error(`Stolica musi być co najmniej ${minDist} regiony od stolicy innego gracza`);
          return;
        }
        selectCapital(regionId);
        return;
      }

      if (status !== "in_progress") return;

      const region = gameState?.regions[regionId];
      if (!region) return;

      // Ability targeting mode — use ability on clicked region
      if (selectedAbility) {
        const abilityDef = effectiveAbilities.find((a) => a.slug === selectedAbility);
        if (abilityDef) {
          const isValidTarget =
            abilityDef.target_type === "any" ||
            (abilityDef.target_type === "enemy" && region.owner_id !== myUserId) ||
            (abilityDef.target_type === "own" && region.owner_id === myUserId);
          if (!isValidTarget) {
            toast.error(
              abilityDef.target_type === "enemy"
                ? "Zdolnosc wymaga wrogiego celu"
                : "Zdolnosc wymaga wlasnego regionu"
            );
            return;
          }
          castAbility(regionId, selectedAbility);
          setSelectedAbility(null);
          return;
        }
      }

      // If we have a source and clicked a valid neighbor → INSTANT SEND
      if (
        selectedRegion &&
        selectedRegion !== regionId &&
        isSource &&
        highlightedNeighbors.includes(regionId)
      ) {
        const sourceRegion = gameState?.regions[selectedRegion];
        if (!sourceRegion) return;

        const unitType = selectedActionUnitType
          ?? getPreferredReachableUnitType(regionId)
          ?? Object.entries(sourceRegion.units ?? {}).find(([, c]) => c > 0)?.[0]
          ?? "infantry";

        if (!isTargetReachableForUnitType(regionId, unitType)) return;

        const available = getAvailableUnits(sourceRegion.units, unitType, unitConfigBySlug);
        const unitsToSend = Math.max(1, Math.floor(available * (unitPercent / 100)));
        if (unitsToSend < 1) return;

        if (!selectedActionUnitType) {
          setSelectedActionUnitType(unitType);
        }

        dispatchTroops(selectedRegion, regionId, unitType, unitsToSend);
        setSelectedRegion(null);
        setSelectedActionUnitType(null);
        return;
      }

      // Click same region → deselect
      if (regionId === selectedRegion) {
        setSelectedRegion(null);
        setSelectedActionUnitType(null);
        return;
      }

      // Select new region (keep last unitPercent choice)
      setSelectedRegion(regionId);
      setSelectedActionUnitType(null);
    },
    [
      status,
      gameState,
      myUserId,
      selectedRegion,
      isSource,
      highlightedNeighbors,
      dimmedRegions,
      selectCapital,
      hasSelectedCapital,
      getPreferredReachableUnitType,
      isTargetReachableForUnitType,
      selectedActionUnitType,
      unitPercent,
      selectedAbility,
      effectiveAbilities,
      castAbility,
      dispatchTroops,
    ]
  );

  // ── Double-tap handler — send MAX units immediately ─────────

  const handleDoubleTap = useCallback(
    (regionId: string) => {
      if (status !== "in_progress" || !gameState || !selectedRegion) return;
      if (selectedRegion === regionId) return;

      const source = gameState.regions[selectedRegion];
      if (!source || source.owner_id !== myUserId) return;

      // Check if target is a highlighted neighbor
      if (!highlightedNeighbors.includes(regionId)) return;

      const unitType = selectedActionUnitType
        ?? getPreferredReachableUnitType(regionId)
        ?? Object.entries(source.units ?? {}).find(([, c]) => c > 0)?.[0]
        ?? "infantry";

      if (!isTargetReachableForUnitType(regionId, unitType)) return;

      const units = getAvailableUnits(source.units, unitType, unitConfigBySlug);
      if (units < 1) return;

      // Send ALL units (MAX)
      dispatchTroops(selectedRegion, regionId, unitType, units);
      setSelectedRegion(null);
      setSelectedActionUnitType(null);
    },
    [
      status,
      gameState,
      selectedRegion,
      myUserId,
      highlightedNeighbors,
      selectedActionUnitType,
      getPreferredReachableUnitType,
      isTargetReachableForUnitType,
      dispatchTroops,
      unitConfigBySlug,
    ]
  );

  // ── Action handlers ────────────────────────────────────────

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
  }, []);

  const handleMapReady = useCallback(() => {
    mapReadyRef.current = true;
    setMapReady(true);
  }, []);

  const handleCancelAction = useCallback(() => {
    setSelectedRegion(null);
    setSelectedActionUnitType(null);
    setSelectedAbility(null);
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (status !== "in_progress") return;

      switch (e.key) {
        // 1-4: unit percentage presets
        case "1": setUnitPercent(25); break;
        case "2": setUnitPercent(50); break;
        case "3": setUnitPercent(75); break;
        case "4": setUnitPercent(100); break;

        // Q/W/E/R: switch unit type (1st, 2nd, 3rd, 4th available)
        case "q": case "Q":
        case "w": case "W":
        case "e": case "E":
        case "r": case "R": {
          if (!selectedRegion || !gameState) break;
          const source = gameState.regions[selectedRegion];
          if (!source || source.owner_id !== myUserId) break;
          const availableTypes = Object.entries(source.units ?? {})
            .filter(([, count]) => count > 0)
            .map(([type]) => type);
          const idx = ({ q: 0, Q: 0, w: 1, W: 1, e: 2, E: 2, r: 3, R: 3 } as Record<string, number>)[e.key] ?? 0;
          if (idx < availableTypes.length) {
            handleSelectedActionUnitTypeChange(availableTypes[idx]);
          }
          break;
        }

        // Escape: deselect / cancel
        case "Escape":
          handleCancelAction();
          break;

        // Tab: cycle through own provinces
        case "Tab": {
          e.preventDefault();
          if (!gameState) break;
          const ownRegions = Object.entries(gameState.regions)
            .filter(([, r]) => r.owner_id === myUserId)
            .map(([id]) => id)
            .sort();
          if (ownRegions.length === 0) break;
          const currentIdx = selectedRegion ? ownRegions.indexOf(selectedRegion) : -1;
          const nextIdx = (currentIdx + 1) % ownRegions.length;
          setSelectedRegion(ownRegions[nextIdx]);
          setSelectedActionUnitType(null);
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [status, selectedRegion, gameState, myUserId, handleCancelAction, handleSelectedActionUnitTypeChange]);

  const handleSelectAbility = useCallback((slug: string | null) => {
    setSelectedAbility(slug);
    if (slug) {
      setSelectedRegion(null);
      setSelectedActionUnitType(null);
    }
  }, []);

  // Boosts activate globally — no region target needed; send with empty target_region_id
  const handleActivateBoost = useCallback(
    (slug: string) => {
      castAbility("", slug);
    },
    [castAbility]
  );

  const buildingsQueue = useMemo(() => gameState?.buildings_queue || [], [gameState?.buildings_queue]);
  const unitQueue = useMemo(() => gameState?.unit_queue || [], [gameState?.unit_queue]);

  // ── Music ───────────────────────────────────────────────────

  useEffect(() => {
    if (status === "in_progress" || status === "selecting") {
      startMusic();
    } else if (status === "finished" || status === "cancelled") {
      stopMusic();
      voice.leave();
    }
  }, [status, startMusic, stopMusic, voice.leave]);

  // ── Game end auto-redirect countdown ───────────────────────

  useEffect(() => {
    if (status !== "finished" || isTutorial) return;
    setGameEndCountdown(10);
    const interval = setInterval(() => {
      setGameEndCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          router.push(`/match/${matchId}`);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status, matchId, router, isTutorial]);

  // ── Events ─────────────────────────────────────────────────

  useEffect(() => {
    if (events.length === 0) return;

    const seen = processedAudioKeysRef.current;
    const newEvents = events.filter((e) => {
      const key = e.__eventKey;
      return key ? !seen.has(key) : true;
    });
    if (newEvents.length === 0) return;
    for (const e of newEvents) { if (e.__eventKey) seen.add(e.__eventKey); }
    if (seen.size > 200) {
      const keep = new Set<string>();
      for (const e of events) { if (e.__eventKey) keep.add(e.__eventKey); }
      processedAudioKeysRef.current = keep;
    }

    for (const e of newEvents) {
      if (e.type === "game_over") {
        const winnerId = e.winner_id as string;
        const winner = gameState?.players[winnerId];
        if (winnerId === myUserId) {
          toast.success("Wygrales");
          playSound("popup");
          // TODO: Trigger victory VFX overlay using the winner's vfx_victory cosmetic.
          // getVictoryVfx returns the cosmetic asset (URL or params object) to use.
          const _victoryVfx = getVictoryVfx(gameStateRef.current?.players[myUserId]?.cosmetics);
          void _victoryVfx; // placeholder — pass to VFX overlay component when implemented
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
      if (e.type === "player_eliminated" && e.player_id !== myUserId) {
        const eliminatedPlayer = gameStateRef.current?.players[String(e.player_id)];
        toast.info(`${eliminatedPlayer?.username || "Gracz"} został wyeliminowany`);
        // TODO: Trigger elimination VFX overlay for the eliminating player.
        // e.eliminator_id will carry the killer's player ID once the gateway sends it.
        // Example (not yet wired): const eliminatorId = e.eliminator_id as string | undefined;
        //   const eliminator = gameStateRef.current?.players[eliminatorId ?? ""];
        //   const eliminationVfx = getEliminationVfx(eliminator?.cosmetics);
        //   if (eliminationVfx) { /* show VFX overlay for eliminatorId */ }
        void getEliminationVfx; // ensure the import is referenced
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
          toast.warning(`⚔️ ${attackerName} atakuje ${regionName}!`, { duration: 5000 });
        }
      }
      if (e.type === "attack_success" && e.player_id !== myUserId) {
        const targetRegionId = e.target_region_id as string | undefined;
        // Region was mine before — lost
        if (targetRegionId && gameStateRef.current?.regions[targetRegionId]?.owner_id === myUserId) {
          playSound("missile_explosion");
        }
      }
      if (e.type === "ability_used") {
        const soundKey = e.sound_key as string | undefined;
        const abilityName = e.ability_type as string;
        const isMyAbility = e.player_id === myUserId;
        const isNuke = abilityName === "ab_province_nuke";
        // Play launch sound (skip nuke — it has custom timing)
        if (!isNuke) {
          const abilitySounds: Record<string, Parameters<typeof playSound>[0]> = {
            virus: "virus", submarine: "submarine", shield: "shield", quick_gain: "quick_gain",
          };
          if (soundKey && abilitySounds[soundKey]) {
            playSound(abilitySounds[soundKey]);
          }
        }
        if (isMyAbility) {
          toast.success(`Uzyto: ${abilityName}`);
        } else {
          const attackerName = gameStateRef.current?.players[String(e.player_id)]?.username ?? "Wrog";
          toast.warning(`${attackerName} uzyl zdolnosci: ${abilityName}`);
        }
        // Nuke rocket animation — flies from caster's capital to target
        if (isNuke) {
          const casterId = e.player_id as string;
          const casterCapital = gameStateRef.current?.players[casterId]?.capital_region_id;
          const targetId = e.target_region_id as string;
          if (casterCapital && targetId && casterCapital !== targetId) {
            const color = gameStateRef.current?.players[casterId]?.color ?? "#ef4444";
            // Launch sound
            playSound("nuke");
            // Explosion sound at impact (after 8s flight)
            setTimeout(() => playSound("nuke_explosion"), 8000);
            setAnimations((prev) => [...prev, {
              id: `nuke-${crypto.randomUUID()}`,
              sourceId: casterCapital,
              targetId: targetId,
              color,
              units: 0,
              unitType: "nuke_rocket",
              type: "attack" as const,
              startTime: Date.now(),
              durationMs: 8000,
            }]);
            // Darken target + neighbors for a few seconds after impact
            setTimeout(() => {
              setNukeBlackout((prev) => {
                const targetNeighbors = neighborMap[targetId] || [];
                const allAffected = [targetId, ...targetNeighbors];
                return [...prev, ...allAffected.map((rid) => ({ rid, startTime: Date.now() }))];
              });
            }, 8000);
          }
        }
      }
      if (e.type === "shield_blocked") {
        const targetRegionName = gameStateRef.current?.regions[String(e.target_region_id)]?.name ?? "region";
        if (e.attacker_id === myUserId) {
          toast.error(`Atak na ${targetRegionName} zostal zablokowany przez tarcze!`);
          playSound("shield");
        } else {
          const targetOwner = gameStateRef.current?.regions[String(e.target_region_id)]?.owner_id;
          if (targetOwner === myUserId) {
            toast.success(`Tarcza ochronila ${targetRegionName}!`);
            playSound("shield");
          }
        }
      }
      if (e.type === "path_damage") {
        playSound("missile_explosion");
      }
      if (e.type === "bombard") {
        playSound("missile_explosion");
      }
      if (e.type === "aoe_damage") {
        playSound("missile_explosion");
      }
      if (e.type === "air_mission_launched") {
        playSound("plane_start");
      }
      if (e.type === "bomber_strike") {
        playSound("missile_explosion");
      }
      if (e.type === "air_combat_resolved") {
        playSound("missile_explosion");
      }
      if (e.type === "flash_effect") {
        playSound("alert");
        if (e.affected_region_ids && Array.isArray(e.affected_region_ids)) {
          const myRegions = Object.entries(gameStateRef.current?.regions ?? {})
            .filter(([, r]) => r.owner_id === myUserId)
            .map(([id]) => id);
          const affectedMine = (e.affected_region_ids as string[]).some(id => myRegions.includes(id));
          if (affectedMine) {
            toast.error("Flara oślepiająca! Prowincje zaciemnione!");
          }
        }
      }
      if (e.type === "ability_effect_expired") {
        const effectType = e.effect_type as string;
        const targetRegionName = gameStateRef.current?.regions[String(e.target_region_id)]?.name ?? "region";
        if (effectType === "ab_shield") {
          const regionOwner = gameStateRef.current?.regions[String(e.target_region_id)]?.owner_id;
          if (regionOwner === myUserId) {
            toast.info(`Tarcza na ${targetRegionName} wygasla`);
          }
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
  }, [events, myUserId, neighborMap, gameState?.players, playSound]);

  const capitalSelectionEndsAt = Number(gameState?.meta?.capital_selection_ends_at || 0);
  const capitalSelectionRemaining = status === "selecting" && capitalSelectionEndsAt > 0
    ? Math.max(0, capitalSelectionEndsAt - Math.floor(nowMs / 1000))
    : 0;

  // Capital selection toast — only after overlay dismissed
  useEffect(() => {
    if (status === "selecting" && !showIntro && !hasSelectedCapital) {
      const msg = capitalSelectionRemaining > 0
        ? `Wybierz stolice! Pozostalo: ${capitalSelectionRemaining}s`
        : "Wybierz stolice!";
      toast.info(msg, {
        id: "capital-selection",
        duration: Infinity,
      });
    } else if (status !== "selecting" || hasSelectedCapital) {
      toast.dismiss("capital-selection");
    }
  }, [status, showIntro, capitalSelectionRemaining, hasSelectedCapital]);

  // ── Render ─────────────────────────────────────────────────

  if (authLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#050b14]">
      {/* Hex tile overlay hidden on mobile for GPU perf */}
      <div className="pointer-events-none absolute inset-0 hidden bg-[url('/assets/ui/hex_bg_tile.webp')] bg-[size:240px] opacity-[0.04] sm:block" />



      {tutorial.isActive && tutorial.currentStep && (
        <TutorialOverlay
          step={tutorial.currentStep}
          stepIndex={tutorial.stepIndex}
          totalSteps={tutorial.totalSteps}
          canGoBack={tutorial.canGoBack}
          onAdvance={tutorial.advanceStep}
          onGoBack={tutorial.goBack}
          onSkip={tutorial.skipTutorial}
        />
      )}

      {/* Top-right controls */}
      <div className="absolute right-2 top-2 z-20 flex items-center gap-2 sm:right-4 sm:top-4">
        <div className="relative">
          <button
            onClick={toggleMute}
            title={muted ? "Włącz dźwięk" : "Wycisz dźwięk"}
            className="rounded-full border border-border bg-card p-1.5 text-muted-foreground shadow-lg transition-colors hover:bg-muted/50 hover:text-foreground sm:bg-card/85 sm:p-2 sm:backdrop-blur-xl"
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <button
            onClick={() => setMusicPickerOpen((prev) => !prev)}
            title="Wybierz muzyke"
            className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            ♫
          </button>
          {musicPickerOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMusicPickerOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-2xl border border-border bg-card shadow-lg sm:bg-card/95 sm:backdrop-blur-xl">
                <div className="px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Muzyka
                </div>
                {MUSIC_TRACKS.map((track, i) => (
                  <button
                    key={track.src}
                    onClick={() => {
                      selectTrack(i);
                      setMusicPickerOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/30 ${
                      i === currentTrackIndex
                        ? "bg-muted/30 text-accent"
                        : "text-foreground/80"
                    }`}
                  >
                    <span className="w-4 text-center text-xs">
                      {i === currentTrackIndex && !muted ? "▶" : ""}
                    </span>
                    <span className="truncate">{track.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* Desktop-only action buttons */}
        <button
          onClick={() => router.push("/dashboard")}
          className="hidden rounded-full border border-border bg-card/85 px-4 py-2 text-xs text-foreground/80 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl transition-colors hover:bg-muted/50 sm:block"
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
            className="hidden rounded-full border border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl transition-colors hover:bg-destructive/20 sm:block"
          >
            Opuść mecz
          </button>
        )}
      </div>

      {/* Mobile bottom action bar */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 border-t border-border bg-card px-3 py-2 sm:hidden">
        <button
          onClick={() => router.push("/dashboard")}
          className="rounded-full border border-border bg-muted/50 px-4 py-2 text-xs text-foreground/80 transition-colors hover:bg-muted"
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
            className="rounded-full border border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive transition-colors hover:bg-destructive/20"
          >
            Opuść mecz
          </button>
        )}
      </div>

      {/* Match cancelled overlay */}
      {status === "cancelled" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-red-400/30 bg-card p-8 text-center shadow-2xl">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20">
              <span className="text-2xl">⚠️</span>
            </div>
            <h2 className="font-display text-2xl text-foreground">Mecz anulowany</h2>
            <p className="text-sm text-muted-foreground">
              Ten mecz został anulowany z powodu błędu serwera lub rozłączenia graczy.
            </p>
            <button
              onClick={() => router.push("/dashboard")}
              className="mt-2 rounded-xl border border-primary/30 bg-primary/20 px-6 py-2.5 text-sm font-medium text-primary transition-all hover:bg-primary/30"
            >
              Wróć do panelu
            </button>
          </div>
        </div>
      )}

      {!connected && status !== "finished" && status !== "cancelled" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="flex items-center gap-3 rounded-[24px] border border-border bg-card px-6 py-4">
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

      {/* Match intro overlay — shows players VS while map loads */}
      {showIntro && (
        <MatchIntroOverlay
          players={players}
          myUserId={myUserId}
          connected={connected}
          gameStateLoaded={!!gameState}
          mapReady={mapReady}
          onComplete={handleIntroComplete}
        />
      )}

      {/* Fallback loading if intro already dismissed but map not ready */}
      {!showIntro && !mapReady && connected && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/90">
          <div className="flex flex-col items-center gap-3 rounded-[26px] border border-border bg-card px-8 py-6">
            <Image
              src="/assets/match_making/circle291.webp"
              alt=""
              width={52}
              height={52}
              className="h-12 w-12 animate-spin object-contain"
            />
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Ładowanie mapy...</span>
          </div>
        </div>
      )}

      {status === "finished" && !tutorial.isActive && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-0 text-center shadow-2xl sm:rounded-[32px]">
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
            <div className="px-4 py-4 sm:px-8 sm:py-6">
              <h2 className="mb-1 font-display text-2xl text-foreground sm:text-4xl">Koniec gry</h2>
              <p className="mb-4 text-sm text-muted-foreground">Rozgrywka zakończona</p>
              {finalRanking.length > 0 && (
                <div className="mb-5 w-full min-w-0 space-y-1.5 text-left sm:min-w-[320px]">
                  {finalRanking.map((p, i) => {
                    const isMe = p.user_id === myUserId;
                    return (
                      <div
                        key={p.user_id}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                          isMe ? "bg-primary/15 border border-primary/30" : "bg-muted/30 border border-border/50"
                        }`}
                      >
                        <span className="w-6 text-center font-display text-lg text-muted-foreground">
                          {i + 1}
                        </span>
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: p.color }}
                        />
                        <span className={`flex-1 truncate text-sm ${isMe ? "font-medium text-foreground" : "text-foreground/80"}`}>
                          {p.username}
                          {p.isBot && <span className="ml-1.5 text-[10px] text-muted-foreground">BOT</span>}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {p.regionsConquered} reg
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {p.unitsProduced} jedn.
                        </span>
                        {p.isAlive ? (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                            WINNER
                          </span>
                        ) : (
                          <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                            WYELIMINOWANY
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                onClick={() => router.push(`/match/${matchId}`)}
                className="rounded-full border border-border bg-muted/30 px-6 py-2.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/50"
              >
                Statystyki meczu ({gameEndCountdown}s)
              </button>
              <button
                onClick={() => router.push("/dashboard")}
                className="rounded-full bg-primary px-8 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Wróć do lobby
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Map */}
      <GameCanvas
          shapesData={shapesData}
          dimmedRegions={dimmedRegions}
          regions={regions}
          players={players}
          selectedRegion={selectedRegion}
          targetRegions={[]}
          highlightedNeighbors={selectedAbility ? abilityTargets : highlightedNeighbors}
          onRegionClick={handleRegionClick}
          onDoubleTap={handleDoubleTap}
          myUserId={myUserId}
          animations={animations}
          buildingIcons={buildingIcons}
          activeEffects={gameState?.active_effects}
          nukeBlackout={nukeBlackout}
          onMapReady={handleMapReady}
          weather={gameState?.weather}
          airTransitQueue={gameState?.air_transit_queue}
          unitManpowerMap={unitManpowerMap}
          onFlightClick={(flightId) => {
            // Find a source region with fighters to intercept
            if (!gameState) return;
            const flight = gameState.air_transit_queue?.find((f) => f.id === flightId);
            if (!flight || flight.player_id === myUserId) return;
            // Find closest own region with fighters
            const ownRegionsWithFighters = Object.entries(gameState.regions)
              .filter(([, r]) => r.owner_id === myUserId && (r.units?.fighter ?? 0) > 0);
            if (ownRegionsWithFighters.length === 0) {
              toast.warning("Brak myśliwców do przechwycenia!");
              return;
            }
            // Use selected region if it has fighters, otherwise first available
            const sourceId = selectedRegion && ownRegionsWithFighters.some(([id]) => id === selectedRegion)
              ? selectedRegion
              : ownRegionsWithFighters[0][0];
            const fighterCount = gameState.regions[sourceId]?.units?.fighter ?? 0;
            interceptFlight(sourceId, flightId, fighterCount);
            toast.info(`Wysłano ${fighterCount} myśliwców na przechwycenie!`);
          }}
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
        myEnergy={myEnergy}
        fps={fps}
        ping={ping}
        connected={connected}
      />

      {/* Weather indicator — top-right HUD */}
      {gameState?.weather && (
        <div className="absolute right-2 top-2 z-10 sm:right-3 sm:top-3">
          <WeatherIndicator weather={gameState.weather} />
        </div>
      )}

      {/* Desktop: chat + voice in bottom-left, separate from HUD to avoid re-render perf issues */}
      {status !== "finished" && status !== "cancelled" && connected && (
        <DesktopChatVoice
          myUserId={myUserId}
          chatMessages={matchChatMessages}
          onSendChat={sendChat}
          voiceToken={voiceToken}
          voiceUrl={effectiveVoiceUrl}
          voiceConnected={voice.connected}
          voiceMicEnabled={voice.micEnabled}
          voiceIsSpeaking={voice.isSpeaking}
          voicePeers={voice.peers}
          onVoiceJoin={handleVoiceJoin}
          onVoiceLeave={voice.leave}
          onVoiceToggleMic={voice.toggleMic}
        />
      )}

      {/* Build queue progress */}
      <BuildQueue
        queue={buildingsQueue}
        unitQueue={unitQueue}
        buildings={effectiveBuildings}
        units={unitsConfig}
        myUserId={myUserId}
        myCosmetics={gameState?.players[myUserId]?.cosmetics}
      />

      {/* Quick Action Bar — region info + unit actions + build/produce */}
      {sourceRegionData && selectedRegion && status === "in_progress" && (
        <QuickActionBar
          regionId={selectedRegion}
          region={sourceRegionData}
          players={players}
          myUserId={myUserId}
          myEnergy={myEnergy}
          unitPercent={unitPercent}
          selectedUnitType={selectedUnitTypeForAction ?? sourceRegionData.unit_type ?? "infantry"}
          onPercentChange={setUnitPercent}
          onUnitTypeChange={handleSelectedActionUnitTypeChange}
          onCancel={handleCancelAction}
          buildings={effectiveBuildings}
          buildingQueue={buildingsQueue}
          units={unitsConfig}
          onBuild={handleBuild}
          onProduceUnit={handleProduceUnit}
          unlockedBuildings={gameState?.players[myUserId]?.unlocked_buildings}
          unlockedUnits={gameState?.players[myUserId]?.unlocked_units}
          buildingLevels={gameState?.players[myUserId]?.building_levels}
        />
      )}

      {/* Ability Bar */}
      {status === "in_progress" && effectiveAbilities.length > 0 && (
        <AbilityBar
          abilities={effectiveAbilities}
          myEnergy={myEnergy}
          abilityCooldowns={gameState?.players[myUserId]?.ability_cooldowns ?? {}}
          currentTick={currentTick}
          selectedAbility={selectedAbility}
          onSelectAbility={handleSelectAbility}
          onActivateBoost={handleActivateBoost}
          allowedAbility={tutorial.isActive ? (tutorial.currentStep?.allowedAbility ?? null) : undefined}
          abilityScrolls={gameState?.players[myUserId]?.ability_scrolls}
          abilityLevels={gameState?.players[myUserId]?.ability_levels}
          myCosmetics={gameState?.players[myUserId]?.cosmetics}
        />
      )}

      {/* Ability targeting hint */}
      {selectedAbility && (
        <div className="absolute left-1/2 top-12 z-20 -translate-x-1/2 sm:top-16">
          <div className="flex items-center gap-2 rounded-full border border-accent/20 bg-card px-4 py-2 shadow-lg sm:bg-card/85 sm:backdrop-blur-xl">
            <span className="text-sm text-accent">
              Wybierz cel dla: {effectiveAbilities.find((a) => a.slug === selectedAbility)?.name}
            </span>
            <button
              onClick={() => setSelectedAbility(null)}
              className="rounded-full bg-muted/30 px-2 py-0.5 text-xs text-foreground/80 hover:bg-muted/50"
            >
              Anuluj
            </button>
          </div>
        </div>
      )}

      {/* Mobile: voice + chat FABs, top-right */}
      {status !== "finished" && status !== "cancelled" && connected && (
        <div className="absolute right-2 top-2 z-20 flex flex-col items-end gap-2 sm:hidden">
          <VoicePanel
            token={voiceToken}
            url={effectiveVoiceUrl}
            players={players}
            connected={voice.connected}
            micEnabled={voice.micEnabled}
            isSpeaking={voice.isSpeaking}
            peers={voice.peers}
            onJoin={handleVoiceJoin}
            onLeave={voice.leave}
            onToggleMic={voice.toggleMic}
          />
          <MatchChatPanel
            messages={matchChatMessages}
            currentUserId={myUserId}
            onSend={sendChat}
          />
        </div>
      )}

      {/* Mobile build button – visible whenever own region is selected */}
      {sourceRegionData && selectedRegion && sourceRegionData.owner_id === myUserId && status === "in_progress" && (
        <MobileBuildSheet
          region={sourceRegionData}
          regionId={selectedRegion}
          myEnergy={myEnergy}
          buildings={effectiveBuildings}
          buildingQueue={buildingsQueue}
          units={unitsConfig}
          onBuild={handleBuild}
          onProduceUnit={handleProduceUnit}
          unlockedBuildings={gameState?.players[myUserId]?.unlocked_buildings}
          unlockedUnits={gameState?.players[myUserId]?.unlocked_units}
          buildingLevels={gameState?.players[myUserId]?.building_levels}
          myCosmetics={gameState?.players[myUserId]?.cosmetics}
        />
      )}
    </div>
  );
}
