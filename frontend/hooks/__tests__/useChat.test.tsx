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
  getAccessToken: () => mockGetAccessToken(),
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

  it("calls createSocket when user and token are present", async () => {
    renderHook(() => useChat(), { wrapper });
    await act(async () => {});

    expect(mockCreateSocket).toHaveBeenCalledOnce();
    const [path, token] = mockCreateSocket.mock.calls[0] as [string, string];
    expect(path).toBe("/chat/");
    expect(token).toBe("test-token");
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
});
