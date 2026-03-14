"use client";

import { useState, useCallback, type KeyboardEvent } from "react";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  }, [value, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="border-t border-border p-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 500))}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "Connecting..." : "Type a message..."}
        disabled={disabled}
        className="w-full bg-muted/50 border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
      />
    </div>
  );
}
