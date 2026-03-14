"use client";

import { useEffect, useRef } from "react";

interface ChatMessage {
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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
        No messages yet
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-1">
      {messages.map((msg, i) => {
        const isOwn = msg.user_id === currentUserId;
        const time = new Date(msg.timestamp * 1000);
        const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        return (
          <div key={`${msg.timestamp}-${i}`} className="text-xs">
            <span className="text-muted-foreground">[{timeStr}]</span>{" "}
            <span className={isOwn ? "text-primary font-semibold" : "font-semibold"}>
              {msg.username}:
            </span>{" "}
            <span className="break-words">{msg.content}</span>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
