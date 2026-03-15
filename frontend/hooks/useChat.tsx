"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { createSocket } from "@/lib/ws";
import { getAccessToken } from "@/lib/auth";
import { getWsTicket } from "@/lib/api";
import { solveChallenge } from "@/lib/pow";
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
  unreadCount: number;
  resetUnread: () => void;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const userIdRef = useRef<string | null>(null);
  const chatOpenRef = useRef(false);
  const initializedRef = useRef(false);

  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  // Update document title with unread count
  useEffect(() => {
    if (unreadCount > 0) {
      document.title = `(${unreadCount}) MapLord`;
    } else {
      document.title = "MapLord";
    }
  }, [unreadCount]);

  // Reset unread when tab becomes visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        setUnreadCount(0);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token || !user) return;

    let disposed = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let backoffDelay = 1000;
    initializedRef.current = false;

    const connect = async () => {
      let ticket: string | null = null;
      let nonce: string | null = null;
      try {
        const t = await getWsTicket(token);
        ticket = t.ticket;
        nonce = await solveChallenge(t.challenge, t.difficulty);
      } catch {
        // Fallback: connect without ticket/pow
      }
      const ws = createSocket(
        "/chat/",
        token,
        (msg) => {
          if (msg.type === "chat_history") {
            setMessages((msg.messages as ChatMessage[]) || []);
            initializedRef.current = true;
          } else if (msg.type === "chat_message") {
            setMessages((prev) => [...prev.slice(-199), msg as unknown as ChatMessage]);
            // Unread for messages from others when chat is closed or tab is hidden
            if (initializedRef.current && msg.user_id !== userIdRef.current) {
              if (!chatOpenRef.current || document.visibilityState === "hidden") {
                setUnreadCount((c) => c + 1);
              }
            }
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
        },
        ticket,
        nonce,
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

  const resetUnread = useCallback(() => setUnreadCount(0), []);

  return (
    <ChatContext.Provider value={{ messages, connected, sendMessage, unreadCount, resetUnread, chatOpen, setChatOpen }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
