"use client";

import { useEffect, useRef } from "react";

export interface ChatMessage {
  user_id: string;
  username: string;
  content: string;
  timestamp: number;
}

interface MessageListProps {
  messages: ChatMessage[];
  currentUserId: string;
}

export function MessageList({ messages, currentUserId }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 text-muted-foreground">
        <span className="text-xs">Brak wiadomości</span>
        <span className="text-caption text-muted-foreground/50">Napisz pierwszą!</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-3 py-2 space-y-1 scrollbar-thin scrollbar-thumb-border"
    >
      {messages.map((msg, i) => {
        const isOwn = msg.user_id === currentUserId;
        const time = new Date(msg.timestamp * 1000);
        const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        // Group: hide username if same user as previous message
        const prevMsg = i > 0 ? messages[i - 1] : null;
        const sameUser = prevMsg?.user_id === msg.user_id;

        return (
          <div
            key={`${msg.timestamp}-${i}`}
            className={`text-xs md:text-sm leading-relaxed ${sameUser ? "" : "pt-1.5"}`}
          >
            {!sameUser && (
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`text-xs md:text-sm font-semibold ${isOwn ? "text-primary" : "text-foreground"}`}>
                  {msg.username}
                </span>
                <span className="text-caption md:text-xs text-muted-foreground/50 tabular-nums">{timeStr}</span>
              </div>
            )}
            <p className="break-words text-foreground/80">{msg.content}</p>
          </div>
        );
      })}
    </div>
  );
}
