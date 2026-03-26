import { act, renderHook } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------

const OPEN = 1;

class MockWebSocket {
  static OPEN = OPEN;
  url: string;
  readyState = OPEN;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  static instances: MockWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    Promise.resolve().then(() => this.onopen?.());
  }

  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }

  simulateMessage(data: unknown) {
    const event = new MessageEvent("message", { data: JSON.stringify(data) });
    this.onmessage?.(event);
  }

  simulateClose(code = 1000) {
    const event = new CloseEvent("close", { code });
    this.onclose?.(event);
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);

// ---------------------------------------------------------------------------
// Dependency mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  isAuthenticated: vi.fn(() => true),
  setAuthenticated: vi.fn(),
  getAccessToken: vi.fn(() => null),
  getRefreshToken: vi.fn(() => null),
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
  isLoggedIn: vi.fn(() => true),
}));

vi.mock("@/lib/api", () => ({
  getWsTicket: vi.fn().mockRejectedValue(new Error("no ticket")),
  getMatchmakingStatus: vi.fn().mockResolvedValue({ state: "idle" }),
}));

vi.mock("@/lib/pow", () => ({
  solveChallenge: vi.fn().mockResolvedValue("nonce"),
}));

// ---------------------------------------------------------------------------
// Import provider + hook after mocks
// ---------------------------------------------------------------------------
import { getMatchmakingStatus } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { MatchmakingProvider, useMatchmaking } from "../useMatchmaking";

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(MatchmakingProvider, null, children);
}

function getLastWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useMatchmaking", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("throws when used outside MatchmakingProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useMatchmaking())).toThrow("useMatchmaking must be used within MatchmakingProvider");
    spy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it("has correct initial state", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    expect(result.current.inQueue).toBe(false);
    expect(result.current.playersInQueue).toBe(0);
    expect(result.current.matchId).toBeNull();
    expect(result.current.activeMatchId).toBeNull();
    expect(result.current.lobbyId).toBeNull();
    expect(result.current.lobbyPlayers).toEqual([]);
    expect(result.current.lobbyFull).toBe(false);
    expect(result.current.allReady).toBe(false);
    expect(result.current.readyCountdown).toBeNull();
  });

  // -------------------------------------------------------------------------
  // joinQueue
  // -------------------------------------------------------------------------

  it("joinQueue() creates a WebSocket connection", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    const countBefore = MockWebSocket.instances.length;

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(MockWebSocket.instances.length).toBeGreaterThan(countBefore);
  });

  it("joinQueue() sets inQueue=true when socket opens", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.inQueue).toBe(true);
  });

  it("joinQueue() sends status action on open", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const sentMessages = getLastWs().sent.map((s) => JSON.parse(s));
    expect(sentMessages.some((m) => m.action === "status")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // leaveQueue
  // -------------------------------------------------------------------------

  it("leaveQueue() sets inQueue=false and clears lobby state", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.inQueue).toBe(true);

    act(() => {
      result.current.leaveQueue();
    });

    expect(result.current.inQueue).toBe(false);
    expect(result.current.lobbyId).toBeNull();
    expect(result.current.lobbyPlayers).toEqual([]);
    expect(result.current.lobbyFull).toBe(false);
  });

  it("leaveQueue() sends cancel action before closing", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const ws = getLastWs();
    ws.readyState = OPEN;

    act(() => {
      result.current.leaveQueue();
    });

    const sentMessages = ws.sent.map((s) => JSON.parse(s));
    expect(sentMessages.some((m) => m.action === "cancel")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Server messages — queue_status
  // -------------------------------------------------------------------------

  it("queue_status message updates playersInQueue", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "queue_status", players_in_queue: 7 });
    });

    expect(result.current.playersInQueue).toBe(7);
  });

  // -------------------------------------------------------------------------
  // Server messages — match_found
  // -------------------------------------------------------------------------

  it("match_found message sets matchId and clears queue state", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "match_found", match_id: "match-99" });
    });

    expect(result.current.matchId).toBe("match-99");
    expect(result.current.activeMatchId).toBe("match-99");
    expect(result.current.inQueue).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Server messages — lobby_created / lobby_full / all_ready
  // -------------------------------------------------------------------------

  it("lobby_created sets lobbyId and lobbyPlayers", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({
        type: "lobby_created",
        lobby_id: "lobby-42",
        max_players: 2,
        players: [{ user_id: "u1", username: "Alice", is_bot: false, is_ready: false, is_banned: false }],
        created_at: Date.now() / 1000,
      });
    });

    expect(result.current.lobbyId).toBe("lobby-42");
    expect(result.current.lobbyPlayers).toHaveLength(1);
    expect(result.current.lobbyMaxPlayers).toBe(2);
  });

  it("lobby_full sets lobbyFull=true", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({
        type: "lobby_full",
        full_at: Date.now() / 1000,
        players: [
          { user_id: "u1", username: "Alice", is_bot: false, is_ready: false, is_banned: false },
          { user_id: "u2", username: "Bob", is_bot: false, is_ready: false, is_banned: false },
        ],
      });
    });

    expect(result.current.lobbyFull).toBe(true);
  });

  it("all_ready message sets allReady=true", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "all_ready" });
    });

    expect(result.current.allReady).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Server messages — lobby_cancelled
  // -------------------------------------------------------------------------

  it("lobby_cancelled resets all lobby state", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Set some lobby state first
    act(() => {
      getLastWs().simulateMessage({
        type: "lobby_created",
        lobby_id: "lobby-1",
        max_players: 2,
        players: [{ user_id: "u1", username: "Alice", is_bot: false, is_ready: false, is_banned: false }],
        created_at: Date.now() / 1000,
      });
    });

    act(() => {
      getLastWs().simulateMessage({ type: "lobby_cancelled" });
    });

    expect(result.current.inQueue).toBe(false);
    expect(result.current.lobbyId).toBeNull();
    expect(result.current.lobbyPlayers).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // queue_left
  // -------------------------------------------------------------------------

  it("queue_left message sets inQueue=false", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "queue_left" });
    });

    expect(result.current.inQueue).toBe(false);
  });

  // -------------------------------------------------------------------------
  // voice_token
  // -------------------------------------------------------------------------

  it("voice_token message sets voiceToken and voiceUrl", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "voice_token", token: "vt-xyz", url: "wss://voice.test" });
    });

    expect(result.current.voiceToken).toBe("vt-xyz");
    expect(result.current.voiceUrl).toBe("wss://voice.test");
  });

  // -------------------------------------------------------------------------
  // fillBots / instantBot flags
  // -------------------------------------------------------------------------

  it("fillBots defaults to true", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});
    expect(result.current.fillBots).toBe(true);
  });

  it("setFillBots() updates fillBots flag", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.setFillBots(false);
    });

    expect(result.current.fillBots).toBe(false);
  });

  it("instantBot defaults to false", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});
    expect(result.current.instantBot).toBe(false);
  });

  it("setInstantBot() updates instantBot flag", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.setInstantBot(true);
    });

    expect(result.current.instantBot).toBe(true);
  });

  it("joinQueue() sends instant_bot action on open when instantBot=true", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.setInstantBot(true);
    });

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const sent = getLastWs().sent.map((s) => JSON.parse(s));
    expect(sent.some((m) => m.action === "instant_bot")).toBe(true);
  });

  it("joinQueue() sends fill_bots action on open when fillBots=true and instantBot=false", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    // fillBots is true by default, instantBot=false
    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const sent = getLastWs().sent.map((s) => JSON.parse(s));
    expect(sent.some((m) => m.action === "fill_bots")).toBe(true);
    expect(sent.some((m) => m.action === "instant_bot")).toBe(false);
  });

  it("joinQueue() does not send fill_bots or instant_bot when both are false", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.setFillBots(false);
    });
    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const sent = getLastWs().sent.map((s) => JSON.parse(s));
    expect(sent.some((m) => m.action === "fill_bots")).toBe(false);
    expect(sent.some((m) => m.action === "instant_bot")).toBe(false);
  });

  it("joinQueue() with a game mode slug uses slug-specific WebSocket path", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue("ranked");
    });
    await act(async () => {
      await Promise.resolve();
    });

    const ws = getLastWs();
    expect(ws.url).toContain("ranked");
    expect(result.current.gameModeSlug).toBe("ranked");
  });

  // -------------------------------------------------------------------------
  // setReady / confirmReady
  // -------------------------------------------------------------------------

  it("setReady() sends ready action when connected", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.setReady();
    });

    const sent = getLastWs().sent.map((s) => JSON.parse(s));
    expect(sent.some((m) => m.action === "ready")).toBe(true);
  });

  it("setReady() is a no-op when not connected", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    // No joinQueue — wsRef is null
    act(() => {
      result.current.setReady();
    });

    // No WebSocket created by setReady alone
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // sendLobbyChat
  // -------------------------------------------------------------------------

  it("sendLobbyChat() sends a trimmed chat_message action", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.sendLobbyChat("  hello lobby  ");
    });

    const sent = getLastWs().sent.map((s) => JSON.parse(s));
    const chatMsg = sent.find((m) => m.action === "chat_message");
    expect(chatMsg).toBeDefined();
    expect(chatMsg.content).toBe("hello lobby");
  });

  it("sendLobbyChat() ignores empty content", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const ws = getLastWs();
    const countBefore = ws.sent.length;

    act(() => {
      result.current.sendLobbyChat("   ");
    });

    expect(ws.sent.length).toBe(countBefore);
  });

  it("sendLobbyChat() ignores content over 500 characters", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const ws = getLastWs();
    const countBefore = ws.sent.length;

    act(() => {
      result.current.sendLobbyChat("x".repeat(501));
    });

    expect(ws.sent.length).toBe(countBefore);
  });

  // -------------------------------------------------------------------------
  // Lobby chat messages
  // -------------------------------------------------------------------------

  it("lobby_chat_message adds to lobbyChatMessages", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({
        type: "lobby_chat_message",
        user_id: "u1",
        username: "Alice",
        content: "Hello lobby!",
        timestamp: 1000,
      });
    });

    expect(result.current.lobbyChatMessages).toHaveLength(1);
    expect(result.current.lobbyChatMessages[0].content).toBe("Hello lobby!");
  });

  // -------------------------------------------------------------------------
  // player_joined / player_left / player_ready
  // -------------------------------------------------------------------------

  it("player_joined message adds a player to lobbyPlayers", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({
        type: "player_joined",
        player: { user_id: "u2", username: "Bob", is_bot: false, is_ready: false, is_banned: false },
      });
    });

    expect(result.current.lobbyPlayers).toHaveLength(1);
    expect(result.current.lobbyPlayers[0].username).toBe("Bob");
    expect(result.current.playersInQueue).toBe(1);
  });

  it("player_joined does not add duplicate players", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const player = { user_id: "u2", username: "Bob", is_bot: false, is_ready: false, is_banned: false };

    act(() => {
      getLastWs().simulateMessage({ type: "player_joined", player });
    });
    act(() => {
      getLastWs().simulateMessage({ type: "player_joined", player });
    });

    expect(result.current.lobbyPlayers).toHaveLength(1);
  });

  it("player_left message removes the player", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({
        type: "player_joined",
        player: { user_id: "u2", username: "Bob", is_bot: false, is_ready: false, is_banned: false },
      });
    });
    act(() => {
      getLastWs().simulateMessage({ type: "player_left", user_id: "u2" });
    });

    expect(result.current.lobbyPlayers).toHaveLength(0);
    expect(result.current.lobbyFull).toBe(false);
    expect(result.current.allReady).toBe(false);
  });

  it("player_ready message updates player ready state", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({
        type: "player_joined",
        player: { user_id: "u2", username: "Bob", is_bot: false, is_ready: false, is_banned: false },
      });
    });
    act(() => {
      getLastWs().simulateMessage({ type: "player_ready", user_id: "u2", is_ready: true });
    });

    expect(result.current.lobbyPlayers[0].is_ready).toBe(true);
  });

  // -------------------------------------------------------------------------
  // active_match_exists
  // -------------------------------------------------------------------------

  it("active_match_exists message sets activeMatchId", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "active_match_exists", match_id: "match-existing" });
    });

    expect(result.current.activeMatchId).toBe("match-existing");
    expect(result.current.matchId).toBe("match-existing");
    expect(result.current.inQueue).toBe(false);
  });

  // -------------------------------------------------------------------------
  // match_starting message
  // -------------------------------------------------------------------------

  it("match_starting message sets matchId and clears lobby state", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({
        type: "lobby_created",
        lobby_id: "lobby-1",
        max_players: 2,
        players: [{ user_id: "u1", username: "Alice", is_bot: false, is_ready: true, is_banned: false }],
        created_at: Date.now() / 1000,
      });
    });

    act(() => {
      getLastWs().simulateMessage({ type: "match_starting", match_id: "match-start-99" });
    });

    expect(result.current.matchId).toBe("match-start-99");
    expect(result.current.activeMatchId).toBe("match-start-99");
    expect(result.current.inQueue).toBe(false);
    expect(result.current.lobbyId).toBeNull();
    expect(result.current.lobbyPlayers).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Ready countdown
  // -------------------------------------------------------------------------

  it("readyCountdown starts counting when lobby is full and not all ready", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const now = Date.now() / 1000;
    act(() => {
      getLastWs().simulateMessage({
        type: "lobby_full",
        full_at: now,
        players: [
          { user_id: "u1", username: "Alice", is_bot: false, is_ready: false, is_banned: false },
          { user_id: "u2", username: "Bob", is_bot: false, is_ready: false, is_banned: false },
        ],
      });
    });

    // Advance 500ms to trigger interval
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.readyCountdown).not.toBeNull();
    expect(result.current.readyCountdown).toBeGreaterThan(0);
  });

  it("readyCountdown is null when allReady=true", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const now = Date.now() / 1000;
    act(() => {
      getLastWs().simulateMessage({
        type: "lobby_full",
        full_at: now,
        players: [],
      });
    });

    act(() => {
      getLastWs().simulateMessage({ type: "all_ready" });
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.readyCountdown).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Queue timer
  // -------------------------------------------------------------------------

  it("queueSeconds increments over time while in queue", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.queueSeconds).toBe(0);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.queueSeconds).toBeGreaterThanOrEqual(1);
  });

  it("queueSeconds resets to 0 after leaving queue", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    act(() => {
      result.current.leaveQueue();
    });

    expect(result.current.queueSeconds).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Session persistence (localStorage)
  // -------------------------------------------------------------------------

  it("joinQueue() saves session to localStorage", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue("ranked");
    });
    await act(async () => {
      await Promise.resolve();
    });

    const raw = localStorage.getItem("maplord_queue");
    expect(raw).not.toBeNull();
    const session = JSON.parse(raw!);
    expect(session.gameModeSlug).toBe("ranked");
  });

  it("leaveQueue() clears session from localStorage", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.leaveQueue();
    });

    expect(localStorage.getItem("maplord_queue")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Reconnect after disconnect (onClose sets inQueue=false)
  // -------------------------------------------------------------------------

  it("WebSocket close sets inQueue=false", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.inQueue).toBe(true);

    act(() => {
      getLastWs().simulateClose();
    });

    expect(result.current.inQueue).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Auto-reconnect on mount: in_match state from API
  // -------------------------------------------------------------------------

  it("restores activeMatchId from API when state is in_match on mount", async () => {
    // Override getMatchmakingStatus for this test
    vi.mocked(getMatchmakingStatus).mockResolvedValueOnce({
      state: "in_match",
      match_id: "match-restored",
    });

    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.activeMatchId).toBe("match-restored");
    expect(result.current.matchId).toBe("match-restored");
  });

  // -------------------------------------------------------------------------
  // Auto-reconnect on mount: in_queue / in_lobby state (lines 497-522)
  // -------------------------------------------------------------------------

  it("reconnects to queue when API reports in_queue on mount (lines 497-522)", async () => {
    vi.mocked(getMatchmakingStatus).mockResolvedValueOnce({
      state: "in_queue",
      game_mode_slug: "casual",
      joined_at: new Date(Date.now() - 30000).toISOString(),
    });

    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.gameModeSlug).toBe("casual");
    // A WebSocket should have been created for the reconnection
    expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    void result;
  });

  it("reconnects to in_lobby on mount and sets lobby state (lines 497-522)", async () => {
    vi.mocked(getMatchmakingStatus).mockResolvedValueOnce({
      state: "in_lobby",
      game_mode_slug: "ranked",
      lobby_id: "lobby-restored",
      players: [{ user_id: "u1", username: "Alice", is_bot: false, is_ready: false }],
      max_players: 4,
    });

    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.gameModeSlug).toBe("ranked");
    expect(result.current.lobbyId).toBe("lobby-restored");
    expect(result.current.lobbyPlayers).toHaveLength(1);
    expect(result.current.lobbyMaxPlayers).toBe(4);
  });

  it("uses localSession joinedAt fallback when API joined_at is absent (lines 498-501)", async () => {
    const joinedAt = Date.now() - 10000;
    const session = {
      gameModeSlug: "casual",
      fillBots: true,
      instantBot: false,
      joinedAt,
      lobbyId: null,
    };
    localStorage.setItem("maplord_queue", JSON.stringify(session));

    vi.mocked(getMatchmakingStatus).mockResolvedValueOnce({
      state: "in_queue",
      game_mode_slug: "casual",
      // no joined_at — falls back to localSession.joinedAt
    });

    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // A WS should be created (connectToQueue was called)
    expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    void result;
  });

  // -------------------------------------------------------------------------
  // lobby_full without full_at uses Date.now() fallback
  // -------------------------------------------------------------------------

  it("lobby_full without full_at uses current time as fallback", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({
        type: "lobby_full",
        // no full_at provided
        players: [
          { user_id: "u1", username: "Alice", is_bot: false, is_ready: false, is_banned: false },
          { user_id: "u2", username: "Bob", is_bot: false, is_ready: false, is_banned: false },
        ],
      });
    });

    expect(result.current.lobbyFull).toBe(true);

    // Countdown should start
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.readyCountdown).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // joinQueue() is idempotent (no double socket)
  // -------------------------------------------------------------------------

  it("joinQueue() is a no-op if already connected", async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const countAfterFirst = MockWebSocket.instances.length;

    act(() => {
      result.current.joinQueue();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(MockWebSocket.instances.length).toBe(countAfterFirst);
  });

  // -------------------------------------------------------------------------
  // localStorage fallback: lines 534-544
  // When isAuthenticated() returns false (or API fails), mount restores
  // queue state from a valid localStorage session.
  // -------------------------------------------------------------------------

  it("restores queue session from localStorage when not authenticated (lines 534-544)", async () => {
    // Save a valid session to localStorage
    const session = {
      gameModeSlug: "casual",
      fillBots: true,
      instantBot: false,
      joinedAt: Date.now(),
      lobbyId: "lobby-local",
    };
    localStorage.setItem("maplord_queue", JSON.stringify(session));

    // Make isAuthenticated() return false so the API is not called
    vi.mocked(isAuthenticated).mockReturnValueOnce(false);

    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The hook should have picked up the session and connected
    expect(result.current.gameModeSlug).toBe("casual");
    expect(result.current.lobbyId).toBe("lobby-local");
    // A WebSocket should have been created for reconnection
    expect(MockWebSocket.instances.length).toBeGreaterThan(0);
  });

  it("restores queue session from localStorage when API throws (lines 534-544 fallthrough)", async () => {
    // Save a valid session to localStorage
    const session = {
      gameModeSlug: "ranked",
      fillBots: false,
      instantBot: true,
      joinedAt: Date.now(),
      lobbyId: null,
    };
    localStorage.setItem("maplord_queue", JSON.stringify(session));

    // isAuthenticated=true but API throws — should fall through to localStorage
    vi.mocked(isAuthenticated).mockReturnValueOnce(true);
    vi.mocked(getMatchmakingStatus).mockRejectedValueOnce(new Error("API unavailable"));

    const { result } = renderHook(() => useMatchmaking(), { wrapper });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // fillBots and instantBot should come from the localStorage session
    expect(result.current.fillBots).toBe(false);
    expect(result.current.instantBot).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Cross-tab broadcast: lines 562-615
  // When another tab broadcasts via BroadcastChannel, the handler updates
  // local state or re-fetches from API.
  // We mock BroadcastChannel so we can directly invoke its onmessage handler.
  // -------------------------------------------------------------------------

  describe("cross-tab BroadcastChannel sync", () => {
    // Capture the BroadcastChannel instance created by the hook so we can
    // directly invoke its onmessage handler.
    let capturedChannel: { onmessage: ((ev: MessageEvent) => void) | null; close: () => void } | null = null;

    beforeEach(() => {
      capturedChannel = null;
      vi.stubGlobal("BroadcastChannel", class MockBC {
        onmessage: ((ev: MessageEvent) => void) | null = null;
        constructor(_name: string) {
          capturedChannel = this;
        }
        postMessage(_data: unknown) {}
        close() {}
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      // Re-stub WebSocket after unstubAllGlobals so subsequent tests still have the mock
      vi.stubGlobal("WebSocket", MockWebSocket);
    });

    function fireBroadcast(data: unknown) {
      if (capturedChannel?.onmessage) {
        capturedChannel.onmessage({ data } as MessageEvent);
      }
    }

    it("broadcast 'match_found' sets matchId and clears queue (lines 563-570)", async () => {
      const { result } = renderHook(() => useMatchmaking(), { wrapper });
      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        result.current.joinQueue();
      });
      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        fireBroadcast({ type: "match_found", matchId: "bc-match-77" });
        await Promise.resolve();
      });

      expect(result.current.matchId).toBe("bc-match-77");
      expect(result.current.activeMatchId).toBe("bc-match-77");
      expect(result.current.inQueue).toBe(false);
    });

    it("broadcast 'left' clears all lobby state (lines 572-585)", async () => {
      const { result } = renderHook(() => useMatchmaking(), { wrapper });
      await act(async () => {
        await Promise.resolve();
      });

      // Simulate lobby state via messages (no need for joinQueue in this block)
      // Instead, use the hook's joinQueue but verify state after broadcast
      await act(async () => {
        fireBroadcast({ type: "left" });
        await Promise.resolve();
      });

      // After a 'left' broadcast, all lobby-related state should be cleared
      expect(result.current.inQueue).toBe(false);
      expect(result.current.lobbyId).toBeNull();
      expect(result.current.lobbyPlayers).toEqual([]);
      expect(result.current.lobbyFull).toBe(false);
      expect(result.current.allReady).toBe(false);
    });

    it("broadcast 'joined' re-fetches status and sets gameModeSlug (lines 596-610)", async () => {
      const { result } = renderHook(() => useMatchmaking(), { wrapper });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Set mock AFTER mount-time API call is consumed
      vi.mocked(getMatchmakingStatus).mockResolvedValueOnce({
        state: "in_queue",
        game_mode_slug: "casual",
      });

      await act(async () => {
        fireBroadcast({ type: "joined" });
        // Drain microtasks from the async getMatchmakingStatus call
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // The hook sets gameModeSlug from the re-fetched status
      expect(result.current.gameModeSlug).toBe("casual");
    });

    it("broadcast 'lobby_update' re-fetches and updates lobby state from in_lobby (lines 596-610)", async () => {
      // Mount first with default idle response (consumed by mount-time init)
      const { result } = renderHook(() => useMatchmaking(), { wrapper });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // NOW set the mock for the broadcast-triggered re-fetch
      vi.mocked(getMatchmakingStatus).mockResolvedValueOnce({
        state: "in_lobby",
        game_mode_slug: "casual",
        lobby_id: "lobby-sync",
        players: [{ user_id: "u1", username: "Alice", is_bot: false, is_ready: false }],
        max_players: 2,
      });

      await act(async () => {
        fireBroadcast({ type: "lobby_update" });
        // Drain microtasks from the async getMatchmakingStatus call
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // The hook should update lobby state from the re-fetched status
      expect(result.current.lobbyId).toBe("lobby-sync");
      expect(result.current.lobbyPlayers).toHaveLength(1);
      expect(result.current.lobbyMaxPlayers).toBe(2);
    });

    it("broadcast 'joined' re-fetches and handles in_match state (lines 591-595)", async () => {
      const { result } = renderHook(() => useMatchmaking(), { wrapper });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Set mock AFTER mount-time call is consumed
      vi.mocked(getMatchmakingStatus).mockResolvedValueOnce({
        state: "in_match",
        match_id: "bc-match-from-status",
      });

      await act(async () => {
        fireBroadcast({ type: "joined" });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.activeMatchId).toBe("bc-match-from-status");
      expect(result.current.inQueue).toBe(false);
    });

    it("broadcast 'state_sync' re-fetches and handles idle state (lines 611-615)", async () => {
      const { result } = renderHook(() => useMatchmaking(), { wrapper });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Default mock returns { state: "idle" } — just fire the broadcast
      await act(async () => {
        fireBroadcast({ type: "state_sync" });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // idle state clears queue
      expect(result.current.inQueue).toBe(false);
      expect(result.current.lobbyId).toBeNull();
    });

    it("broadcast 'joined' is ignored when not authenticated (line 588)", async () => {
      const { result } = renderHook(() => useMatchmaking(), { wrapper });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // From this point on, isAuthenticated returns false
      vi.mocked(isAuthenticated).mockReturnValue(false);

      const callsBefore = vi.mocked(getMatchmakingStatus).mock.calls.length;

      await act(async () => {
        fireBroadcast({ type: "joined" });
        await Promise.resolve();
      });

      // isAuthenticated returned false — getMatchmakingStatus should NOT have been called again
      expect(vi.mocked(getMatchmakingStatus).mock.calls.length).toBe(callsBefore);

      // Restore default
      vi.mocked(isAuthenticated).mockReturnValue(true);
      void result;
    });

    it("broadcast 'left' closes an active WebSocket when wsRef.current is set (lines 574-576)", async () => {
      // Set up so that init() connects to WS via the in_queue path
      // This avoids the ordering issue with joinQueue() being async inside broadcast describe
      vi.mocked(getMatchmakingStatus).mockResolvedValueOnce({
        state: "in_queue",
        game_mode_slug: "casual",
      });

      // Mount the hook — init() sees in_queue, calls connectToQueue, creates WS
      const { result } = renderHook(() => useMatchmaking(), { wrapper });

      // Drain: getMatchmakingStatus resolve + connectToQueue getWsTicket reject + createSocket
      await act(async () => {
        await Promise.resolve(); // getMatchmakingStatus resolves
        await Promise.resolve(); // getWsTicket rejects (caught)
        await Promise.resolve(); // createSocket + onopen microtask
        await Promise.resolve(); // onopen callback
      });

      // wsRef should now be set (WS was created by init)
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
      // Capture the last WS instance
      const activeWs = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      // readyState is already OPEN by default in MockWebSocket constructor

      // Fire 'left' broadcast — should close the active WS (lines 574-576)
      await act(async () => {
        fireBroadcast({ type: "left" });
        await Promise.resolve();
      });

      // After the 'left' broadcast, wsRef.current is set to null and WS is closed
      expect(result.current.inQueue).toBe(false);
      // Verify the WS was closed (readyState = 3 = CLOSED)
      expect(activeWs.readyState).toBe(3);
    });
  });
});
