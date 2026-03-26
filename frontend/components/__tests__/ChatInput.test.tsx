import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock lucide-react icons
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => ({
  SendHorizontal: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-send", className }),
}));

import { ChatInput } from "@/components/chat/ChatInput";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Renders ──────────────────────────────────────────────────────────────

  it("renders the input field", () => {
    render(React.createElement(ChatInput, { onSend: vi.fn() }));
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("renders the send button", () => {
    render(React.createElement(ChatInput, { onSend: vi.fn() }));
    expect(screen.getByLabelText("Wyślij wiadomość")).toBeTruthy();
  });

  it("shows default placeholder when not disabled", () => {
    render(React.createElement(ChatInput, { onSend: vi.fn() }));
    expect(screen.getByPlaceholderText("Napisz wiadomość...")).toBeTruthy();
  });

  it("shows custom placeholder when provided", () => {
    render(React.createElement(ChatInput, { onSend: vi.fn(), placeholder: "Napisz..." }));
    expect(screen.getByPlaceholderText("Napisz...")).toBeTruthy();
  });

  it("shows 'Łączenie...' placeholder when disabled", () => {
    render(React.createElement(ChatInput, { onSend: vi.fn(), disabled: true }));
    expect(screen.getByPlaceholderText("Łączenie...")).toBeTruthy();
  });

  // ── handleSend (lines 15-20) ──────────────────────────────────────────────

  it("calls onSend with trimmed value when send button is clicked", () => {
    const onSend = vi.fn();
    render(React.createElement(ChatInput, { onSend }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  Hello world  " } });
    fireEvent.click(screen.getByLabelText("Wyślij wiadomość"));
    expect(onSend).toHaveBeenCalledWith("Hello world");
  });

  it("does not call onSend when value is empty", () => {
    const onSend = vi.fn();
    render(React.createElement(ChatInput, { onSend }));
    fireEvent.click(screen.getByLabelText("Wyślij wiadomość"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not call onSend when value is only whitespace", () => {
    const onSend = vi.fn();
    render(React.createElement(ChatInput, { onSend }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByLabelText("Wyślij wiadomość"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("clears input after send", () => {
    const onSend = vi.fn();
    render(React.createElement(ChatInput, { onSend }));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Test message" } });
    fireEvent.click(screen.getByLabelText("Wyślij wiadomość"));
    expect(input.value).toBe("");
  });

  // ── handleKeyDown (lines 22-29) ───────────────────────────────────────────

  it("calls onSend when Enter key is pressed", () => {
    const onSend = vi.fn();
    render(React.createElement(ChatInput, { onSend }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Enter message" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledWith("Enter message");
  });

  it("does not call onSend when Shift+Enter is pressed", () => {
    const onSend = vi.fn();
    render(React.createElement(ChatInput, { onSend }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Shift enter" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not call onSend when a non-Enter key is pressed", () => {
    const onSend = vi.fn();
    render(React.createElement(ChatInput, { onSend }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Some text" } });
    fireEvent.keyDown(input, { key: "a" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("clears input after Enter key sends the message", () => {
    const onSend = vi.fn();
    render(React.createElement(ChatInput, { onSend }));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Key message" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    expect(input.value).toBe("");
  });

  // ── Send button disabled states ───────────────────────────────────────────

  it("send button is disabled when input is empty", () => {
    render(React.createElement(ChatInput, { onSend: vi.fn() }));
    const btn = screen.getByLabelText("Wyślij wiadomość") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("send button is enabled when input has text", () => {
    render(React.createElement(ChatInput, { onSend: vi.fn() }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "some text" } });
    const btn = screen.getByLabelText("Wyślij wiadomość") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("send button is disabled when disabled prop is true even with text", () => {
    render(React.createElement(ChatInput, { onSend: vi.fn(), disabled: true }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "some text" } });
    const btn = screen.getByLabelText("Wyślij wiadomość") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  // ── Character limit ───────────────────────────────────────────────────────

  it("truncates input to 500 characters", () => {
    render(React.createElement(ChatInput, { onSend: vi.fn() }));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    const longText = "a".repeat(600);
    fireEvent.change(input, { target: { value: longText } });
    expect(input.value.length).toBe(500);
  });
});
