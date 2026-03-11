"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createSocket, type WSMessage } from "@/lib/ws";
import { getAccessToken } from "@/lib/auth";

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
  defense_bonus: number;
  vision_range?: number;
  unit_generation_bonus?: number;
  currency_generation_bonus?: number;
}

export interface GamePlayer {
  user_id: string;
  username: string;
  color: string;
  is_alive: boolean;
  capital_region_id: string | null;
  currency: number;
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

export interface GameState {
  meta: {
    status: string;
    current_tick: string;
    tick_interval_ms: string;
    max_players: string;
    min_capital_distance: string;
    capital_selection_time_seconds?: string;
    capital_selection_ends_at?: string;
  };
  players: Record<string, GamePlayer>;
  regions: Record<string, GameRegion>;
  buildings_queue: BuildingQueueItem[];
  unit_queue: UnitQueueItem[];
  transit_queue?: Array<Record<string, unknown>>;
}

export interface GameEvent {
  type: string;
  [key: string]: unknown;
}

interface UseGameSocketReturn {
  connected: boolean;
  gameState: GameState | null;
  events: GameEvent[];
  selectCapital: (regionId: string) => void;
  attack: (sourceRegionId: string, targetRegionId: string, units: number, unitType?: string | null) => void;
  move: (sourceRegionId: string, targetRegionId: string, units: number, unitType?: string | null) => void;
  build: (regionId: string, buildingType: string) => void;
  produceUnit: (regionId: string, unitType: string) => void;
}

export function useGameSocket(matchId: string): UseGameSocketReturn {
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const handleMessage = useCallback((msg: WSMessage) => {
    switch (msg.type) {
      case "game_state":
        setGameState(msg.state as GameState);
        break;
      case "game_tick": {
        const tickEvents = (msg.events as GameEvent[]) || [];
        const isGameOver = tickEvents.some((e) => e.type === "game_over");
        setGameState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            meta: {
              ...prev.meta,
              current_tick: String(msg.tick),
              ...(isGameOver ? { status: "finished" } : {}),
            },
            players: (msg.players as Record<string, GamePlayer>) || prev.players,
            regions: msg.regions
              ? { ...prev.regions, ...(msg.regions as Record<string, GameRegion>) }
              : prev.regions,
            buildings_queue: (msg.buildings_queue as BuildingQueueItem[]) ?? prev.buildings_queue,
            unit_queue: (msg.unit_queue as UnitQueueItem[]) ?? prev.unit_queue,
            transit_queue: (msg.transit_queue as Array<Record<string, unknown>>) ?? prev.transit_queue,
          };
        });
        if (tickEvents.length > 0) {
          setEvents((prev) => [...prev.slice(-50), ...tickEvents]);
        }
        break;
      }
      case "capital_selected":
        setGameState((prev) => {
          if (!prev) return prev;
          return { ...prev };
        });
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
          { type: "server_error", message: msg.message as string },
        ]);
        break;
    }
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token || !matchId) return;

    let disposed = false;
    const ws = createSocket(
      `/game/${matchId}/`,
      token,
      handleMessage,
      () => {
        if (!disposed) {
          setConnected(false);
        }
      }
    );
    ws.onopen = () => {
      if (disposed) {
        ws.close(1000, "component_disposed");
        return;
      }
      setConnected(true);
    };
    wsRef.current = ws;

    return () => {
      disposed = true;
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      if (ws.readyState === WebSocket.OPEN) {
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
    (sourceRegionId: string, targetRegionId: string, units: number, unitType?: string | null) =>
      send({
        action: "attack",
        source_region_id: sourceRegionId,
        target_region_id: targetRegionId,
        units,
        unit_type: unitType,
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

  const build = useCallback(
    (regionId: string, buildingType: string) =>
      send({ action: "build", region_id: regionId, building_type: buildingType }),
    [send]
  );

  const produceUnit = useCallback(
    (regionId: string, unitType: string) =>
      send({ action: "produce_unit", region_id: regionId, unit_type: unitType }),
    [send]
  );

  return {
    connected,
    gameState,
    events,
    selectCapital,
    attack,
    move,
    build,
    produceUnit,
  };
}
