"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createSocket, type WSMessage } from "@/lib/ws";
import { getAccessToken } from "@/lib/auth";
import { getWsTicket } from "@/lib/api";
import { solveChallenge } from "@/lib/pow";
import type { DiplomacyState } from "@/lib/gameTypes";

/** Fast shallow comparison for active_effects — avoids re-renders when data is identical. */
function shallowEqualEffects(
  prev: ActiveEffect[] | undefined,
  next: ActiveEffect[] | undefined
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i], b = next[i];
    if (
      a.effect_type !== b.effect_type ||
      a.target_region_id !== b.target_region_id ||
      a.ticks_remaining !== b.ticks_remaining ||
      a.source_player_id !== b.source_player_id
    ) return false;
  }
  return true;
}

export interface GameRegion {
  name: string;
  country_code: string;
  centroid?: [number, number] | null;
  owner_id: string | null;
  unit_count: number;
  unit_type?: string | null;
  units?: Record<string, number>;
  is_coastal?: boolean;
  sea_distances?: Array<{ r: number; provinces: string[] }>;
  is_capital: boolean;
  building_type: string | null;
  buildings?: Record<string, number>;
  building_levels?: Record<string, number>;
  building_instances?: Array<{ building_type: string; level: number }>;
  defense_bonus: number;
  vision_range?: number;
  unit_generation_bonus?: number;
  energy_generation_bonus?: number;
}

export interface GamePlayer {
  user_id: string;
  username: string;
  color: string;
  is_alive: boolean;
  connected?: boolean;
  disconnect_deadline?: number | null;
  left_match_at?: number | null;
  capital_region_id: string | null;
  energy: number;
  eliminated_reason?: string | null;
  eliminated_tick?: number | null;
  ability_cooldowns?: Record<string, number>;
  ability_scrolls?: Record<string, number>;
  ability_levels?: Record<string, number>;
  unlocked_buildings?: string[];
  unlocked_units?: string[];
  is_bot?: boolean;
  total_regions_conquered?: number;
  total_units_produced?: number;
  total_units_lost?: number;
  total_buildings_built?: number;
  building_levels?: Record<string, number>;
  active_boosts?: Array<{ slug: string; params: Record<string, unknown> }>;
  active_match_boosts?: Array<{ slug: string; effect_type: string; value: number; ticks_remaining: number }>;
  cosmetics?: Record<string, unknown>;
}

export interface ActiveEffect {
  effect_type: string;
  source_player_id: string;
  target_region_id: string;
  affected_region_ids: string[];
  ticks_remaining: number;
  total_ticks: number;
  params: Record<string, number>;
}

export interface WeatherState {
  time_of_day: number;
  phase: string;
  cloud_coverage: number;
  visibility: number;
  condition: string;
  defense_modifier: number;
  randomness_modifier: number;
  energy_modifier: number;
  unit_gen_modifier: number;
}

export interface BuildingQueueItem {
  region_id: string;
  building_type: string;
  player_id: string;
  ticks_remaining: number;
  total_ticks: number;
}

export interface UnitQueueItem {
  region_id: string;
  player_id: string;
  unit_type: string;
  quantity: number;
  ticks_remaining: number;
  total_ticks: number;
}

export interface InterceptorGroup {
  player_id: string;
  source_region_id: string;
  fighters: number;
  progress: number;
  speed_per_tick: number;
}

export interface AirTransitItem {
  id: string;
  mission_type: string; // "bomb_run" | "fighter_attack" | "escort_return"
  source_region_id: string;
  target_region_id: string;
  player_id: string;
  unit_type: string;
  units: number;
  escort_fighters: number;
  progress: number; // 0.0 = source, 1.0 = arrived
  speed_per_tick: number;
  total_distance: number;
  interceptors: InterceptorGroup[];
  flight_path?: string[]; // province IDs along the route
}

export interface GameState {
  meta: {
    status: string;
    current_tick: string;
    tick_interval_ms: string;
    max_players: string;
    min_capital_distance: string;
    capital_selection_time_seconds?: string;
    capital_selection_ends_at?: string;
    is_tutorial?: string;
    capital_protection_ticks?: string;
    diplomacy_enabled?: string;
  };
  players: Record<string, GamePlayer>;
  regions: Record<string, GameRegion>;
  buildings_queue: BuildingQueueItem[];
  unit_queue: UnitQueueItem[];
  transit_queue?: Array<Record<string, unknown>>;
  air_transit_queue?: AirTransitItem[];
  active_effects?: ActiveEffect[];
  weather?: WeatherState;
  diplomacy?: DiplomacyState;
}

export interface GameEvent {
  type: string;
  __eventKey?: string;
  [key: string]: unknown;
}

export interface MatchChatMessage {
  user_id: string;
  username: string;
  content: string;
  timestamp: number;
}

interface UseGameSocketReturn {
  connected: boolean;
  gameState: GameState | null;
  events: GameEvent[];
  matchChatMessages: MatchChatMessage[];
  voiceToken: string | null;
  voiceUrl: string | null;
  bannedReason: string | null;
  ping: number | undefined;
  diplomacy: DiplomacyState;
  selectCapital: (regionId: string) => void;
  attack: (sourceRegionId: string, targetRegionId: string, units: number, unitType?: string | null, escortFighters?: number) => void;
  move: (sourceRegionId: string, targetRegionId: string, units: number, unitType?: string | null) => void;
  bombard: (sourceRegionId: string, targetRegionIds: string[], units?: number) => void;
  interceptFlight: (sourceRegionId: string, flightId: string, units: number) => void;
  build: (regionId: string, buildingType: string) => void;
  upgradeBuilding: (regionId: string, buildingType: string) => void;
  produceUnit: (regionId: string, unitType: string) => void;
  useAbility: (targetRegionId: string, abilityType: string) => void;
  leaveMatch: () => Promise<boolean>;
  send: (data: Record<string, unknown>) => void;
  sendChat: (content: string) => void;
  proposePact: (targetPlayerId: string, pactType?: string) => void;
  respondPact: (proposalId: string, accept: boolean) => void;
  proposePeace: (targetPlayerId: string, conditionType?: string, provincesToReturn?: string[]) => void;
  respondPeace: (proposalId: string, accept: boolean) => void;
  breakPact: (pactId: string) => void;
  declareWar: (targetPlayerId: string) => void;
}

export function useGameSocket(matchId: string): UseGameSocketReturn {
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [matchChatMessages, setMatchChatMessages] = useState<MatchChatMessage[]>([]);
  const [voiceToken, setVoiceToken] = useState<string | null>(null);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [bannedReason, setBannedReason] = useState<string | null>(null);
  const [ping, setPing] = useState<number | undefined>(undefined);
  const [diplomacy, setDiplomacy] = useState<DiplomacyState>({ wars: [], pacts: [], proposals: [] });
  const wsRef = useRef<WebSocket | null>(null);
  const leaveResolverRef = useRef<((value: boolean) => void) | null>(null);
  const pingTimestampRef = useRef<number | null>(null);

  const handleMessage = useCallback((msg: WSMessage) => {
    switch (msg.type) {
      case "game_state": {
        const initialState = msg.state as GameState;
        if (msg.weather) {
          initialState.weather = msg.weather as WeatherState;
        }
        setGameState(initialState);
        if (msg.diplomacy) {
          setDiplomacy(msg.diplomacy as DiplomacyState);
        } else if (initialState.diplomacy) {
          setDiplomacy(initialState.diplomacy);
        }
        break;
      }
      case "game_tick": {
        const tickBase = String(msg.tick ?? "0");
        const rawTickEvents = (msg.events as GameEvent[]) || [];
        const tickEvents = rawTickEvents.map((event, index) => ({
          ...event,
          __eventKey:
            typeof event.__eventKey === "string"
              ? event.__eventKey
              : [
                  tickBase,
                  index,
                  event.type,
                  String(event.player_id ?? ""),
                  String(event.source_region_id ?? event.region_id ?? ""),
                  String(event.target_region_id ?? ""),
                  String(event.unit_type ?? event.building_type ?? ""),
                  String(event.units ?? event.quantity ?? ""),
                ].join(":"),
        }));
        const isGameOver = tickEvents.some((e) => e.type === "game_over");
        setGameState((prev) => {
          if (!prev) return prev;
          const mergedRegions = msg.regions
            ? Object.fromEntries(
                Object.entries(msg.regions as Record<string, GameRegion>).map(([regionId, regionUpdate]) => [
                  regionId,
                  {
                    ...prev.regions[regionId],
                    ...regionUpdate,
                  },
                ])
              )
            : null;
          return {
            ...prev,
            meta: {
              ...prev.meta,
              current_tick: String(msg.tick),
              ...(isGameOver ? { status: "finished" } : {}),
            },
            players: (msg.players as Record<string, GamePlayer>) || prev.players,
            regions: mergedRegions
              ? { ...prev.regions, ...mergedRegions }
              : prev.regions,
            buildings_queue: (msg.buildings_queue as BuildingQueueItem[]) ?? prev.buildings_queue,
            unit_queue: (msg.unit_queue as UnitQueueItem[]) ?? prev.unit_queue,
            transit_queue: (msg.transit_queue as Array<Record<string, unknown>>) ?? prev.transit_queue,
            air_transit_queue: (msg.air_transit_queue as AirTransitItem[]) ?? prev.air_transit_queue,
            active_effects: shallowEqualEffects(prev.active_effects, msg.active_effects as ActiveEffect[] | undefined)
              ? prev.active_effects
              : (msg.active_effects as ActiveEffect[]) ?? prev.active_effects,
            weather: msg.weather !== undefined
              ? (msg.weather as WeatherState)
              : prev.weather,
          };
        });
        if (msg.diplomacy) {
          setDiplomacy(msg.diplomacy as DiplomacyState);
        }
        if (tickEvents.length > 0) {
          setEvents((prev) => [...prev.slice(-50), ...tickEvents]);
        }
        break;
      }
      case "capital_selected":
        // No state change needed — next game_tick will contain the updated region
        break;
      case "game_starting":
        setGameState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            meta: { ...prev.meta, status: "in_progress" },
          };
        });
        break;
      case "error":
        console.error("Game error:", msg.message);
        setEvents((prev) => [
          ...prev.slice(-50),
          { type: "server_error", message: msg.message as string, fatal: msg.fatal as boolean | undefined },
        ]);
        // Fatal error = match cancelled/unrecoverable — update status
        if (msg.fatal) {
          setGameState((prev) => {
            if (!prev) return prev;
            return { ...prev, meta: { ...prev.meta, status: "cancelled" } };
          });
        }
        break;
      case "match_left":
        if (leaveResolverRef.current) {
          leaveResolverRef.current(true);
          leaveResolverRef.current = null;
        }
        break;
      case "chat_message":
        setMatchChatMessages((prev) => [
          ...prev.slice(-199),
          {
            user_id: msg.user_id as string,
            username: msg.username as string,
            content: msg.content as string,
            timestamp: msg.timestamp as number,
          },
        ]);
        break;
      case "chat_history": {
        const historyMsgs = (msg.messages as MatchChatMessage[]) || [];
        setMatchChatMessages(historyMsgs);
        break;
      }
      case "voice_token":
        setVoiceToken(msg.token as string);
        setVoiceUrl(msg.url as string);
        break;
      case "pong":
        if (pingTimestampRef.current !== null) {
          setPing(Date.now() - pingTimestampRef.current);
          pingTimestampRef.current = null;
        }
        break;
    }
  }, []);

  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffDelayRef = useRef<number>(1000);

  useEffect(() => {
    const token = getAccessToken();
    if (!token || !matchId) return;

    let disposed = false;
    let isPageUnload = false;
    let pingInterval: ReturnType<typeof setInterval> | null = null;

    const handleBeforeUnload = () => {
      isPageUnload = true;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    const connect = async () => {
      let ticket: string | null = null;
      let nonce: string | null = null;
      try {
        const t = await getWsTicket(token);
        ticket = t.ticket;
        nonce = await solveChallenge(t.challenge, t.difficulty);
      } catch {
        // Fallback: connect without ticket/pow
      }
      // After async work, check if effect was cleaned up (React Strict Mode double-mount)
      if (disposed) return;
      const ws = createSocket(
        `/game/${matchId}/`,
        token,
        handleMessage,
        (event: CloseEvent) => {
          if (!disposed) console.warn("[Game WS] closed", { code: event.code, reason: event.reason });
          if (leaveResolverRef.current) {
            leaveResolverRef.current(false);
            leaveResolverRef.current = null;
          }
          if (!disposed) {
            setConnected(false);
          }

          // Determine whether this close was intentional — skip reconnect if so.
          const isIntentionalClose =
            event.code === 1000 && event.reason === "component_disposed";

          // Server rejected reconnect (player left match, timed out, or match cancelled)
          const isServerRejection =
            event.code === 4000 || event.code === 4001 || event.code === 4002;

          // Account banned — do not reconnect, surface the ban reason
          const isBanClose = event.code === 4003;
          if (isBanClose) {
            setBannedReason(event.reason || "Account banned");
            return;
          }

          if (disposed || isPageUnload || isIntentionalClose || isServerRejection) {
            return;
          }

          // Unexpected disconnect — schedule a reconnect with exponential backoff.
          const delay = backoffDelayRef.current;
          backoffDelayRef.current = Math.min(delay * 2, 10000);

          retryTimeoutRef.current = setTimeout(() => {
            if (!disposed && !isPageUnload) {
              connect();
            }
          }, delay);
        },
        ticket,
        nonce,
      );

      ws.onopen = () => {
        if (disposed) {
          ws.close(1000, "component_disposed");
          return;
        }
        // Reset backoff on successful connection.
        backoffDelayRef.current = 1000;
        setConnected(true);

        // Periodic ping for latency measurement
        pingInterval = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            pingTimestampRef.current = Date.now();
            wsRef.current.send(JSON.stringify({ action: "ping", ts: pingTimestampRef.current }));
          }
        }, 5000);
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      disposed = true;
      window.removeEventListener("beforeunload", handleBeforeUnload);

      // Cancel any pending reconnect timer.
      if (retryTimeoutRef.current !== null) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }

      // Clear ping interval
      if (pingInterval) clearInterval(pingInterval);

      const ws = wsRef.current;
      wsRef.current = null;

      // On page refresh/unload, let the browser drop the connection naturally
      // so the gateway applies the grace period instead of treating it as intentional leave.
      if (ws && !isPageUnload && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "component_disposed");
      }
    };
  }, [matchId, handleMessage]);

  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const selectCapital = useCallback(
    (regionId: string) => send({ action: "select_capital", region_id: regionId }),
    [send]
  );

  const attack = useCallback(
    (sourceRegionId: string, targetRegionId: string, units: number, unitType?: string | null, escortFighters?: number) =>
      send({
        action: "attack",
        source_region_id: sourceRegionId,
        target_region_id: targetRegionId,
        units,
        unit_type: unitType,
        ...(escortFighters && escortFighters > 0 ? { escort_fighters: escortFighters } : {}),
      }),
    [send]
  );

  const move = useCallback(
    (sourceRegionId: string, targetRegionId: string, units: number, unitType?: string | null) =>
      send({
        action: "move",
        source_region_id: sourceRegionId,
        target_region_id: targetRegionId,
        units,
        unit_type: unitType,
      }),
    [send]
  );

  const bombard = useCallback(
    (sourceRegionId: string, targetRegionIds: string[], units?: number) =>
      send({
        action: "bombard",
        source_region_id: sourceRegionId,
        target_region_ids: targetRegionIds,
        unit_type: "artillery",
        ...(units != null ? { units } : {}),
      }),
    [send]
  );

  const interceptFlight = useCallback(
    (sourceRegionId: string, flightId: string, units: number) =>
      send({
        action: "intercept",
        region_id: sourceRegionId,
        target_flight_id: flightId,
        units,
      }),
    [send]
  );

  const build = useCallback(
    (regionId: string, buildingType: string) =>
      send({ action: "build", region_id: regionId, building_type: buildingType }),
    [send]
  );

  const upgradeBuilding = useCallback(
    (regionId: string, buildingType: string) =>
      send({ action: "upgrade_building", region_id: regionId, building_type: buildingType }),
    [send]
  );

  const produceUnit = useCallback(
    (regionId: string, unitType: string) =>
      send({ action: "produce_unit", region_id: regionId, unit_type: unitType }),
    [send]
  );

  const useAbility = useCallback(
    (targetRegionId: string, abilityType: string) =>
      send({ action: "use_ability", target_region_id: targetRegionId, ability_type: abilityType }),
    [send]
  );

  const sendChat = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || trimmed.length > 500) return;
      send({ action: "chat", content: trimmed });
    },
    [send]
  );

  const proposePact = useCallback(
    (targetPlayerId: string, pactType: string = "nap") =>
      send({ action: "propose_pact", target_player_id: targetPlayerId, pact_type: pactType }),
    [send]
  );

  const respondPact = useCallback(
    (proposalId: string, accept: boolean) =>
      send({ action: "respond_pact", proposal_id: proposalId, accept }),
    [send]
  );

  const proposePeace = useCallback(
    (targetPlayerId: string, conditionType: string = "status_quo", provincesToReturn?: string[]) =>
      send({ action: "propose_peace", target_player_id: targetPlayerId, condition_type: conditionType, provinces_to_return: provincesToReturn }),
    [send]
  );

  const respondPeace = useCallback(
    (proposalId: string, accept: boolean) =>
      send({ action: "respond_peace", proposal_id: proposalId, accept }),
    [send]
  );

  const breakPact = useCallback(
    (pactId: string) => send({ action: "break_pact", pact_id: pactId }),
    [send]
  );

  const declareWar = useCallback(
    (targetPlayerId: string) => send({ action: "declare_war", target_player_id: targetPlayerId }),
    [send]
  );

  const leaveMatch = useCallback(() => {
    return new Promise<boolean>((resolve) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        resolve(false);
        return;
      }

      leaveResolverRef.current = resolve;
      wsRef.current.send(JSON.stringify({ action: "leave_match" }));

      window.setTimeout(() => {
        if (leaveResolverRef.current === resolve) {
          leaveResolverRef.current = null;
          resolve(false);
        }
      }, 1500);
    });
  }, []);

  return {
    connected,
    gameState,
    events,
    matchChatMessages,
    voiceToken,
    voiceUrl,
    bannedReason,
    ping,
    diplomacy,
    selectCapital,
    attack,
    move,
    bombard,
    interceptFlight,
    build,
    upgradeBuilding,
    produceUnit,
    useAbility,
    leaveMatch,
    send,
    sendChat,
    proposePact,
    respondPact,
    proposePeace,
    respondPeace,
    breakPact,
    declareWar,
  };
}
