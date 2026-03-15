"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { createElement } from "react";
import { createSocket, type WSMessage } from "@/lib/ws";
import { getAccessToken } from "@/lib/auth";

// ─── Session storage keys ────────────────────────────────────────────────────

const QUEUE_KEY = "maplord_queue";

interface QueueSession {
  gameModeSlug: string | null;
  fillBots: boolean;
  instantBot: boolean;
  joinedAt: number; // timestamp
}

function saveQueueSession(session: QueueSession | null) {
  if (typeof window === "undefined") return;
  if (session) {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(session));
  } else {
    sessionStorage.removeItem(QUEUE_KEY);
  }
}

function loadQueueSession(): QueueSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(QUEUE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as QueueSession;
    // Expire after 5 minutes
    if (Date.now() - session.joinedAt > 5 * 60 * 1000) {
      sessionStorage.removeItem(QUEUE_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface MatchmakingContextValue {
  inQueue: boolean;
  playersInQueue: number;
  matchId: string | null;
  activeMatchId: string | null;
  queueSeconds: number;
  gameModeSlug: string | null;
  fillBots: boolean;
  setFillBots: (value: boolean) => void;
  instantBot: boolean;
  setInstantBot: (value: boolean) => void;
  joinQueue: (gameModeSlug?: string) => void;
  leaveQueue: () => void;
}

const MatchmakingContext = createContext<MatchmakingContextValue | null>(null);

export function useMatchmaking(): MatchmakingContextValue {
  const ctx = useContext(MatchmakingContext);
  if (!ctx) throw new Error("useMatchmaking must be used within MatchmakingProvider");
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function MatchmakingProvider({ children }: { children: ReactNode }) {
  const [inQueue, setInQueue] = useState(false);
  const [playersInQueue, setPlayersInQueue] = useState(0);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [fillBots, setFillBots] = useState(true);
  const [instantBot, setInstantBot] = useState(false);
  const [gameModeSlug, setGameModeSlug] = useState<string | null>(null);
  const [queueSeconds, setQueueSeconds] = useState(0);
  const [queueJoinedAt, setQueueJoinedAt] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const fillBotsRef = useRef(fillBots);
  const instantBotRef = useRef(instantBot);

  useEffect(() => { fillBotsRef.current = fillBots; }, [fillBots]);
  useEffect(() => { instantBotRef.current = instantBot; }, [instantBot]);

  // Queue timer
  useEffect(() => {
    if (!inQueue || !queueJoinedAt) return;
    const id = setInterval(() => {
      setQueueSeconds(Math.floor((Date.now() - queueJoinedAt) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [inQueue, queueJoinedAt]);

  // Reset timer when leaving queue
  useEffect(() => {
    if (!inQueue) setQueueSeconds(0);
  }, [inQueue]);

  const handleMessage = useCallback((msg: WSMessage) => {
    switch (msg.type) {
      case "queue_status":
        setPlayersInQueue(msg.players_in_queue as number);
        break;
      case "match_found":
        setMatchId(msg.match_id as string);
        setActiveMatchId(msg.match_id as string);
        setInQueue(false);
        saveQueueSession(null);
        break;
      case "active_match_exists":
        setActiveMatchId(msg.match_id as string);
        setMatchId(msg.match_id as string);
        setInQueue(false);
        saveQueueSession(null);
        break;
      case "queue_left":
        setInQueue(false);
        saveQueueSession(null);
        break;
    }
  }, []);

  const connectToQueue = useCallback((slug: string | null, fb: boolean, ib: boolean, joinedAt: number) => {
    const token = getAccessToken();
    if (!token) return;
    if (wsRef.current) return;

    const path = slug ? `/matchmaking/${slug}/` : `/matchmaking/`;

    const ws = createSocket(path, token, handleMessage, () => {
      setInQueue(false);
      wsRef.current = null;
      // Don't clear session on disconnect — might be temporary
    });

    ws.onopen = () => {
      setInQueue(true);
      setQueueJoinedAt(joinedAt);
      ws.send(JSON.stringify({ action: "status" }));
      if (ib) {
        ws.send(JSON.stringify({ action: "instant_bot" }));
      } else if (fb) {
        ws.send(JSON.stringify({ action: "fill_bots" }));
      }
    };
    wsRef.current = ws;
  }, [handleMessage]);

  const joinQueue = useCallback((slug?: string) => {
    if (wsRef.current) return;
    const modeSlug = slug ?? null;
    const now = Date.now();
    setGameModeSlug(modeSlug);
    saveQueueSession({
      gameModeSlug: modeSlug,
      fillBots: fillBotsRef.current,
      instantBot: instantBotRef.current,
      joinedAt: now,
    });
    connectToQueue(modeSlug, fillBotsRef.current, instantBotRef.current, now);
  }, [connectToQueue]);

  const leaveQueue = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "cancel" }));
    }
    wsRef.current?.close();
    wsRef.current = null;
    setInQueue(false);
    saveQueueSession(null);
  }, []);

  // Auto-reconnect from session on mount
  useEffect(() => {
    const session = loadQueueSession();
    if (session) {
      setFillBots(session.fillBots);
      setInstantBot(session.instantBot);
      setGameModeSlug(session.gameModeSlug);
      connectToQueue(session.gameModeSlug, session.fillBots, session.instantBot, session.joinedAt);
    }
    return () => {
      wsRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: MatchmakingContextValue = {
    inQueue, playersInQueue, matchId, activeMatchId, queueSeconds, gameModeSlug,
    fillBots, setFillBots, instantBot, setInstantBot, joinQueue, leaveQueue,
  };

  return createElement(MatchmakingContext.Provider, { value }, children);
}
