"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useChat } from "@/hooks/useChat";
import { useSystemModules } from "@/hooks/useSystemModules";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { MessageSquare, X, Minus } from "lucide-react";

export default function ChatWidget() {
  const { user } = useAuth();
  const { messages, connected, sendMessage, unreadCount, resetUnread, chatOpen, setChatOpen } = useChat();
  const { isEnabled } = useSystemModules();
  const pathname = usePathname();

  // Hide in game pages — game has its own match chat panel
  const isGamePage = pathname.startsWith("/game/");

  if (!user || isGamePage || !isEnabled("chat")) return null;

  const handleToggle = () => {
    const willOpen = !chatOpen;
    setChatOpen(willOpen);
    if (willOpen) resetUnread();
  };

  return (
    <div className="fixed bottom-16 right-3 z-50 flex flex-col items-end gap-2 md:bottom-6 md:right-6">
      {chatOpen && (
        <div className="flex h-[350px] w-[calc(100vw-1.5rem)] max-w-sm md:h-[480px] md:w-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl shadow-black/20 backdrop-blur-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="text-xs md:text-sm font-semibold uppercase tracking-[0.15em] text-foreground">
                Czat
              </span>
              {connected ? (
                <span className="h-1.5 w-1.5 rounded-full bg-green-400" title="Połączono" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" title="Rozłączono" />
              )}
            </div>
            <button
              onClick={() => setChatOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Minus className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <MessageList messages={messages} currentUserId={user.id} />

          {/* Input */}
          <ChatInput onSend={sendMessage} disabled={!connected} />
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={handleToggle}
        className={`relative flex h-12 w-12 md:h-11 md:w-11 items-center justify-center rounded-full border shadow-lg backdrop-blur-xl transition-all active:scale-[0.93] ${
          chatOpen
            ? "border-primary/30 bg-primary/15 text-primary"
            : "border-border bg-card/90 text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
      >
        {chatOpen ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
        {!chatOpen && unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white animate-pulse">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
