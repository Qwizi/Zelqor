"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createSocket, type WSMessage } from "@/lib/ws";
import { getAccessToken } from "@/lib/auth";

interface UseMatchmakingReturn {
  inQueue: boolean;
  playersInQueue: number;
  matchId: string | null;
  activeMatchId: string | null;
  fillBots: boolean;
  setFillBots: (value: boolean) => void;
  joinQueue: (gameModeSlug?: string) => void;
  leaveQueue: () => void;
}

export function useMatchmaking(): UseMatchmakingReturn {
  const [inQueue, setInQueue] = useState(false);
  const [playersInQueue, setPlayersInQueue] = useState(0);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [fillBots, setFillBots] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const fillBotsRef = useRef(fillBots);

  useEffect(() => {
    fillBotsRef.current = fillBots;
  }, [fillBots]);

  const handleMessage = useCallback((msg: WSMessage) => {
    switch (msg.type) {
      case "queue_status":
        setPlayersInQueue(msg.players_in_queue as number);
        break;
      case "match_found":
        setMatchId(msg.match_id as string);
        setActiveMatchId(msg.match_id as string);
        setInQueue(false);
        break;
      case "active_match_exists":
        setActiveMatchId(msg.match_id as string);
        setMatchId(msg.match_id as string);
        setInQueue(false);
        break;
      case "queue_left":
        setInQueue(false);
        break;
    }
  }, []);

  const joinQueue = useCallback((gameModeSlug?: string) => {
    const token = getAccessToken();
    if (!token) return;
    if (wsRef.current) return;

    const path = gameModeSlug
      ? `/matchmaking/${gameModeSlug}/`
      : `/matchmaking/`;

    const ws = createSocket(path, token, handleMessage, () => {
      setInQueue(false);
      wsRef.current = null;
    });

    ws.onopen = () => {
      setInQueue(true);
      ws.send(JSON.stringify({ action: "status" }));
      if (fillBotsRef.current) {
        ws.send(JSON.stringify({ action: "fill_bots" }));
      }
    };
    wsRef.current = ws;
  }, [handleMessage]);

  const leaveQueue = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "cancel" }));
    }
    wsRef.current?.close();
    wsRef.current = null;
    setInQueue(false);
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return { inQueue, playersInQueue, matchId, activeMatchId, fillBots, setFillBots, joinQueue, leaveQueue };
}
