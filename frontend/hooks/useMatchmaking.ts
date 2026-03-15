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
  joinedAt: number;
  lobbyId: string | null;
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

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LobbyPlayer {
  user_id: string;
  username: string;
  is_bot: boolean;
  is_ready: boolean;
}

export interface LobbyChatMessage {
  user_id: string;
  username: string;
  content: string;
  timestamp: number;
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
  // Lobby state
  lobbyId: string | null;
  lobbyMaxPlayers: number;
  lobbyPlayers: LobbyPlayer[];
  lobbyFull: boolean;
  allReady: boolean;
  setReady: () => void;
  // Lobby chat
  lobbyChatMessages: LobbyChatMessage[];
  sendLobbyChat: (content: string) => void;
  // Voice
  voiceToken: string | null;
  voiceUrl: string | null;
  // Ready timeout
  readyCountdown: number | null;
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

  // Lobby state
  const [lobbyId, setLobbyId] = useState<string | null>(null);
  const [lobbyMaxPlayers, setLobbyMaxPlayers] = useState(2);
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  const [lobbyFull, setLobbyFull] = useState(false);
  const [allReady, setAllReady] = useState(false);
  const [lobbyChatMessages, setLobbyChatMessages] = useState<LobbyChatMessage[]>([]);
  const [voiceToken, setVoiceToken] = useState<string | null>(null);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [readyCountdown, setReadyCountdown] = useState<number | null>(null);
  // Server timestamp (epoch seconds) when lobby became full
  const [lobbyFullAt, setLobbyFullAt] = useState<number | null>(null);

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

  // Ready countdown — computed from server-provided full_at timestamp.
  // Backend handles the actual timeout (Celery kicks unready players after 2 min).
  // 120s real timeout + 30s buffer for Celery interval
  const READY_TIMEOUT_SECS = 150;

  useEffect(() => {
    if (!lobbyFull || allReady || !lobbyFullAt) {
      setReadyCountdown(null);
      return;
    }
    const id = setInterval(() => {
      const elapsed = Math.floor(Date.now() / 1000 - lobbyFullAt);
      const remaining = Math.max(0, READY_TIMEOUT_SECS - elapsed);
      setReadyCountdown(remaining);
    }, 500);
    return () => clearInterval(id);
  }, [lobbyFull, allReady, lobbyFullAt]);

  const handleMessage = useCallback((msg: WSMessage) => {
    switch (msg.type) {
      // Legacy
      case "queue_status":
        setPlayersInQueue(msg.players_in_queue as number);
        break;
      case "match_found":
        setMatchId(msg.match_id as string);
        setActiveMatchId(msg.match_id as string);
        setInQueue(false);
        setLobbyId(null);
        setLobbyPlayers([]);
        setLobbyFull(false);
        setAllReady(false);
        setLobbyFullAt(null);
        setLobbyChatMessages([]);
        setVoiceToken(null);
        setVoiceUrl(null);
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
        setLobbyId(null);
        setLobbyPlayers([]);
        setLobbyFull(false);
        setAllReady(false);
        setLobbyFullAt(null);
        saveQueueSession(null);
        break;

      // Lobby messages
      case "lobby_created": {
        const lid = msg.lobby_id as string;
        const players = msg.players as LobbyPlayer[];
        const mp = (msg.max_players as number) || 2;
        setLobbyId(lid);
        setLobbyMaxPlayers(mp);
        setLobbyPlayers(players);
        setPlayersInQueue(players.length);
        // Reset full/ready state if lobby is no longer full
        if (players.length < mp) {
          setLobbyFull(false);
          setAllReady(false);
          setLobbyFullAt(null);
        }
        // Sync timer from server created_at
        if (msg.created_at) {
          setQueueJoinedAt(Math.floor((msg.created_at as number) * 1000));
        }
        // Save lobbyId to session for reconnect
        const session = loadQueueSession();
        if (session) {
          session.lobbyId = lid;
          saveQueueSession(session);
        }
        break;
      }
      case "player_joined": {
        const player = msg.player as LobbyPlayer;
        setLobbyPlayers(prev => {
          if (prev.some(p => p.user_id === player.user_id)) return prev;
          const updated = [...prev, player];
          setPlayersInQueue(updated.length);
          return updated;
        });
        break;
      }
      case "player_left": {
        const leftUserId = msg.user_id as string;
        setLobbyPlayers(prev => {
          const updated = prev.filter(p => p.user_id !== leftUserId);
          setPlayersInQueue(updated.length);
          return updated;
        });
        setLobbyFull(false);
        setAllReady(false);
        setLobbyFullAt(null);
        break;
      }
      case "player_ready": {
        const readyUserId = msg.user_id as string;
        const isReady = msg.is_ready as boolean;
        setLobbyPlayers(prev =>
          prev.map(p => p.user_id === readyUserId ? { ...p, is_ready: isReady } : p)
        );
        break;
      }
      case "lobby_full": {
        setLobbyFull(true);
        if (msg.players) {
          setLobbyPlayers(msg.players as LobbyPlayer[]);
          setPlayersInQueue((msg.players as LobbyPlayer[]).length);
        }
        if (msg.full_at) {
          setLobbyFullAt(msg.full_at as number);
        }
        break;
      }
      case "all_ready":
        setAllReady(true);
        break;
      case "match_starting":
        setMatchId(msg.match_id as string);
        setActiveMatchId(msg.match_id as string);
        setInQueue(false);
        setLobbyId(null);
        setLobbyPlayers([]);
        setLobbyFull(false);
        setAllReady(false);
        setLobbyFullAt(null);
        setLobbyChatMessages([]);
        setVoiceToken(null);
        setVoiceUrl(null);
        saveQueueSession(null);
        break;
      case "lobby_cancelled":
        setInQueue(false);
        setLobbyId(null);
        setLobbyPlayers([]);
        setLobbyFull(false);
        setAllReady(false);
        setLobbyFullAt(null);
        setLobbyChatMessages([]);
        setVoiceToken(null);
        setVoiceUrl(null);
        saveQueueSession(null);
        break;

      // Lobby chat
      case "lobby_chat_message": {
        const chatMsg: LobbyChatMessage = {
          user_id: msg.user_id as string,
          username: msg.username as string,
          content: msg.content as string,
          timestamp: msg.timestamp as number,
        };
        setLobbyChatMessages(prev => [...prev.slice(-199), chatMsg]);
        break;
      }

      // Voice
      case "voice_token":
        setVoiceToken(msg.token as string);
        setVoiceUrl(msg.url as string);
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
      lobbyId: null,
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
    setLobbyId(null);
    setLobbyPlayers([]);
    setLobbyFull(false);
    setAllReady(false);
    setLobbyFullAt(null);
    setLobbyChatMessages([]);
    setVoiceToken(null);
    setVoiceUrl(null);
    saveQueueSession(null);
  }, []);

  const setReady = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "ready" }));
    }
  }, []);

  const sendLobbyChat = useCallback((content: string) => {
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 500) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "chat_message", content: trimmed }));
    }
  }, []);

  // Auto-reconnect from session on mount
  useEffect(() => {
    const session = loadQueueSession();
    if (session) {
      setFillBots(session.fillBots);
      setInstantBot(session.instantBot);
      setGameModeSlug(session.gameModeSlug);
      if (session.lobbyId) {
        setLobbyId(session.lobbyId);
      }
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
    lobbyId, lobbyMaxPlayers, lobbyPlayers, lobbyFull, allReady, setReady,
    lobbyChatMessages, sendLobbyChat, voiceToken, voiceUrl, readyCountdown,
  };

  return createElement(MatchmakingContext.Provider, { value }, children);
}
