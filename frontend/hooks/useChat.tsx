"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getWsTicket } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { solveChallenge } from "@/lib/pow";
import { createSocket } from "@/lib/ws";

export interface ChatMessage {
  user_id: string;
  username: string;
  content: string;
  timestamp: number;
}

export interface DMTab {
  friendId: string;
  friendUsername: string;
}

interface ChatContextType {
  messages: ChatMessage[];
  connected: boolean;
  sendMessage: (content: string) => void;
  unreadCount: number;
  resetUnread: () => void;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  // DM tab management
  activeTab: "global" | string;
  dmTabs: DMTab[];
  dmUnread: Record<string, number>;
  openDMTab: (friendId: string, friendUsername: string) => void;
  addDMTabSilent: (friendId: string, friendUsername: string) => void;
  closeDMTab: (friendId: string) => void;
  setActiveTab: (tab: "global" | string) => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

const MAX_DM_TABS = 5;

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"global" | string>("global");
  const [dmTabs, setDmTabs] = useState<DMTab[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const userIdRef = useRef<string | null>(null);
  const chatOpenRef = useRef(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
  }, [chatOpen]);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  // Update document title with unread count
  useEffect(() => {
    if (unreadCount > 0) {
      document.title = `(${unreadCount}) Zelqor`;
    } else {
      document.title = "Zelqor";
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
    if (!isAuthenticated() || !user) return;

    let disposed = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let backoffDelay = 1000;
    initializedRef.current = false;

    const connect = async () => {
      let ticket: string | null = null;
      let nonce: string | null = null;
      try {
        const t = await getWsTicket();
        ticket = t.ticket;
        nonce = await solveChallenge(t.challenge, t.difficulty);
      } catch {
        // Fallback: connect without ticket/pow
      }
      const ws = createSocket(
        "/chat/",
        null,
        (msg) => {
          if (msg.type === "chat_history") {
            setMessages((msg.messages as ChatMessage[]) || []);
            initializedRef.current = true;
          } else if (msg.type === "chat_message") {
            setMessages((prev) => {
              // Deduplicate by timestamp + user_id + content
              const cm = msg as unknown as ChatMessage;
              const isDup = prev.some(
                (m) => m.timestamp === cm.timestamp && m.user_id === cm.user_id && m.content === cm.content,
              );
              if (isDup) return prev;
              return [...prev.slice(-199), cm];
            });
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

  const [dmUnread, setDmUnread] = useState<Record<string, number>>({});

  const openDMTab = useCallback((friendId: string, friendUsername: string) => {
    setDmTabs((prev) => {
      const exists = prev.some((t) => t.friendId === friendId);
      if (exists) return prev;
      const next = [...prev, { friendId, friendUsername }];
      return next.slice(-MAX_DM_TABS);
    });
    setActiveTab(friendId);
    setChatOpen(true);
    setDmUnread((prev) => {
      const next = { ...prev };
      delete next[friendId];
      return next;
    });
  }, []);

  const addDMTabSilent = useCallback((friendId: string, friendUsername: string) => {
    setDmTabs((prev) => {
      const exists = prev.some((t) => t.friendId === friendId);
      if (exists) return prev;
      const next = [...prev, { friendId, friendUsername }];
      return next.slice(-MAX_DM_TABS);
    });
    setDmUnread((prev) => ({ ...prev, [friendId]: (prev[friendId] || 0) + 1 }));
  }, []);

  const closeDMTab = useCallback((friendId: string) => {
    setDmTabs((prev) => prev.filter((t) => t.friendId !== friendId));
    setActiveTab((current) => (current === friendId ? "global" : current));
    setDmUnread((prev) => {
      const next = { ...prev };
      delete next[friendId];
      return next;
    });
  }, []);

  return (
    <ChatContext.Provider
      value={{
        messages,
        connected,
        sendMessage,
        unreadCount,
        resetUnread,
        chatOpen,
        setChatOpen,
        activeTab,
        dmTabs,
        dmUnread,
        openDMTab,
        addDMTabSilent,
        closeDMTab,
        setActiveTab,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
