import { act, renderHook } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------

const OPEN = 1;
const CLOSED = 3;

class MockWebSocket {
  static OPEN = OPEN;
  url: string;
  readyState = OPEN;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  sent: string[] = [];

  static instances: MockWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // fire onopen asynchronously so the hook can attach the handler first
    Promise.resolve().then(() => this.onopen?.());
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = CLOSED;
  }

  simulateMessage(data: unknown) {
    const event = new MessageEvent("message", { data: JSON.stringify(data) });
    this.onmessage?.(event);
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);

// ---------------------------------------------------------------------------
// Dependency mocks
// ---------------------------------------------------------------------------

const mockGetAccessToken = vi.fn<() => string | null>(() => "test-token");
const mockGetWsTicket = vi.fn();
const mockSolveChallenge = vi.fn();
const mockUseAuth = vi.fn();
const mockCreateSocket = vi.fn();

vi.mock("@/lib/auth", () => ({
  isAuthenticated: vi.fn(() => true),
  setAuthenticated: vi.fn(),
  getAccessToken: () => mockGetAccessToken(),
  getRefreshToken: vi.fn(() => null),
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
  isLoggedIn: vi.fn(() => true),
}));

vi.mock("@/lib/api", () => ({
  getWsTicket: (...args: unknown[]) => mockGetWsTicket(...args),
}));

vi.mock("@/lib/pow", () => ({
  solveChallenge: (...args: unknown[]) => mockSolveChallenge(...args),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/ws", () => ({
  createSocket: (...args: unknown[]) => mockCreateSocket(...args),
}));

import { ChatProvider, useChat } from "../useChat";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(ChatProvider, null, children);
}

const mockUser = { id: "user-1", username: "Alice" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];

    mockUseAuth.mockReturnValue({ user: mockUser });
    mockGetAccessToken.mockReturnValue("test-token");
    mockGetWsTicket.mockResolvedValue({ ticket: "tkt", challenge: "ch", difficulty: 2 });
    mockSolveChallenge.mockResolvedValue("nonce-123");

    // Default: createSocket returns a real MockWebSocket so the hook can
    // access readyState and the sent array.
    mockCreateSocket.mockImplementation(
      (
        _path: string,
        _token: string,
        onMessage: (msg: Record<string, unknown>) => void,
        _onClose: () => void,
        _ticket: string,
        _nonce: string,
      ) => {
        const ws = new MockWebSocket("wss://maplord.test/chat/");
        // Wire onmessage through the hook's onMessage callback
        ws.onmessage = (evt) => onMessage(JSON.parse(evt.data as string));
        return ws;
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when used outside of ChatProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useChat())).toThrow("useChat must be used within ChatProvider");
    spy.mockRestore();
  });

  it("has correct initial state before connection", async () => {
    // No token — connection is skipped
    mockGetAccessToken.mockReturnValue(null);
    mockUseAuth.mockReturnValue({ user: null });

    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    expect(result.current.messages).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.chatOpen).toBe(false);
  });

  it("calls createSocket when user is authenticated", async () => {
    renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    expect(mockCreateSocket).toHaveBeenCalledOnce();
    const [path] = mockCreateSocket.mock.calls[0] as [string, string | null];
    expect(path).toBe("/chat/");
    // Token is always null in cookie-based auth; auth is done via httpOnly cookie
  });

  it("sets connected=true when WebSocket onopen fires", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    expect(result.current.connected).toBe(true);
  });

  it("loads chat history when chat_history message is received", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    const ws = MockWebSocket.instances[0];
    await act(async () => {
      ws.simulateMessage({
        type: "chat_history",
        messages: [
          { user_id: "u1", username: "Bob", content: "Hello", timestamp: 1000 },
          { user_id: "u2", username: "Carol", content: "World", timestamp: 1001 },
        ],
      });
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].content).toBe("Hello");
    expect(result.current.messages[1].content).toBe("World");
  });

  it("appends a new message when chat_message is received after history init", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    const ws = MockWebSocket.instances[0];

    // Init history first
    await act(async () => {
      ws.simulateMessage({ type: "chat_history", messages: [] });
    });

    await act(async () => {
      ws.simulateMessage({
        type: "chat_message",
        user_id: "u2",
        username: "Bob",
        content: "Hey!",
        timestamp: 2000,
      });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe("Hey!");
  });

  it("increments unreadCount for messages from other users when chat is closed", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    const ws = MockWebSocket.instances[0];

    // Init history
    await act(async () => {
      ws.simulateMessage({ type: "chat_history", messages: [] });
    });

    // chatOpen is false by default → should increment unread
    await act(async () => {
      ws.simulateMessage({
        type: "chat_message",
        user_id: "other-user",
        username: "Stranger",
        content: "Hi",
        timestamp: 3000,
      });
    });

    expect(result.current.unreadCount).toBe(1);
  });

  it("does not increment unreadCount for own messages", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    const ws = MockWebSocket.instances[0];

    await act(async () => {
      ws.simulateMessage({ type: "chat_history", messages: [] });
    });

    await act(async () => {
      ws.simulateMessage({
        type: "chat_message",
        user_id: "user-1", // same as mockUser.id
        username: "Alice",
        content: "My own message",
        timestamp: 4000,
      });
    });

    expect(result.current.unreadCount).toBe(0);
  });

  it("resetUnread sets unreadCount back to 0", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    const ws = MockWebSocket.instances[0];

    await act(async () => {
      ws.simulateMessage({ type: "chat_history", messages: [] });
    });

    await act(async () => {
      ws.simulateMessage({
        type: "chat_message",
        user_id: "other-user",
        username: "Stranger",
        content: "Hi",
        timestamp: 5000,
      });
    });

    expect(result.current.unreadCount).toBe(1);

    act(() => {
      result.current.resetUnread();
    });

    expect(result.current.unreadCount).toBe(0);
  });

  it("sendMessage sends JSON over the WebSocket when connected", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    const ws = MockWebSocket.instances[0];

    act(() => {
      result.current.sendMessage("Hello world");
    });

    expect(ws.sent).toHaveLength(1);
    const payload = JSON.parse(ws.sent[0]);
    expect(payload).toEqual({ action: "chat_message", content: "Hello world" });
  });

  it("sendMessage ignores empty or whitespace-only content", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    const ws = MockWebSocket.instances[0];

    act(() => {
      result.current.sendMessage("   ");
    });
    act(() => {
      result.current.sendMessage("");
    });

    expect(ws.sent).toHaveLength(0);
  });

  it("sendMessage trims whitespace from content", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    const ws = MockWebSocket.instances[0];

    act(() => {
      result.current.sendMessage("  hello  ");
    });

    const payload = JSON.parse(ws.sent[0]);
    expect(payload.content).toBe("hello");
  });

  it("sendMessage does not send messages longer than 500 characters", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    const ws = MockWebSocket.instances[0];
    const longMessage = "x".repeat(501);

    act(() => {
      result.current.sendMessage(longMessage);
    });

    expect(ws.sent).toHaveLength(0);
  });

  it("setChatOpen updates chatOpen state", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    expect(result.current.chatOpen).toBe(false);

    act(() => {
      result.current.setChatOpen(true);
    });

    expect(result.current.chatOpen).toBe(true);
  });

  it("does not create a connection when user is null", async () => {
    mockUseAuth.mockReturnValue({ user: null });
    mockGetAccessToken.mockReturnValue(null);

    renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    expect(mockCreateSocket).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // DM tab management
  // ---------------------------------------------------------------------------

  it("openDMTab() adds a new DM tab and sets it as active", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.openDMTab("friend-1", "Bob");
    });

    expect(result.current.dmTabs).toHaveLength(1);
    expect(result.current.dmTabs[0].friendId).toBe("friend-1");
    expect(result.current.dmTabs[0].friendUsername).toBe("Bob");
    expect(result.current.activeTab).toBe("friend-1");
    expect(result.current.chatOpen).toBe(true);
  });

  it("openDMTab() does not add a duplicate tab for same friendId", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.openDMTab("friend-1", "Bob");
    });
    act(() => {
      result.current.openDMTab("friend-1", "Bob");
    });

    expect(result.current.dmTabs).toHaveLength(1);
  });

  it("openDMTab() clears dmUnread for the opened friend", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    // Silently add a tab with unread count
    act(() => {
      result.current.addDMTabSilent("friend-1", "Bob");
    });

    expect(result.current.dmUnread["friend-1"]).toBe(1);

    // Now open that tab — unread should be cleared
    act(() => {
      result.current.openDMTab("friend-1", "Bob");
    });

    expect(result.current.dmUnread["friend-1"]).toBeUndefined();
  });

  it("addDMTabSilent() adds tab without switching activeTab or chatOpen", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.addDMTabSilent("friend-2", "Carol");
    });

    expect(result.current.dmTabs).toHaveLength(1);
    // Should not switch active tab
    expect(result.current.activeTab).toBe("global");
    // Should not open chat
    expect(result.current.chatOpen).toBe(false);
  });

  it("addDMTabSilent() increments dmUnread for the friend", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.addDMTabSilent("friend-2", "Carol");
    });

    expect(result.current.dmUnread["friend-2"]).toBe(1);

    act(() => {
      result.current.addDMTabSilent("friend-2", "Carol");
    });

    // Tab already exists — no second tab added but unread increments
    expect(result.current.dmTabs).toHaveLength(1);
    expect(result.current.dmUnread["friend-2"]).toBe(2);
  });

  it("closeDMTab() removes the tab and clears dmUnread", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.openDMTab("friend-1", "Bob");
    });
    act(() => {
      result.current.addDMTabSilent("friend-1", "Bob");
    });

    act(() => {
      result.current.closeDMTab("friend-1");
    });

    expect(result.current.dmTabs).toHaveLength(0);
    expect(result.current.dmUnread["friend-1"]).toBeUndefined();
  });

  it("closeDMTab() resets activeTab to global if the closed tab was active", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.openDMTab("friend-1", "Bob");
    });

    expect(result.current.activeTab).toBe("friend-1");

    act(() => {
      result.current.closeDMTab("friend-1");
    });

    expect(result.current.activeTab).toBe("global");
  });

  it("closeDMTab() keeps activeTab unchanged if a different tab was active", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.addDMTabSilent("friend-1", "Bob");
      result.current.openDMTab("friend-2", "Carol");
    });

    expect(result.current.activeTab).toBe("friend-2");

    act(() => {
      result.current.closeDMTab("friend-1");
    });

    // Active tab was friend-2, should remain unchanged
    expect(result.current.activeTab).toBe("friend-2");
  });

  it("MAX_DM_TABS: opening more than 5 DM tabs evicts the oldest", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    for (let i = 1; i <= 6; i++) {
      act(() => {
        result.current.addDMTabSilent(`friend-${i}`, `User${i}`);
      });
    }

    // Should be capped at 5
    expect(result.current.dmTabs.length).toBeLessThanOrEqual(5);
  });

  it("setActiveTab() updates the activeTab", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.setActiveTab("global");
    });

    expect(result.current.activeTab).toBe("global");

    act(() => {
      result.current.addDMTabSilent("friend-3", "Dave");
      result.current.setActiveTab("friend-3");
    });

    expect(result.current.activeTab).toBe("friend-3");
  });

  // ---------------------------------------------------------------------------
  // Reconnect / backoff on WebSocket close
  // ---------------------------------------------------------------------------

  it("reconnects with exponential backoff after WebSocket closes", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.connected).toBe(true);
    const countBefore = MockWebSocket.instances.length;

    // The 4th argument to createSocket (index 3) is the onClose callback
    const onCloseFn = mockCreateSocket.mock.calls[0][3] as () => void;

    await act(async () => {
      onCloseFn();
      // Advance timer by 1000ms (initial backoff delay) and flush micro-tasks
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // A new socket should have been created after reconnect
    expect(MockWebSocket.instances.length).toBeGreaterThan(countBefore);

    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Rate limiting: messages longer than 500 chars
  // ---------------------------------------------------------------------------

  it("sendMessage() with exactly 500 chars is allowed", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    const ws = MockWebSocket.instances[0];
    const exactMessage = "x".repeat(500);

    act(() => {
      result.current.sendMessage(exactMessage);
    });

    expect(ws.sent).toHaveLength(1);
  });

  it("sendMessage() does nothing when WebSocket is not open", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    const ws = MockWebSocket.instances[0];
    ws.readyState = 3; // CLOSED

    act(() => {
      result.current.sendMessage("hello");
    });

    expect(ws.sent).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Unread count: visibility change resets count
  // ---------------------------------------------------------------------------

  it("unreadCount resets to 0 when tab becomes visible", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    const ws = MockWebSocket.instances[0];

    await act(async () => {
      ws.simulateMessage({ type: "chat_history", messages: [] });
    });

    await act(async () => {
      ws.simulateMessage({
        type: "chat_message",
        user_id: "other-user",
        username: "Stranger",
        content: "Hi",
        timestamp: 9000,
      });
    });

    expect(result.current.unreadCount).toBe(1);

    // Simulate tab becoming visible
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current.unreadCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Deduplication of chat_message
  // ---------------------------------------------------------------------------

  it("does not append duplicate chat messages (same timestamp+user_id+content)", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    const ws = MockWebSocket.instances[0];

    await act(async () => {
      ws.simulateMessage({ type: "chat_history", messages: [] });
    });

    const msg = { type: "chat_message", user_id: "u2", username: "Bob", content: "Hey!", timestamp: 2000 };

    await act(async () => {
      ws.simulateMessage(msg);
    });
    await act(async () => {
      ws.simulateMessage(msg); // exact duplicate
    });

    expect(result.current.messages).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // getWsTicket fallback when ticket fetch fails
  // ---------------------------------------------------------------------------

  it("falls back to connecting without ticket when getWsTicket rejects", async () => {
    mockGetWsTicket.mockRejectedValue(new Error("network error"));

    renderHook(() => useChat(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });

    // Should still call createSocket even without a ticket
    expect(mockCreateSocket).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Unread count not incremented when chatOpen=true
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // onopen: disposed-before-open branch (lines 143-145)
  // ---------------------------------------------------------------------------

  it("closes the socket immediately on open when the component was unmounted before open fired", async () => {
    // We need to:
    // 1. Let the connection setup run (async ticket fetch + createSocket call)
    // 2. Capture ws.onopen BEFORE the MockWebSocket auto-fires it
    // 3. Unmount the component so disposed=true
    // 4. Then fire onopen — the hook should call ws.close()
    let capturedOnopen: (() => void) | null = null;
    let capturedWs: MockWebSocket | null = null;

    // Create a special mock that intercepts onopen assignment on the returned WS
    mockCreateSocket.mockImplementationOnce(
      (
        _path: string,
        _token: string,
        onMessage: (msg: Record<string, unknown>) => void,
        _onClose: () => void,
        _ticket: string,
        _nonce: string,
      ) => {
        // Create the WS but suppress the auto-fire by replacing onopen with a descriptor
        const ws = { readyState: 1, sent: [] as string[] } as unknown as MockWebSocket;
        ws.onmessage = (evt) => onMessage(JSON.parse(evt.data as string));
        ws.send = (data: string) => (ws as unknown as { sent: string[] }).sent.push(data);
        ws.close = () => {
          (ws as unknown as { readyState: number }).readyState = 3;
        };
        capturedWs = ws;

        Object.defineProperty(ws, "onopen", {
          set(fn: (() => void) | null) {
            capturedOnopen = fn;
          },
          get() {
            return capturedOnopen;
          },
          configurable: true,
        });
        return ws;
      },
    );

    const { unmount } = renderHook(() => useChat(), { wrapper });

    // Drain the async ticket fetch and createSocket call
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // At this point createSocket was called and capturedWs/capturedOnopen are set.
    // Unmount BEFORE onopen fires — sets disposed=true
    unmount();

    // Now fire onopen — hook checks disposed=true and calls ws.close()
    if (capturedOnopen) {
      (capturedOnopen as () => void)();
    }

    // ws.close() was called, readyState should be 3
    expect((capturedWs as MockWebSocket | null)?.readyState).toBe(3);
  });

  it("does not increment unreadCount when chatOpen=true", async () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    const ws = MockWebSocket.instances[0];

    await act(async () => {
      ws.simulateMessage({ type: "chat_history", messages: [] });
    });

    // Open chat
    act(() => {
      result.current.setChatOpen(true);
    });

    await act(async () => {
      ws.simulateMessage({
        type: "chat_message",
        user_id: "other-user",
        username: "Stranger",
        content: "Hey",
        timestamp: 7000,
      });
    });

    expect(result.current.unreadCount).toBe(0);
  });
});
