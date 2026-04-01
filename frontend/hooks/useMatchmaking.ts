"use client";

import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { getMatchmakingStatus, getWsTicket } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { solveChallenge } from "@/lib/pow";
import { createSocket, type WSMessage } from "@/lib/ws";

// ─── Session storage keys ────────────────────────────────────────────────────

const QUEUE_KEY = "zelqor_queue";

interface QueueSession {
  gameModeSlug: string | null;
  serverId: string | null;
  fillBots: boolean;
  instantBot: boolean;
  joinedAt: number;
  lobbyId: string | null;
}

function saveQueueSession(session: QueueSession | null) {
  if (typeof window === "undefined") return;
  if (session) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(QUEUE_KEY);
  }
}

function loadQueueSession(): QueueSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as QueueSession;
    // Expire after 5 minutes
    if (Date.now() - session.joinedAt > 5 * 60 * 1000) {
      localStorage.removeItem(QUEUE_KEY);
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
  is_banned: boolean;
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
  serverId: string | null;
  joinQueue: (gameModeSlug?: string, serverId?: string) => void;
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

const MM_CHANNEL = "zelqor:matchmaking-sync";

interface MMBroadcast {
  type: "joined" | "left" | "match_found" | "lobby_update";
  gameModeSlug?: string | null;
  matchId?: string | null;
  lobbyId?: string | null;
  lobbyPlayers?: LobbyPlayer[];
  lobbyMaxPlayers?: number;
  lobbyFull?: boolean;
  allReady?: boolean;
}

export function MatchmakingProvider({ children }: { children: ReactNode }) {
  const [inQueue, setInQueue] = useState(false);
  const [playersInQueue, setPlayersInQueue] = useState(0);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [fillBots, setFillBots] = useState(true);
  const [instantBot, setInstantBot] = useState(false);
  const [gameModeSlug, setGameModeSlug] = useState<string | null>(null);
  const [serverId, setServerId] = useState<string | null>(null);
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
  const broadcastRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      broadcastRef.current = new BroadcastChannel(MM_CHANNEL);
    }
    return () => {
      broadcastRef.current?.close();
    };
  }, []);

  const broadcast = useCallback((msg: MMBroadcast) => {
    try {
      broadcastRef.current?.postMessage(msg);
    } catch {}
  }, []);

  useEffect(() => {
    fillBotsRef.current = fillBots;
  }, [fillBots]);
  useEffect(() => {
    instantBotRef.current = instantBot;
  }, [instantBot]);

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

  // Broadcast a full state snapshot to other tabs after any WS event
  const broadcastState = useCallback(() => {
    // Use setTimeout(0) so state setters have flushed
    setTimeout(() => {
      try {
        broadcastRef.current?.postMessage({ type: "state_sync" });
      } catch {}
    }, 50);
  }, []);

  const handleMessage = useCallback(
    (msg: WSMessage) => {
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
          broadcast({ type: "match_found", matchId: msg.match_id as string });
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
          setLobbyPlayers((prev) => {
            if (prev.some((p) => p.user_id === player.user_id)) return prev;
            const updated = [...prev, player];
            setPlayersInQueue(updated.length);
            return updated;
          });
          break;
        }
        case "player_left": {
          const leftUserId = msg.user_id as string;
          setLobbyPlayers((prev) => {
            const updated = prev.filter((p) => p.user_id !== leftUserId);
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
          setLobbyPlayers((prev) => prev.map((p) => (p.user_id === readyUserId ? { ...p, is_ready: isReady } : p)));
          break;
        }
        case "lobby_full": {
          setLobbyFull(true);
          if (msg.players) {
            setLobbyPlayers(msg.players as LobbyPlayer[]);
            setPlayersInQueue((msg.players as LobbyPlayer[]).length);
          }
          // Server full_at (epoch seconds) or fallback to now
          setLobbyFullAt(msg.full_at ? (msg.full_at as number) : Date.now() / 1000);
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
          setLobbyChatMessages((prev) => [...prev.slice(-199), chatMsg]);
          break;
        }

        // Voice
        case "voice_token":
          setVoiceToken(msg.token as string);
          setVoiceUrl(msg.url as string);
          break;
      }
      // Broadcast state change to other tabs (skip chat and pong)
      if (msg.type !== "lobby_chat_message" && msg.type !== "voice_token") {
        broadcastState();
      }
    },
    [broadcastState, broadcast],
  );

  const connectToQueue = useCallback(
    async (slug: string | null, sid: string | null, fb: boolean, ib: boolean, joinedAt: number) => {
      if (!isAuthenticated()) return;
      if (wsRef.current) return;

      let ticket: string | null = null;
      let nonce: string | null = null;
      try {
        const t = await getWsTicket();
        ticket = t.ticket;
        nonce = await solveChallenge(t.challenge, t.difficulty);
      } catch {
        // Fallback: connect without ticket/pow
      }

      let path = slug ? `/matchmaking/${slug}/` : `/matchmaking/`;
      if (sid) {
        // Append server_id as query param — createSocket will add ticket/nonce params too
        path += `${path.includes("?") ? "&" : "?"}server_id=${sid}`;
      }

      const ws = createSocket(
        path,
        null,
        handleMessage,
        () => {
          setInQueue(false);
          wsRef.current = null;
        },
        ticket,
        nonce,
      );

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
    },
    [handleMessage],
  );

  const joinQueue = useCallback(
    (slug?: string, sid?: string) => {
      if (wsRef.current) return;
      const modeSlug = slug ?? null;
      const sId = sid ?? null;
      const now = Date.now();
      setGameModeSlug(modeSlug);
      setServerId(sId);
      saveQueueSession({
        gameModeSlug: modeSlug,
        serverId: sId,
        fillBots: fillBotsRef.current,
        instantBot: instantBotRef.current,
        joinedAt: now,
        lobbyId: null,
      });
      connectToQueue(modeSlug, sId, fillBotsRef.current, instantBotRef.current, now);
      broadcast({ type: "joined", gameModeSlug: modeSlug });
    },
    [connectToQueue, broadcast],
  );

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
    broadcast({ type: "left" });
  }, [broadcast]);

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

  // Auto-reconnect on mount: API is source of truth; localStorage is a fast same-browser cache.
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // Fast path: try localStorage first so we can start connecting immediately
      const localSession = loadQueueSession();

      if (isAuthenticated()) {
        try {
          const status = await getMatchmakingStatus();

          if (cancelled) return;

          if (status.state === "in_match" && status.match_id) {
            setActiveMatchId(status.match_id);
            setMatchId(status.match_id);
            saveQueueSession(null);
            return;
          }

          if (status.state === "in_lobby" || status.state === "in_queue") {
            const slug = status.game_mode_slug ?? null;
            const joinedAt = status.joined_at
              ? new Date(status.joined_at).getTime()
              : (localSession?.joinedAt ?? Date.now());
            const fb = localSession?.fillBots ?? true;
            const ib = localSession?.instantBot ?? false;

            setGameModeSlug(slug);
            setFillBots(fb);
            setInstantBot(ib);

            if (status.state === "in_lobby") {
              const lid = status.lobby_id ?? localSession?.lobbyId ?? null;
              if (lid) setLobbyId(lid);
              if (status.players) {
                setLobbyPlayers(status.players.map((p) => ({ ...p, is_banned: false })));
                setPlayersInQueue(status.players.length);
              }
              if (status.max_players) setLobbyMaxPlayers(status.max_players);
            }

            if (!wsRef.current) {
              connectToQueue(slug, localSession?.serverId ?? null, fb, ib, joinedAt);
            }
            return;
          }

          // state === "idle" — nothing to restore
          saveQueueSession(null);
          return;
        } catch {
          // API unavailable — fall through to localStorage
        }
      }

      // Fallback: same-browser localStorage session (no token or API error)
      if (localSession && !cancelled) {
        setFillBots(localSession.fillBots);
        setInstantBot(localSession.instantBot);
        setGameModeSlug(localSession.gameModeSlug);
        if (localSession.lobbyId) setLobbyId(localSession.lobbyId);
        connectToQueue(
          localSession.gameModeSlug,
          localSession.serverId ?? null,
          localSession.fillBots,
          localSession.instantBot,
          localSession.joinedAt,
        );
      }
    };

    init();

    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectToQueue]);

  // Cross-tab sync: when another tab broadcasts a state change, re-fetch status from API
  useEffect(() => {
    const ch = broadcastRef.current;
    if (!ch) return;
    const handler = async (event: MessageEvent) => {
      const data = event.data as MMBroadcast;
      if (data.type === "match_found" && data.matchId) {
        setActiveMatchId(data.matchId);
        setMatchId(data.matchId);
        setInQueue(false);
        setLobbyId(null);
        setLobbyPlayers([]);
        saveQueueSession(null);
        return;
      }
      if (data.type === "left") {
        // Other tab left queue — if we have our own WS, close it too
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
        setInQueue(false);
        setLobbyId(null);
        setLobbyPlayers([]);
        setLobbyFull(false);
        setAllReady(false);
        setLobbyFullAt(null);
        saveQueueSession(null);
        return;
      }
      // For "joined" or "lobby_update" or "state_sync" — re-fetch from API
      if (!isAuthenticated()) return;
      try {
        const status = await getMatchmakingStatus();
        if (status.state === "in_match" && status.match_id) {
          setActiveMatchId(status.match_id);
          setMatchId(status.match_id);
          setInQueue(false);
          saveQueueSession(null);
        } else if (status.state === "in_lobby" || status.state === "in_queue") {
          setInQueue(true);
          setGameModeSlug(status.game_mode_slug ?? null);
          if (status.state === "in_lobby") {
            if (status.lobby_id) setLobbyId(status.lobby_id);
            if (status.players) {
              setLobbyPlayers(status.players.map((p) => ({ ...p, is_banned: false })));
              setPlayersInQueue(status.players.length);
            }
            if (status.max_players) setLobbyMaxPlayers(status.max_players);
          }
          // Connect WS if not connected
          if (!wsRef.current) {
            connectToQueue(status.game_mode_slug ?? null, null, fillBotsRef.current, instantBotRef.current, Date.now());
          }
        } else {
          setInQueue(false);
          setLobbyId(null);
          setLobbyPlayers([]);
          saveQueueSession(null);
        }
      } catch {
        // API unavailable — ignore
      }
    };
    ch.onmessage = handler;
  }, [connectToQueue]);

  const value: MatchmakingContextValue = {
    inQueue,
    playersInQueue,
    matchId,
    activeMatchId,
    queueSeconds,
    gameModeSlug,
    serverId,
    fillBots,
    setFillBots,
    instantBot,
    setInstantBot,
    joinQueue,
    leaveQueue,
    lobbyId,
    lobbyMaxPlayers,
    lobbyPlayers,
    lobbyFull,
    allReady,
    setReady,
    lobbyChatMessages,
    sendLobbyChat,
    voiceToken,
    voiceUrl,
    readyCountdown,
  };

  return createElement(MatchmakingContext.Provider, { value }, children);
}
