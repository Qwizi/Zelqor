import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock API and auth modules
// ---------------------------------------------------------------------------

const mockGetVapidKey = vi.fn();
const mockSubscribePush = vi.fn();
const mockUnsubscribePush = vi.fn();
const mockGetAccessToken = vi.fn();

vi.mock("@/lib/api", () => ({
  getVapidKey: (...args: unknown[]) => mockGetVapidKey(...args),
  subscribePush: (...args: unknown[]) => mockSubscribePush(...args),
  unsubscribePush: (...args: unknown[]) => mockUnsubscribePush(...args),
}));

vi.mock("@/lib/auth", () => ({
  isAuthenticated: () => mockGetAccessToken() !== null,
  setAuthenticated: vi.fn(),
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
  getRefreshToken: vi.fn(() => null),
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
  isLoggedIn: vi.fn(() => true),
}));

import { usePushNotifications } from "../usePushNotifications";

// ---------------------------------------------------------------------------
// Push API mock helpers
// ---------------------------------------------------------------------------

function makeMockSubscription(endpoint = "https://push.example.com/endpoint") {
  return {
    endpoint,
    toJSON: vi.fn(() => ({
      endpoint,
      keys: { p256dh: "mock-p256dh", auth: "mock-auth" },
    })),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

function setupServiceWorkerMock(sub: ReturnType<typeof makeMockSubscription> | null = null) {
  const mockPushManager = {
    getSubscription: vi.fn().mockResolvedValue(sub),
    subscribe: vi.fn().mockResolvedValue(sub ?? makeMockSubscription()),
  };
  const mockRegistration = {
    pushManager: mockPushManager,
  };
  const mockServiceWorker = {
    ready: Promise.resolve(mockRegistration),
  };
  Object.defineProperty(navigator, "serviceWorker", {
    value: mockServiceWorker,
    writable: true,
    configurable: true,
  });
  return { mockPushManager, mockRegistration };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePushNotifications", () => {
  const originalNotification = globalThis.Notification;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockGetAccessToken.mockReturnValue("access-token");
    mockGetVapidKey.mockResolvedValue("mock-vapid-key");
    mockSubscribePush.mockResolvedValue(undefined);
    mockUnsubscribePush.mockResolvedValue(undefined);

    // Default: notifications supported, permission=default
    Object.defineProperty(globalThis, "Notification", {
      value: Object.assign(function Notification() {}, {
        permission: "default" as NotificationPermission,
        requestPermission: vi.fn().mockResolvedValue("granted"),
      }),
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "Notification", {
      value: originalNotification,
      writable: true,
      configurable: true,
    });
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  it("returns correct initial state when no subscription exists", async () => {
    setupServiceWorkerMock(null);

    const { result } = renderHook(() => usePushNotifications());

    expect(result.current.permission).toBe("default");
    expect(result.current.subscribed).toBe(false);
    expect(typeof result.current.subscribe).toBe("function");
    expect(typeof result.current.unsubscribe).toBe("function");
    expect(typeof result.current.dismiss).toBe("function");
  });

  it("detects existing subscription on mount", async () => {
    const sub = makeMockSubscription();
    setupServiceWorkerMock(sub);

    const { result } = renderHook(() => usePushNotifications());

    // Wait for async effect to settle
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.subscribed).toBe(true);
  });

  it("reads Notification.permission on mount", async () => {
    Object.defineProperty(
      (globalThis as typeof globalThis & { Notification: { permission: NotificationPermission } }).Notification,
      "permission",
      {
        value: "granted",
        writable: true,
        configurable: true,
      },
    );
    setupServiceWorkerMock(null);

    const { result } = renderHook(() => usePushNotifications());

    expect(result.current.permission).toBe("granted");
  });

  it("returns subscribed=false when no existing subscription found", async () => {
    setupServiceWorkerMock(null);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.subscribed).toBe(false);
  });

  // ── subscribe() flow ───────────────────────────────────────────────────────

  it("subscribe() requests permission, gets vapid key, and creates push subscription", async () => {
    const sub = makeMockSubscription();
    const { mockPushManager } = setupServiceWorkerMock(null);
    mockPushManager.subscribe.mockResolvedValue(sub);

    const { result } = renderHook(() => usePushNotifications());

    let returnValue: boolean | undefined;
    await act(async () => {
      returnValue = await result.current.subscribe();
    });

    expect(globalThis.Notification.requestPermission).toHaveBeenCalled();
    expect(mockGetVapidKey).toHaveBeenCalled();
    expect(mockPushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });
    expect(mockSubscribePush).toHaveBeenCalledWith({
      endpoint: "https://push.example.com/endpoint",
      p256dh: "mock-p256dh",
      auth: "mock-auth",
    });
    expect(result.current.subscribed).toBe(true);
    expect(returnValue).toBe(true);
  });

  it("subscribe() returns false when no access token", async () => {
    mockGetAccessToken.mockReturnValue(null);
    setupServiceWorkerMock(null);

    const { result } = renderHook(() => usePushNotifications());

    let returnValue: boolean | undefined;
    await act(async () => {
      returnValue = await result.current.subscribe();
    });

    expect(returnValue).toBe(false);
    expect(result.current.subscribed).toBe(false);
  });

  it("subscribe() returns false when permission is denied", async () => {
    (globalThis.Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue("denied");
    setupServiceWorkerMock(null);

    const { result } = renderHook(() => usePushNotifications());

    let returnValue: boolean | undefined;
    await act(async () => {
      returnValue = await result.current.subscribe();
    });

    expect(returnValue).toBe(false);
    expect(result.current.subscribed).toBe(false);
    expect(result.current.permission).toBe("denied");
  });

  it("subscribe() updates permission state from requestPermission result", async () => {
    (globalThis.Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue("granted");
    const sub = makeMockSubscription();
    const { mockPushManager } = setupServiceWorkerMock(null);
    mockPushManager.subscribe.mockResolvedValue(sub);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.permission).toBe("granted");
  });

  it("subscribe() returns false and does not throw on API error", async () => {
    (globalThis.Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue("granted");
    mockGetVapidKey.mockRejectedValue(new Error("Network error"));
    setupServiceWorkerMock(null);

    const { result } = renderHook(() => usePushNotifications());

    let returnValue: boolean | undefined;
    await act(async () => {
      returnValue = await result.current.subscribe();
    });

    expect(returnValue).toBe(false);
    expect(result.current.subscribed).toBe(false);
  });

  // ── unsubscribe() flow ─────────────────────────────────────────────────────

  it("unsubscribe() calls unsubscribePush API and sets subscribed=false", async () => {
    const sub = makeMockSubscription();
    const { mockPushManager } = setupServiceWorkerMock(sub);
    mockPushManager.getSubscription.mockResolvedValue(sub);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(mockUnsubscribePush).toHaveBeenCalledWith("https://push.example.com/endpoint");
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(result.current.subscribed).toBe(false);
  });

  it("unsubscribe() is a no-op when no access token", async () => {
    mockGetAccessToken.mockReturnValue(null);
    setupServiceWorkerMock(null);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(mockUnsubscribePush).not.toHaveBeenCalled();
  });

  it("unsubscribe() sets subscribed=false even when no existing subscription", async () => {
    const { mockPushManager } = setupServiceWorkerMock(null);
    mockPushManager.getSubscription.mockResolvedValue(null);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(result.current.subscribed).toBe(false);
    expect(mockUnsubscribePush).not.toHaveBeenCalled();
  });

  it("unsubscribe() does not throw on error", async () => {
    const { mockPushManager } = setupServiceWorkerMock(null);

    const { result } = renderHook(() => usePushNotifications());

    // Make getSubscription reject only after the hook mounts
    await act(async () => {
      await Promise.resolve();
    });
    mockPushManager.getSubscription.mockRejectedValue(new Error("SW error"));

    // unsubscribe catches all errors internally
    let threw = false;
    await act(async () => {
      try {
        await result.current.unsubscribe();
      } catch {
        threw = true;
      }
    });

    expect(threw).toBe(false);
  });

  // ── Permission handling ────────────────────────────────────────────────────

  it("reflects denied permission after subscribe attempt", async () => {
    (globalThis.Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue("denied");
    setupServiceWorkerMock(null);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.permission).toBe("denied");
  });

  // ── showPrompt ─────────────────────────────────────────────────────────────

  it("showPrompt is true when autoPrompt=true and permission=default and not dismissed", () => {
    setupServiceWorkerMock(null);

    const { result } = renderHook(() => usePushNotifications(true));

    expect(result.current.showPrompt).toBe(true);
  });

  it("showPrompt is false when autoPrompt=false", () => {
    setupServiceWorkerMock(null);

    const { result } = renderHook(() => usePushNotifications(false));

    expect(result.current.showPrompt).toBe(false);
  });

  it("showPrompt is false when permission is granted", () => {
    Object.defineProperty(
      (globalThis as typeof globalThis & { Notification: { permission: NotificationPermission } }).Notification,
      "permission",
      {
        value: "granted",
        writable: true,
        configurable: true,
      },
    );
    setupServiceWorkerMock(null);

    const { result } = renderHook(() => usePushNotifications(true));

    expect(result.current.showPrompt).toBe(false);
  });

  // ── dismiss() ─────────────────────────────────────────────────────────────

  it("dismiss() sets sessionStorage flag to suppress prompt", () => {
    setupServiceWorkerMock(null);

    const { result } = renderHook(() => usePushNotifications(true));

    act(() => {
      result.current.dismiss();
    });

    expect(sessionStorage.getItem("maplord_push_dismissed")).toBe("1");
  });
});
