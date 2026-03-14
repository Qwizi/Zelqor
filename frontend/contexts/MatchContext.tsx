"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";

export interface ChatMessage {
  user_id: string;
  username: string;
  content: string;
  timestamp: number;
}

interface MatchChatContextType {
  matchId: string | null;
  setMatchId: (id: string | null) => void;
  matchChatMessages: ChatMessage[];
  setMatchChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sendMatchChat: (content: string) => void;
  setSendMatchChat: (fn: (content: string) => void) => void;
}

const MatchChatContext = createContext<MatchChatContextType | null>(null);

export function MatchChatProvider({ children }: { children: ReactNode }) {
  const [matchId, setMatchId] = useState<string | null>(null);
  const [matchChatMessages, setMatchChatMessages] = useState<ChatMessage[]>([]);
  const sendFnRef = useRef<(content: string) => void>(() => {});

  const sendMatchChat = useCallback((content: string) => {
    sendFnRef.current(content);
  }, []);

  const setSendMatchChat = useCallback((fn: (content: string) => void) => {
    sendFnRef.current = fn;
  }, []);

  return (
    <MatchChatContext.Provider
      value={{ matchId, setMatchId, matchChatMessages, setMatchChatMessages, sendMatchChat, setSendMatchChat }}
    >
      {children}
    </MatchChatContext.Provider>
  );
}

export function useMatchChat() {
  const ctx = useContext(MatchChatContext);
  if (!ctx) throw new Error("useMatchChat must be used within MatchChatProvider");
  return ctx;
}
