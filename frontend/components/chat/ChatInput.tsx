"use client";

import { SendHorizontal } from "lucide-react";
import { type KeyboardEvent, useCallback, useState } from "react";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
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
    [handleSend],
  );

  return (
    <div className="flex items-center gap-1.5 border-t border-border px-3 py-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 500))}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "Łączenie..." : (placeholder ?? "Napisz wiadomość...")}
        disabled={disabled}
        className="flex-1 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs md:text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/30 focus:outline-none disabled:opacity-40"
      />
      <button
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-30"
      >
        <SendHorizontal className="h-4 w-4" />
      </button>
    </div>
  );
}
