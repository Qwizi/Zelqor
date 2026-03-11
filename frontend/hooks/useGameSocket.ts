"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createSocket, type WSMessage } from "@/lib/ws";
import { getAccessToken } from "@/lib/auth";

export interface GameRegion {
  name: string;
  country_code: string;
  owner_id: string | null;
  unit_count: number;
  is_capital: boolean;
  building_type: string | null;
  defense_bonus: number;
}

export interface GamePlayer {
  user_id: string;
  username: string;
  color: string;
  is_alive: boolean;
  capital_region_id: string | null;
}

export interface BuildingQueueItem {
  region_id: string;
  building_type: string;
  player_id: string;
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
  };
  players: Record<string, GamePlayer>;
  regions: Record<string, GameRegion>;
  buildings_queue: BuildingQueueItem[];
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
  attack: (sourceRegionId: string, targetRegionId: string, units: number) => void;
  move: (sourceRegionId: string, targetRegionId: string, units: number) => void;
  build: (regionId: string, buildingType: string) => void;
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
      case "game_tick":
        setGameState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            meta: {
              ...prev.meta,
              current_tick: String(msg.tick),
            },
            players: (msg.players as Record<string, GamePlayer>) || prev.players,
            regions: (msg.regions as Record<string, GameRegion>) || prev.regions,
            buildings_queue: (msg.buildings_queue as BuildingQueueItem[]) ?? prev.buildings_queue,
          };
        });
        if (msg.events) {
          setEvents((prev) => [
            ...prev.slice(-50),
            ...(msg.events as GameEvent[]),
          ]);
        }
        break;
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

    const ws = createSocket(
      `/game/${matchId}/`,
      token,
      handleMessage,
      () => setConnected(false)
    );
    ws.onopen = () => setConnected(true);
    wsRef.current = ws;

    return () => {
      ws.close();
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
    (sourceRegionId: string, targetRegionId: string, units: number) =>
      send({
        action: "attack",
        source_region_id: sourceRegionId,
        target_region_id: targetRegionId,
        units,
      }),
    [send]
  );

  const move = useCallback(
    (sourceRegionId: string, targetRegionId: string, units: number) =>
      send({
        action: "move",
        source_region_id: sourceRegionId,
        target_region_id: targetRegionId,
        units,
      }),
    [send]
  );

  const build = useCallback(
    (regionId: string, buildingType: string) =>
      send({ action: "build", region_id: regionId, building_type: buildingType }),
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
  };
}
