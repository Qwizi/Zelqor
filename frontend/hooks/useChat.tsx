"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { createSocket } from "@/lib/ws";
import { getAccessToken } from "@/lib/auth";
import { useAuth } from "@/hooks/useAuth";

export interface ChatMessage {
  user_id: string;
  username: string;
  content: string;
  timestamp: number;
}

interface ChatContextType {
  messages: ChatMessage[];
  connected: boolean;
  sendMessage: (content: string) => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token || !user) return;

    let disposed = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let backoffDelay = 1000;

    const connect = () => {
      const ws = createSocket(
        "/chat/",
        token,
        (msg) => {
          if (msg.type === "chat_history") {
            setMessages((msg.messages as ChatMessage[]) || []);
          } else if (msg.type === "chat_message") {
            setMessages((prev) => [...prev.slice(-199), msg as unknown as ChatMessage]);
          }
        },
        () => {
          if (!disposed) {
            setConnected(false);
            const delay = backoffDelay;
            backoffDelay = Math.min(delay * 2, 10000);
            retryTimeout = setTimeout(() => {
              if (!disposed) connect();
            }, delay);
          }
        }
      );

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        backoffDelay = 1000;
        setConnected(true);
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.close();
      wsRef.current = null;
    };
  }, [user]);

  const sendMessage = useCallback((content: string) => {
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 500) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "chat_message", content: trimmed }));
    }
  }, []);

  return (
    <ChatContext.Provider value={{ messages, connected, sendMessage }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
