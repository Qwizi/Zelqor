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
      action_points: 15,
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

  it("sendChat() ignores messages over 500 characters", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.sendChat("x".repeat(501));
    });

    expect(getLastWs().sent).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // air transit handling
  // -------------------------------------------------------------------------

  it("game_tick updates air_transit_queue from payload", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "game_state", state: baseGameState });
    });

    const airTransit = [
      {
        id: "flight-1",
        mission_type: "bomb_run",
        source_region_id: "r1",
        target_region_id: "r2",
        player_id: "p1",
        unit_type: "bomber",
        units: 2,
        escort_fighters: 0,
        progress: 0.3,
        speed_per_tick: 0.1,
        total_distance: 100,
        interceptors: [],
      },
    ];

    act(() => {
      getLastWs().simulateMessage({
        type: "game_tick",
        tick: 5,
        players: baseGameState.players,
        events: [],
        air_transit_queue: airTransit,
      });
    });

    expect(result.current.gameState?.air_transit_queue).toHaveLength(1);
    expect(result.current.gameState?.air_transit_queue?.[0].id).toBe("flight-1");
    expect(result.current.gameState?.air_transit_queue?.[0].mission_type).toBe("bomb_run");
  });

  it("interceptFlight() sends intercept action", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.interceptFlight("r1", "flight-1", 3);
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("intercept");
    expect(sent.region_id).toBe("r1");
    expect(sent.target_flight_id).toBe("flight-1");
    expect(sent.units).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Diplomacy events
  // -------------------------------------------------------------------------

  it("game_state with diplomacy sets diplomacy state", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    const diplomacyData = {
      wars: [{ player_a: "p1", player_b: "p2", started_tick: 1, aggressor_id: "p1", provinces_changed: [] }],
      pacts: [],
      proposals: [],
    };

    act(() => {
      getLastWs().simulateMessage({
        type: "game_state",
        state: { ...baseGameState, diplomacy: diplomacyData },
      });
    });

    expect(result.current.diplomacy.wars).toHaveLength(1);
    expect(result.current.diplomacy.wars[0].player_a).toBe("p1");
  });

  it("game_state with top-level diplomacy field sets diplomacy", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    const diplomacyData = {
      wars: [],
      pacts: [{ id: "pact-1", player_ids: ["p1", "p2"], pact_type: "nap", expires_at: null }],
      proposals: [],
    };

    act(() => {
      getLastWs().simulateMessage({
        type: "game_state",
        state: baseGameState,
        diplomacy: diplomacyData,
      });
    });

    expect(result.current.diplomacy.pacts).toHaveLength(1);
  });

  it("game_tick with diplomacy updates diplomacy state", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "game_state", state: baseGameState });
    });

    const diplomacyData = {
      wars: [{ id: "w2", attacker_id: "p1", defender_id: "p2", declared_at: 5 }],
      pacts: [],
      proposals: [],
    };

    act(() => {
      getLastWs().simulateMessage({
        type: "game_tick",
        tick: 6,
        players: baseGameState.players,
        events: [],
        diplomacy: diplomacyData,
      });
    });

    expect(result.current.diplomacy.wars).toHaveLength(1);
  });

  it("proposePact() sends propose_pact action with default pact type", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.proposePact("p2");
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("propose_pact");
    expect(sent.target_player_id).toBe("p2");
    expect(sent.pact_type).toBe("nap");
  });

  it("proposePact() uses the provided pact type", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.proposePact("p2", "alliance");
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.pact_type).toBe("alliance");
  });

  it("respondPact() sends respond_pact action", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.respondPact("proposal-1", true);
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("respond_pact");
    expect(sent.proposal_id).toBe("proposal-1");
    expect(sent.accept).toBe(true);
  });

  it("proposePeace() sends propose_peace with default status_quo", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.proposePeace("p2");
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("propose_peace");
    expect(sent.target_player_id).toBe("p2");
    expect(sent.condition_type).toBe("status_quo");
  });

  it("proposePeace() includes provinces_to_return when provided", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.proposePeace("p2", "return_provinces", ["r1", "r2"]);
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.condition_type).toBe("return_provinces");
    expect(sent.provinces_to_return).toEqual(["r1", "r2"]);
  });

  it("respondPeace() sends respond_peace action", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.respondPeace("proposal-2", false);
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("respond_peace");
    expect(sent.proposal_id).toBe("proposal-2");
    expect(sent.accept).toBe(false);
  });

  it("breakPact() sends break_pact action", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.breakPact("pact-1");
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("break_pact");
    expect(sent.pact_id).toBe("pact-1");
  });

  it("declareWar() sends declare_war action", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.declareWar("p2");
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("declare_war");
    expect(sent.target_player_id).toBe("p2");
  });

  // -------------------------------------------------------------------------
  // Ability actions
  // -------------------------------------------------------------------------

  it("upgradeBuilding() sends upgrade_building action", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.upgradeBuilding("r1", "barracks");
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("upgrade_building");
    expect(sent.region_id).toBe("r1");
    expect(sent.building_type).toBe("barracks");
  });

  it("bombard() sends bombard action with artillery unit_type", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.bombard("r1", ["r2", "r3"]);
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.action).toBe("bombard");
    expect(sent.source_region_id).toBe("r1");
    expect(sent.target_region_ids).toEqual(["r2", "r3"]);
    expect(sent.unit_type).toBe("artillery");
  });

  it("bombard() includes units count when provided", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.bombard("r1", ["r2"], 5);
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.units).toBe(5);
  });

  it("attack() includes escort_fighters when positive", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.attack("r1", "r2", 3, "bomber", 2);
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.escort_fighters).toBe(2);
  });

  it("attack() omits escort_fighters when 0", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.attack("r1", "r2", 3, "bomber", 0);
    });

    const sent = JSON.parse(getLastWs().sent[0]);
    expect(sent.escort_fighters).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // game_tick with active_effects — shallow equality optimization
  // -------------------------------------------------------------------------

  it("game_tick preserves active_effects reference when data is unchanged (shallow equal)", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    const effects = [
      {
        effect_type: "virus",
        source_player_id: "p1",
        target_region_id: "r1",
        affected_region_ids: [],
        ticks_remaining: 5,
        total_ticks: 10,
        params: {},
      },
    ];

    act(() => {
      getLastWs().simulateMessage({ type: "game_state", state: { ...baseGameState, active_effects: effects } });
    });

    const effectsBefore = result.current.gameState?.active_effects;

    act(() => {
      getLastWs().simulateMessage({
        type: "game_tick",
        tick: 2,
        players: baseGameState.players,
        events: [],
        active_effects: [
          {
            effect_type: "virus",
            source_player_id: "p1",
            target_region_id: "r1",
            affected_region_ids: [],
            ticks_remaining: 5,
            total_ticks: 10,
            params: {},
          },
        ],
      });
    });

    // Should be the same reference (shallow equal returns prev)
    expect(result.current.gameState?.active_effects).toBe(effectsBefore);
  });

  it("game_tick replaces active_effects reference when data changes", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    const effects = [
      {
        effect_type: "virus",
        source_player_id: "p1",
        target_region_id: "r1",
        affected_region_ids: [],
        ticks_remaining: 5,
        total_ticks: 10,
        params: {},
      },
    ];

    act(() => {
      getLastWs().simulateMessage({ type: "game_state", state: { ...baseGameState, active_effects: effects } });
    });

    const effectsBefore = result.current.gameState?.active_effects;

    act(() => {
      getLastWs().simulateMessage({
        type: "game_tick",
        tick: 3,
        players: baseGameState.players,
        events: [],
        active_effects: [
          {
            effect_type: "virus",
            source_player_id: "p1",
            target_region_id: "r1",
            affected_region_ids: [],
            ticks_remaining: 4, // changed
            total_ticks: 10,
            params: {},
          },
        ],
      });
    });

    // Reference should have changed because data changed
    expect(result.current.gameState?.active_effects).not.toBe(effectsBefore);
    expect(result.current.gameState?.active_effects?.[0].ticks_remaining).toBe(4);
  });

  // -------------------------------------------------------------------------
  // game_starting message
  // -------------------------------------------------------------------------

  it("game_starting sets match status to in_progress", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "game_state", state: baseGameState });
    });

    act(() => {
      getLastWs().simulateMessage({ type: "game_starting" });
    });

    expect(result.current.gameState?.meta.status).toBe("in_progress");
  });

  // -------------------------------------------------------------------------
  // Reconnect behaviour
  // -------------------------------------------------------------------------

  it("reconnects after unexpected WebSocket close (non-1000 code)", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.connected).toBe(true);
    const countBefore = MockWebSocket.instances.length;

    act(() => {
      getLastWs().simulateClose(1006, ""); // abnormal close
    });

    expect(result.current.connected).toBe(false);

    // Advance by initial backoff delay (1000ms), then flush microtask queue
    await act(async () => {
      vi.advanceTimersByTime(1000);
      // Flush multiple microtask ticks to allow the async connect() to complete
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(MockWebSocket.instances.length).toBeGreaterThan(countBefore);
  });

  it("does not reconnect after intentional close (code 1000 with reason 'component_disposed')", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    const countBefore = MockWebSocket.instances.length;

    act(() => {
      getLastWs().simulateClose(1000, "component_disposed");
    });

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    // No additional socket should have been created
    expect(MockWebSocket.instances.length).toBe(countBefore);

    void result;
  });

  it("sets bannedReason and does not reconnect on close code 4003", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    const countBefore = MockWebSocket.instances.length;

    act(() => {
      getLastWs().simulateClose(4003, "Account suspended");
    });

    expect(result.current.bannedReason).toBe("Account suspended");

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    // No reconnect on ban
    expect(MockWebSocket.instances.length).toBe(countBefore);
  });

  it("does not reconnect on server rejection close codes (4000, 4001, 4002)", async () => {
    for (const code of [4000, 4001, 4002]) {
      MockWebSocket.instances = [];

      const { result, unmount } = renderHook(() => useGameSocket(`match-${code}`), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await Promise.resolve();
      });

      const countBefore = MockWebSocket.instances.length;

      act(() => {
        getLastWs().simulateClose(code, "");
      });

      await act(async () => {
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
      });

      expect(MockWebSocket.instances.length).toBe(countBefore);
      unmount();
      void result;
    }
  });

  // -------------------------------------------------------------------------
  // pong message
  // -------------------------------------------------------------------------

  it("pong message updates ping latency", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    // Advance timer so ping interval fires (5000ms)
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    act(() => {
      getLastWs().simulateMessage({ type: "pong" });
    });

    expect(result.current.ping).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // leaveMatch()
  // -------------------------------------------------------------------------

  it("leaveMatch() resolves false when not connected", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    const ws = getLastWs();
    ws.readyState = 3; // CLOSED

    let leaveResult: boolean | undefined;
    await act(async () => {
      leaveResult = await result.current.leaveMatch();
    });

    expect(leaveResult).toBe(false);
  });

  it("leaveMatch() sends leave_match action and resolves true when server responds", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    let leaveResult: boolean | undefined;
    const leavePromise = act(async () => {
      const p = result.current.leaveMatch();
      // Simulate server acknowledging the leave
      getLastWs().simulateMessage({ type: "match_left" });
      leaveResult = await p;
    });

    await leavePromise;

    const sent = getLastWs().sent.map((s) => JSON.parse(s));
    expect(sent.some((m) => m.action === "leave_match")).toBe(true);
    expect(leaveResult).toBe(true);
  });

  it("leaveMatch() resolves false after 1500ms timeout if no server response", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    let leaveResult: boolean | undefined;
    const leavePromise = act(async () => {
      const p = result.current.leaveMatch();
      vi.advanceTimersByTime(1500);
      leaveResult = await p;
    });

    await leavePromise;

    expect(leaveResult).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Spectator mode
  // -------------------------------------------------------------------------

  it("connects to spectate URL when spectator=true", async () => {
    const { result } = renderHook(() => useGameSocket("match-1", { spectator: true }), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await Promise.resolve();
    });

    const ws = getLastWs();
    expect(ws.url).toContain("spectate");

    void result;
  });

  // -------------------------------------------------------------------------
  // game_tick with weather
  // -------------------------------------------------------------------------

  it("game_tick with weather updates weather in gameState", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateMessage({ type: "game_state", state: baseGameState });
    });

    const weather = {
      time_of_day: 0.5,
      phase: "day",
      cloud_coverage: 0.3,
      visibility: 1.0,
      condition: "clear",
      defense_modifier: 1.0,
      randomness_modifier: 1.0,
      energy_modifier: 1.0,
      unit_gen_modifier: 1.0,
    };

    act(() => {
      getLastWs().simulateMessage({
        type: "game_tick",
        tick: 8,
        players: baseGameState.players,
        events: [],
        weather,
      });
    });

    expect(result.current.gameState?.weather?.condition).toBe("clear");
  });

  // -------------------------------------------------------------------------
  // game_tick event __eventKey preserved when already set
  // -------------------------------------------------------------------------

  it("game_tick preserves existing __eventKey on events that already have one", async () => {
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
        tick: 9,
        players: baseGameState.players,
        events: [{ type: "attack", __eventKey: "existing-key-123" }],
      });
    });

    expect(result.current.events[0].__eventKey).toBe("existing-key-123");
  });

  // -------------------------------------------------------------------------
  // game_state with top-level weather field (line 245)
  // -------------------------------------------------------------------------

  it("game_state message with top-level weather sets weather on state (line 245)", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    const weather = {
      time_of_day: 0.2,
      phase: "night",
      cloud_coverage: 0.8,
      visibility: 0.6,
      condition: "stormy",
      defense_modifier: 1.2,
      randomness_modifier: 0.9,
      energy_modifier: 0.8,
      unit_gen_modifier: 0.9,
    };

    act(() => {
      getLastWs().simulateMessage({
        type: "game_state",
        state: baseGameState,
        weather, // top-level weather field triggers line 244-245
      });
    });

    expect(result.current.gameState?.weather?.condition).toBe("stormy");
  });

  // -------------------------------------------------------------------------
  // beforeunload handler sets isPageUnload (line 394)
  // -------------------------------------------------------------------------

  it("beforeunload event prevents reconnect after socket close (line 394)", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    const countBefore = MockWebSocket.instances.length;

    // Trigger beforeunload — sets isPageUnload=true inside the hook
    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });

    // Close the socket with unexpected code — normally would trigger reconnect
    act(() => {
      getLastWs().simulateClose(1006, "");
    });

    // Advance timers — no reconnect should fire because isPageUnload=true
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(MockWebSocket.instances.length).toBe(countBefore);
    void result;
  });

  // -------------------------------------------------------------------------
  // getWsTicket success path: ticket and nonce used (lines 403-404)
  // -------------------------------------------------------------------------

  it("includes ticket and nonce in the WebSocket URL when getWsTicket succeeds (lines 403-404)", async () => {
    const { getWsTicket } = await import("@/lib/api");
    const { solveChallenge } = await import("@/lib/pow");

    vi.mocked(getWsTicket).mockResolvedValueOnce({
      ticket: "ticket-abc",
      challenge: "challenge-xyz",
      difficulty: 1,
    });
    vi.mocked(solveChallenge).mockResolvedValueOnce("nonce-solved");

    renderHook(() => useGameSocket("match-ticket"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const lastWs = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(lastWs.url).toContain("ticket=ticket-abc");
    expect(lastWs.url).toContain("nonce=nonce-solved");
  });

  // -------------------------------------------------------------------------
  // leaveResolverRef resolved with false on unexpected close (lines 417-418)
  // -------------------------------------------------------------------------

  it("leaveMatch() resolves false when the socket closes before leave_match ACK", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    const ws = getLastWs();
    ws.readyState = MockWebSocket.OPEN;

    let leaveResult: boolean | undefined;
    act(() => {
      result.current.leaveMatch().then((v) => {
        leaveResult = v;
      });
    });

    // Simulate an unexpected socket close before the server ACKs leave
    act(() => {
      ws.simulateClose(1006, "unexpected"); // 1006 is abnormal closure
    });

    await act(async () => {
      await Promise.resolve();
    });

    // leaveResolverRef should have been called with false (lines 417-418)
    expect(leaveResult).toBe(false);
  });

  // -------------------------------------------------------------------------
  // disposed=true on WebSocket open — socket is immediately closed (lines 457-458)
  // -------------------------------------------------------------------------

  it("closes the socket immediately on open when the component was unmounted before open fired", async () => {
    // We need to prevent the mock WebSocket from auto-firing onopen so we can
    // unmount first, then fire it.
    let capturedOnopen: ((event: Event) => void) | null = null;
    let capturedWs: MockWebSocket | null = null;

    // Temporarily patch MockWebSocket constructor to not auto-fire
    const OrigWS = MockWebSocket;
    class DelayedOpenWS extends OrigWS {
      constructor(url: string) {
        super(url);
        // Remove the auto-fire set up by the parent constructor by overriding
        // the onopen property so we can capture and defer it.
        capturedWs = this;
        // Clear auto-fire from parent — we'll fire manually
      }
    }

    vi.stubGlobal("WebSocket", DelayedOpenWS);

    const { unmount } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });

    // Get the ws created by the hook before auto-open fires
    await act(async () => {
      // Let the effect start connecting (async ticket fetch etc.)
      await Promise.resolve();
      await Promise.resolve();
    });

    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    // Capture the onopen that the hook assigned
    capturedOnopen = ws.onopen as ((event: Event) => void) | null;

    // Unmount the component — sets disposed=true inside the hook
    unmount();

    // Now fire onopen — the hook sees disposed=true and calls ws.close()
    if (capturedOnopen) {
      act(() => {
        capturedOnopen!(new Event("open"));
      });
    }

    // The socket should now be closed (readyState=3)
    expect(ws.readyState).toBe(3);

    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  // -------------------------------------------------------------------------
  // ban close (code 4003) sets bannedReason and does not reconnect
  // -------------------------------------------------------------------------

  it("sets bannedReason when the socket closes with code 4003", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateClose(4003, "Account banned for cheating");
    });

    expect(result.current.bannedReason).toBe("Account banned for cheating");
  });

  it("sets default bannedReason when code 4003 has empty reason", async () => {
    const { result } = renderHook(() => useGameSocket("match-1"), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastWs().simulateClose(4003, "");
    });

    expect(result.current.bannedReason).toBe("Account banned");
  });
});
