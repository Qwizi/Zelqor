import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock WebSocket before any module under test is imported so the module-level
// WS_BASE expression sees a stable window.location.
// ---------------------------------------------------------------------------

class MockWebSocket {
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  static instances: MockWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(_data: string) {}
  close() {}

  /** Helper: simulate an incoming message from the server. */
  simulateMessage(data: unknown) {
    const event = new MessageEvent("message", {
      data: JSON.stringify(data),
    });
    this.onmessage?.(event);
  }

  /** Helper: simulate a close event. */
  simulateClose(code = 1000) {
    const event = new CloseEvent("close", { code });
    this.onclose?.(event);
  }
}

// Replace the global WebSocket with our mock.
vi.stubGlobal("WebSocket", MockWebSocket);

// Also set a stable window.location so WS_BASE is deterministic.
Object.defineProperty(window, "location", {
  value: {
    protocol: "https:",
    host: "maplord.test",
    origin: "https://maplord.test",
  },
  writable: true,
});

// Now import the module under test AFTER the globals are in place.
import { createSocket } from "../ws";

describe("createSocket", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("constructs a WebSocket instance", () => {
    createSocket("/game/1", "tok", vi.fn());
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("includes the token as a query parameter", () => {
    createSocket("/game/1", "mytoken", vi.fn());
    expect(MockWebSocket.instances[0].url).toContain("token=mytoken");
  });

  it("omits the token parameter when token is null", () => {
    createSocket("/game/1", null, vi.fn());
    expect(MockWebSocket.instances[0].url).not.toContain("token=");
  });

  it("appends ticket and nonce when provided", () => {
    createSocket("/game/1", "tok", vi.fn(), undefined, "ticket123", "nonce456");
    const { url } = MockWebSocket.instances[0];
    expect(url).toContain("ticket=ticket123");
    expect(url).toContain("nonce=nonce456");
  });

  it("calls onMessage with parsed JSON on message event", () => {
    const handler = vi.fn();
    createSocket("/game/1", "tok", handler);
    const ws = MockWebSocket.instances[0];
    ws.simulateMessage({ type: "game_state", tick: 42 });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ type: "game_state", tick: 42 });
  });

  it("calls onClose when the socket closes", () => {
    const closeHandler = vi.fn();
    createSocket("/game/1", "tok", vi.fn(), closeHandler);
    const ws = MockWebSocket.instances[0];
    ws.simulateClose(1001);
    expect(closeHandler).toHaveBeenCalledOnce();
  });

  it("does not throw when a malformed JSON message is received", () => {
    const handler = vi.fn();
    createSocket("/game/1", "tok", handler);
    const ws = MockWebSocket.instances[0];
    const badEvent = new MessageEvent("message", { data: "{not json}" });
    expect(() => ws.onmessage?.(badEvent)).not.toThrow();
    // handler should NOT have been called with invalid JSON
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns the WebSocket instance", () => {
    const result = createSocket("/matchmaking", null, vi.fn());
    expect(result).toBeInstanceOf(MockWebSocket);
  });
});
