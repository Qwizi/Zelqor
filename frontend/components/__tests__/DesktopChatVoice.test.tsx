import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock lucide-react icons
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => ({
  ChevronDown: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-chevron-down", className }),
  ChevronUp: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-chevron-up", className }),
  MessageSquare: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-message-square", className }),
  Mic: ({ className }: { className?: string }) => React.createElement("span", { "data-testid": "icon-mic", className }),
  MicOff: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-mic-off", className }),
  Phone: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-phone", className }),
  PhoneOff: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-phone-off", className }),
  SendHorizontal: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-send", className }),
}));

import DesktopChatVoice from "@/components/game/DesktopChatVoice";
import type { VoicePeer } from "@/hooks/useVoiceChat";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function defaultProps(overrides: Partial<Parameters<typeof DesktopChatVoice>[0]> = {}) {
  return {
    myUserId: "user-1",
    chatMessages: [],
    onSendChat: vi.fn(),
    voiceToken: null,
    voiceUrl: null,
    voiceConnected: false,
    voiceMicEnabled: true,
    voiceIsSpeaking: false,
    voicePeers: [] as VoicePeer[],
    onVoiceJoin: vi.fn(),
    onVoiceLeave: vi.fn(),
    onVoiceToggleMic: vi.fn(),
    ...overrides,
  };
}

function makeMessage(
  overrides: Partial<{ user_id: string; username: string; content: string; timestamp: number }> = {},
) {
  return {
    user_id: "user-1",
    username: "Alpha",
    content: "Hello world",
    timestamp: 1000000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DesktopChatVoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Chat panel toggle ─────────────────────────────────────────────────────

  it("renders the Czat toggle button", () => {
    render(React.createElement(DesktopChatVoice, defaultProps()));
    expect(screen.getByText("Czat")).toBeTruthy();
  });

  it("chat panel is collapsed by default (no MessageList visible)", () => {
    render(React.createElement(DesktopChatVoice, defaultProps()));
    // When collapsed there's no border-t content visible
    expect(screen.queryByText("Brak wiadomości")).toBeNull();
  });

  it("shows ChevronDown when collapsed", () => {
    render(React.createElement(DesktopChatVoice, defaultProps()));
    expect(screen.getByTestId("icon-chevron-down")).toBeTruthy();
  });

  it("opens chat panel when toggle button is clicked", () => {
    render(React.createElement(DesktopChatVoice, defaultProps()));
    fireEvent.click(screen.getByText("Czat"));
    // Now chat is open — empty message list shows "Brak wiadomości"
    expect(screen.getByText("Brak wiadomości")).toBeTruthy();
  });

  it("shows ChevronUp when chat is open", () => {
    render(React.createElement(DesktopChatVoice, defaultProps()));
    fireEvent.click(screen.getByText("Czat"));
    expect(screen.getByTestId("icon-chevron-up")).toBeTruthy();
  });

  it("closes chat panel when toggle button is clicked again", () => {
    render(React.createElement(DesktopChatVoice, defaultProps()));
    fireEvent.click(screen.getByText("Czat"));
    fireEvent.click(screen.getByText("Czat"));
    expect(screen.queryByText("Brak wiadomości")).toBeNull();
  });

  // ── MessageList renders when chat is open (line 77) ──────────────────────

  it("renders MessageList with messages when chat is open (line 77)", () => {
    const messages = [makeMessage({ content: "Hello there!" })];
    render(React.createElement(DesktopChatVoice, defaultProps({ chatMessages: messages })));
    fireEvent.click(screen.getByText("Czat"));
    // MessageList renders the message content
    expect(screen.getByText("Hello there!")).toBeTruthy();
  });

  it("renders ChatInput send button when chat is open", () => {
    render(React.createElement(DesktopChatVoice, defaultProps()));
    fireEvent.click(screen.getByText("Czat"));
    expect(screen.getByLabelText("Wyślij wiadomość")).toBeTruthy();
  });

  it("shows message count badge when chat is collapsed and messages exist", () => {
    const messages = [makeMessage(), makeMessage({ content: "Second" })];
    render(React.createElement(DesktopChatVoice, defaultProps({ chatMessages: messages })));
    // Not open: count badge should show
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("does not show message count badge when chat is open", () => {
    const messages = [makeMessage(), makeMessage({ content: "Second" })];
    render(React.createElement(DesktopChatVoice, defaultProps({ chatMessages: messages })));
    fireEvent.click(screen.getByText("Czat"));
    // When open, count badge is hidden (the "2" span is inside the !chatOpen block)
    // The count span should not be in the DOM when chatOpen = true
    expect(screen.queryByText("2")).toBeNull();
  });

  it("calls onSendChat when message is submitted via ChatInput", () => {
    const onSendChat = vi.fn();
    render(React.createElement(DesktopChatVoice, defaultProps({ onSendChat })));
    fireEvent.click(screen.getByText("Czat"));
    const input = screen.getByPlaceholderText("Napisz...");
    fireEvent.change(input, { target: { value: "Test message" } });
    fireEvent.click(screen.getByLabelText("Wyślij wiadomość"));
    expect(onSendChat).toHaveBeenCalledWith("Test message");
  });

  // ── Voice pill — not connected ────────────────────────────────────────────

  it("shows join voice button when not connected", () => {
    render(React.createElement(DesktopChatVoice, defaultProps({ voiceToken: null, voiceUrl: null })));
    // VoicePill renders with disabled state
    expect(screen.getByText(/Voice\.\.\./)).toBeTruthy();
  });

  it("shows Dołącz button when voice token is available but not connected", () => {
    render(
      React.createElement(
        DesktopChatVoice,
        defaultProps({
          voiceToken: "token123",
          voiceUrl: "ws://localhost:7880",
          voiceConnected: false,
        }),
      ),
    );
    expect(screen.getByText("Dołącz")).toBeTruthy();
  });

  it("calls onVoiceJoin when voice join button is clicked and token available", () => {
    const onVoiceJoin = vi.fn();
    render(
      React.createElement(
        DesktopChatVoice,
        defaultProps({
          voiceToken: "token123",
          voiceUrl: "ws://localhost:7880",
          voiceConnected: false,
          onVoiceJoin,
        }),
      ),
    );
    fireEvent.click(screen.getByText("Dołącz"));
    expect(onVoiceJoin).toHaveBeenCalled();
  });

  it("join button is disabled when no voice token", () => {
    render(React.createElement(DesktopChatVoice, defaultProps({ voiceToken: null, voiceUrl: null })));
    const joinBtn = screen.getByText(/Voice\.\.\./).closest("button");
    expect(joinBtn).toHaveProperty("disabled", true);
  });

  // ── Voice pill — connected ────────────────────────────────────────────────

  it("shows mic and disconnect buttons when voice is connected", () => {
    render(
      React.createElement(
        DesktopChatVoice,
        defaultProps({
          voiceToken: "tok",
          voiceUrl: "ws://localhost",
          voiceConnected: true,
          voiceMicEnabled: true,
        }),
      ),
    );
    expect(screen.getByTitle("Wycisz")).toBeTruthy();
    expect(screen.getByTitle("Rozłącz")).toBeTruthy();
  });

  it("shows MicOff icon when mic is disabled and connected", () => {
    render(
      React.createElement(
        DesktopChatVoice,
        defaultProps({
          voiceToken: "tok",
          voiceUrl: "ws://localhost",
          voiceConnected: true,
          voiceMicEnabled: false,
        }),
      ),
    );
    expect(screen.getByTitle("Włącz mikrofon")).toBeTruthy();
    expect(screen.getByTestId("icon-mic-off")).toBeTruthy();
  });

  it("calls onVoiceToggleMic when mic button is clicked", () => {
    const onVoiceToggleMic = vi.fn();
    render(
      React.createElement(
        DesktopChatVoice,
        defaultProps({
          voiceToken: "tok",
          voiceUrl: "ws://localhost",
          voiceConnected: true,
          voiceMicEnabled: true,
          onVoiceToggleMic,
        }),
      ),
    );
    fireEvent.click(screen.getByTitle("Wycisz"));
    expect(onVoiceToggleMic).toHaveBeenCalled();
  });

  it("calls onVoiceLeave when disconnect button is clicked", () => {
    const onVoiceLeave = vi.fn();
    render(
      React.createElement(
        DesktopChatVoice,
        defaultProps({
          voiceToken: "tok",
          voiceUrl: "ws://localhost",
          voiceConnected: true,
          voiceMicEnabled: true,
          onVoiceLeave,
        }),
      ),
    );
    fireEvent.click(screen.getByTitle("Rozłącz"));
    expect(onVoiceLeave).toHaveBeenCalled();
  });

  it("shows peer count badge when connected with peers", () => {
    const peers: VoicePeer[] = [
      { identity: "user-2", name: "Bravo", isSpeaking: false, isMuted: false },
      { identity: "user-3", name: "Charlie", isSpeaking: true, isMuted: false },
    ];
    render(
      React.createElement(
        DesktopChatVoice,
        defaultProps({
          voiceToken: "tok",
          voiceUrl: "ws://localhost",
          voiceConnected: true,
          voicePeers: peers,
        }),
      ),
    );
    expect(screen.getByText("2")).toBeTruthy();
  });
});
