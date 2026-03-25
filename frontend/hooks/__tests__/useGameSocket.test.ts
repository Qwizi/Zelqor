import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// WebSocket mock — must be installed before any module under test is imported.
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
    // Fire onopen asynchronously so the hook can assign it first.
    Promise.resolve().then(() => this.onopen?.());
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(_code?: number, _reason?: string) {
    this.readyState = 3; // CLOSED
  }

  /** Simulate a server push message. */
  simulateMessage(data: unknown) {
    const event = new MessageEvent("message", { data: JSON.stringify(data) });
    this.onmessage?.(event);
  }

  /** Simulate a close event. */
  simulateClose(code = 1000, reason = "") {
    const event = new CloseEvent("close", { code, reason });
    this.onclose?.(event);
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);

// Stable window.location so WS_BASE is deterministic.
Object.defineProperty(window, "location", {
  value: { protocol: "https:", host: "maplord.test", origin: "https://maplord.test" },
  writable: true,
});

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
  getWsTicket: vi.fn().mockRejectedValue(new Error("no ticket in tests")),
}));

vi.mock("@/lib/pow", () => ({
  solveChallenge: vi.fn().mockResolvedValue("nonce"),
}));

// ---------------------------------------------------------------------------
// Import hook under test AFTER globals + mocks are set.
// ---------------------------------------------------------------------------
import { type GameState, useGameSocket } from "../useGameSocket";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLastWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const baseGameState: GameState = {
  meta: {
    status: "capital_selection",
    current_tick: "0",
    tick_interval_ms: "500",
    max_players: "2",
    min_capital_distance: "1",
  },
  players: {
    p1: {
      user_id: "p1",
      username: "Alice",
      color: "#ff0000",
      is_alive: true,
      capital_region_id: null,
      energy: 10,
    },
  },
  regions: {
    r1: {
      name: "Region One",
      country_code: "XX",
      owner_id: null,
      unit_count: 5,
      is_capital: false,
      building_type: null,
      defense_bonus: 0,
    },
  },
  buildings_queue: [],
  unit_queue: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useGameSocket", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it("starts with connected=false, gameState=null, events=[], no chat messages", () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    expect(result.current.connected).toBe(false);
    expect(result.current.gameState).toBeNull();
    expect(result.current.events).toEqual([]);
    expect(result.current.matchChatMessages).toEqual([]);
    expect(result.current.voiceToken).toBeNull();
    expect(result.current.voiceUrl).toBeNull();
    expect(result.current.bannedReason).toBeNull();
  });

  it("sets connected=true when the WebSocket opens", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.connected).toBe(true);
  });

  // -------------------------------------------------------------------------
  // game_state message
  // -------------------------------------------------------------------------

  it("game_state message sets gameState", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "game_state", state: baseGameState });
    });

    expect(result.current.gameState).toEqual(baseGameState);
  });

  // -------------------------------------------------------------------------
  // game_tick message — region + player merge
  // -------------------------------------------------------------------------

  it("game_tick merges regions into existing gameState", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "game_state", state: baseGameState });
    });

    act(() => {
      getLastWs().simulateMessage({
        type: "game_tick",
        tick: 1,
        regions: {
          r1: { unit_count: 10 },
        },
        players: baseGameState.players,
        events: [],
      });
    });

    expect(result.current.gameState?.regions.r1.unit_count).toBe(10);
    expect(result.current.gameState?.meta.current_tick).toBe("1");
  });

  it("game_tick updates players from tick payload", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "game_state", state: baseGameState });
    });

    const updatedPlayers = {
      p1: { ...baseGameState.players.p1, energy: 99 },
    };

    act(() => {
      getLastWs().simulateMessage({
        type: "game_tick",
        tick: 2,
        players: updatedPlayers,
        events: [],
      });
    });

    expect(result.current.gameState?.players.p1.energy).toBe(99);
  });

  it("game_tick with events appends them to the events array", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "game_state", state: baseGameState });
    });

    act(() => {
      getLastWs().simulateMessage({
        type: "game_tick",
        tick: 3,
        players: baseGameState.players,
        events: [{ type: "unit_produced", player_id: "p1", region_id: "r1", unit_type: "infantry", quantity: 2 }],
      });
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].type).toBe("unit_produced");
  });

  it("game_tick with game_over event sets status to finished", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "game_state", state: baseGameState });
    });

    act(() => {
      getLastWs().simulateMessage({
        type: "game_tick",
        tick: 10,
        players: baseGameState.players,
        events: [{ type: "game_over" }],
      });
    });

    expect(result.current.gameState?.meta.status).toBe("finished");
  });

  it("game_tick events receive auto-generated __eventKey", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "game_state", state: baseGameState });
    });

    act(() => {
      getLastWs().simulateMessage({
        type: "game_tick",
        tick: 5,
        players: baseGameState.players,
        events: [{ type: "attack", player_id: "p1", source_region_id: "r1", target_region_id: "r2", units: 3 }],
      });
    });

    expect(typeof result.current.events[0].__eventKey).toBe("string");
    expect(result.current.events[0].__eventKey).toContain("5");
  });

  // -------------------------------------------------------------------------
  // error message
  // -------------------------------------------------------------------------

  it("error message adds server_error event (non-fatal)", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "error", message: "Something went wrong", fatal: false });
    });

    const errorEvent = result.current.events.find((e) => e.type === "server_error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.message).toBe("Something went wrong");
    expect(errorEvent?.fatal).toBe(false);
  });

  it("fatal error message sets match status to cancelled", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "game_state", state: baseGameState });
    });

    act(() => {
      getLastWs().simulateMessage({ type: "error", message: "Match cancelled", fatal: true });
    });

    expect(result.current.gameState?.meta.status).toBe("cancelled");
  });

  // -------------------------------------------------------------------------
  // capital_selected — no-op
  // -------------------------------------------------------------------------

  it("capital_selected message does not change gameState", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "game_state", state: baseGameState });
    });

    const stateBefore = result.current.gameState;

    act(() => {
      getLastWs().simulateMessage({ type: "capital_selected", region_id: "r1" });
    });

    expect(result.current.gameState).toBe(stateBefore);
  });

  // -------------------------------------------------------------------------
  // chat_message
  // -------------------------------------------------------------------------

  it("chat_message adds to matchChatMessages", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({
        type: "chat_message",
        user_id: "p1",
        username: "Alice",
        content: "Hello!",
        timestamp: 1000,
      });
    });

    expect(result.current.matchChatMessages).toHaveLength(1);
    expect(result.current.matchChatMessages[0].content).toBe("Hello!");
    expect(result.current.matchChatMessages[0].username).toBe("Alice");
  });

  it("chat_history replaces matchChatMessages", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    // Add one message first
    act(() => {
      getLastWs().simulateMessage({
        type: "chat_message",
        user_id: "p1",
        username: "Alice",
        content: "First",
        timestamp: 1000,
      });
    });

    const history = [{ user_id: "p2", username: "Bob", content: "Historical", timestamp: 500 }];

    act(() => {
      getLastWs().simulateMessage({ type: "chat_history", messages: history });
    });

    // Should be replaced, not appended
    expect(result.current.matchChatMessages).toHaveLength(1);
    expect(result.current.matchChatMessages[0].content).toBe("Historical");
  });

  // -------------------------------------------------------------------------
  // voice_token
  // -------------------------------------------------------------------------

  it("voice_token message updates voiceToken and voiceUrl", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "voice_token", token: "vt-abc", url: "wss://voice.test" });
    });

    expect(result.current.voiceToken).toBe("vt-abc");
    expect(result.current.voiceUrl).toBe("wss://voice.test");
  });

  // -------------------------------------------------------------------------
  // send()
  // -------------------------------------------------------------------------

  it("send() serialises data as JSON and calls WebSocket.send", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.send({ action: "ping" });
    });

    const ws = getLastWs();
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ action: "ping" });
  });

  it("send() is a no-op when WebSocket is not open", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    // Wait for the WebSocket to be created
    await vi.waitFor(() => expect(getLastWs()).toBeDefined());

    const ws = getLastWs();
    // Force the socket to CLOSED state before sending
    ws.readyState = 3;

    act(() => {
      result.current.send({ action: "ping" });
    });

    expect(ws.sent).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Action helpers
  // -------------------------------------------------------------------------

  it("selectCapital() sends select_capital action", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.selectCapital("r1");
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("select_capital");
    expect(sent.region_id).toBe("r1");
  });

  it("attack() sends attack action with all fields", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.attack("r1", "r2", 5, "infantry");
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("attack");
    expect(sent.source_region_id).toBe("r1");
    expect(sent.target_region_id).toBe("r2");
    expect(sent.units).toBe(5);
    expect(sent.unit_type).toBe("infantry");
  });

  it("move() sends move action", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.move("r1", "r2", 3, null);
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("move");
    expect(sent.units).toBe(3);
  });

  it("build() sends build action", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.build("r1", "barracks");
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("build");
    expect(sent.region_id).toBe("r1");
    expect(sent.building_type).toBe("barracks");
  });

  it("produceUnit() sends produce_unit action", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.produceUnit("r1", "tank");
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("produce_unit");
    expect(sent.unit_type).toBe("tank");
  });

  it("useAbility() sends use_ability action", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.useAbility("r2", "nuke");
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("use_ability");
    expect(sent.target_region_id).toBe("r2");
    expect(sent.ability_type).toBe("nuke");
  });

  // -------------------------------------------------------------------------
  // sendChat()
  // -------------------------------------------------------------------------

  it("sendChat() sends trimmed chat message", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.sendChat("  hello  ");
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("chat");
    expect(sent.content).toBe("hello");
  });

  it("sendChat() ignores empty or whitespace-only content", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.sendChat("   ");
    });

    expect(getLastWs().sent).toHaveLength(0);
  });
});
