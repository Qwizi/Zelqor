import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock lucide-react
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => ({
  MessageSquare: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-message-square", className }),
  ChevronDown: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-chevron-down", className }),
  ChevronUp: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-chevron-up", className }),
  X: ({ className }: { className?: string }) => React.createElement("span", { "data-testid": "icon-x", className }),
  SendHorizontal: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-send", className }),
}));

// ---------------------------------------------------------------------------
// Silence Audio not supported in jsdom
// ---------------------------------------------------------------------------

vi.stubGlobal(
  "Audio",
  class {
    volume = 1;
    play() {
      return Promise.resolve();
    }
  },
);

import MatchChatPanel from "@/components/chat/MatchChatPanel";
import type { ChatMessage } from "@/components/chat/MessageList";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CURRENT_USER_ID = "user-me";

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    user_id: "user-other",
    username: "Bravo",
    content: "Hello world",
    timestamp: 1700000000,
    ...overrides,
  };
}

const defaultProps = {
  messages: [] as ChatMessage[],
  currentUserId: CURRENT_USER_ID,
  onSend: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MatchChatPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the FAB button for mobile", () => {
    render(React.createElement(MatchChatPanel, defaultProps));
    expect(screen.getByTitle("Czat meczu")).toBeTruthy();
  });

  it("renders the desktop panel header", () => {
    render(React.createElement(MatchChatPanel, defaultProps));
    // "Czat meczu" text is in desktop panel header too
    const labels = screen.getAllByText("Czat meczu");
    expect(labels.length).toBeGreaterThan(0);
  });

  it("shows message content when messages are present", () => {
    const messages = [makeMessage({ content: "Hello world" })];
    render(React.createElement(MatchChatPanel, { ...defaultProps, messages }));
    expect(screen.getByText("Hello world")).toBeTruthy();
  });

  it("shows sender username in message list", () => {
    const messages = [makeMessage({ username: "Bravo", user_id: "user-opp" })];
    render(React.createElement(MatchChatPanel, { ...defaultProps, messages }));
    expect(screen.getByText("Bravo")).toBeTruthy();
  });

  it("shows empty state when no messages", () => {
    render(React.createElement(MatchChatPanel, { ...defaultProps, messages: [] }));
    expect(screen.getByText("Brak wiadomości")).toBeTruthy();
  });

  it("renders the chat input field in desktop expanded view", () => {
    render(React.createElement(MatchChatPanel, defaultProps));
    const inputs = screen.getAllByRole("textbox");
    expect(inputs.length).toBeGreaterThan(0);
  });

  it("calls onSend with message content when send button clicked", () => {
    const onSend = vi.fn();
    render(React.createElement(MatchChatPanel, { ...defaultProps, onSend }));
    const inputs = screen.getAllByRole("textbox");
    // Type into the first input
    fireEvent.change(inputs[0], { target: { value: "Test message" } });
    const sendButtons = screen.getAllByRole("button");
    const sendBtn = sendButtons.find((b) => b.querySelector('[data-testid="icon-send"]'));
    if (sendBtn) fireEvent.click(sendBtn);
    expect(onSend).toHaveBeenCalledWith("Test message");
  });

  it("calls onSend when Enter key is pressed in input", () => {
    const onSend = vi.fn();
    render(React.createElement(MatchChatPanel, { ...defaultProps, onSend }));
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "Enter test" } });
    fireEvent.keyDown(inputs[0], { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledWith("Enter test");
  });

  it("shows message count in mobile bottom sheet header", () => {
    const messages = [makeMessage(), makeMessage({ content: "Second" })];
    render(React.createElement(MatchChatPanel, { ...defaultProps, messages }));
    // Open mobile sheet
    fireEvent.click(screen.getByTitle("Czat meczu"));
    // Message count should appear somewhere
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });

  it("shows mobile bottom sheet when FAB is clicked", () => {
    render(React.createElement(MatchChatPanel, defaultProps));
    fireEvent.click(screen.getByTitle("Czat meczu"));
    // The mobile sheet close button (X) should now be visible
    expect(screen.getByTestId("icon-x")).toBeTruthy();
  });

  it("closes mobile sheet when close button is clicked", () => {
    render(React.createElement(MatchChatPanel, defaultProps));
    fireEvent.click(screen.getByTitle("Czat meczu"));
    // Find close button by icon
    const closeBtn = screen.getByTestId("icon-x").closest("button");
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);
    expect(screen.queryByTestId("icon-x")).toBeNull();
  });

  it("shows unread badge when new messages arrive while chat is collapsed", () => {
    // Start with 1 existing message so initializedRef is set to true on first render
    const firstMessage = makeMessage({ user_id: "user-other", content: "Existing" });
    const { rerender } = render(
      React.createElement(MatchChatPanel, {
        messages: [firstMessage],
        currentUserId: CURRENT_USER_ID,
        onSend: vi.fn(),
      }),
    );

    // Collapse desktop panel by clicking the header toggle
    const desktopToggle = screen
      .getAllByText("Czat meczu")
      .map((el) => el.closest("button"))
      .find((btn) => btn !== null);
    if (desktopToggle) fireEvent.click(desktopToggle);

    // Now rerender with a new message from another user
    const secondMessage = makeMessage({ user_id: "user-other", content: "New!" });
    rerender(
      React.createElement(MatchChatPanel, {
        messages: [firstMessage, secondMessage],
        currentUserId: CURRENT_USER_ID,
        onSend: vi.fn(),
      }),
    );

    // Unread badge with count "1" appears on both mobile FAB and desktop collapsed panel
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("renders multiple messages in order", () => {
    const messages = [
      makeMessage({ content: "First message", timestamp: 1700000000 }),
      makeMessage({ content: "Second message", timestamp: 1700000001, user_id: CURRENT_USER_ID, username: "Me" }),
    ];
    render(React.createElement(MatchChatPanel, { ...defaultProps, messages }));
    expect(screen.getByText("First message")).toBeTruthy();
    expect(screen.getByText("Second message")).toBeTruthy();
  });

  it("does not show unread count for own messages", () => {
    const { rerender } = render(
      React.createElement(MatchChatPanel, {
        messages: [],
        currentUserId: CURRENT_USER_ID,
        onSend: vi.fn(),
      }),
    );

    // Collapse the panel
    const toggles = screen
      .getAllByText("Czat meczu")
      .map((el) => el.closest("button"))
      .filter(Boolean);
    if (toggles[0]) fireEvent.click(toggles[0]);

    // Own message arrives
    rerender(
      React.createElement(MatchChatPanel, {
        messages: [makeMessage({ user_id: CURRENT_USER_ID, username: "Me", content: "My msg" })],
        currentUserId: CURRENT_USER_ID,
        onSend: vi.fn(),
      }),
    );

    // No unread badge — own messages don't trigger notification
    const badge = screen.queryByText("1");
    expect(badge).toBeNull();
  });
});
