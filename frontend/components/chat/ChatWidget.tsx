"use client";

import { Loader2, MessageSquare, Minus, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSocialSocketContext } from "@/hooks/SocialSocketContext";
import { useAuth } from "@/hooks/useAuth";
import { useChat } from "@/hooks/useChat";
import { useSystemModules } from "@/hooks/useSystemModules";
import { type DirectMessageOut, getMessages, sendMessage } from "@/lib/api";
import { ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";

// ---------------------------------------------------------------------------
// DMChatView — rendered when a DM tab is active
// ---------------------------------------------------------------------------

interface DMChatViewProps {
  friendId: string;
  friendUsername: string;
  currentUserId: string;
  token: string;
}

function formatDMTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function DMChatView({ friendId, friendUsername, currentUserId, token }: DMChatViewProps) {
  const [messages, setMessages] = useState<DirectMessageOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { onDirectMessage } = useSocialSocketContext();

  const loadMessages = useCallback(async () => {
    try {
      const res = await getMessages(token, friendId, 30);
      setMessages([...res.items].reverse());
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, [token, friendId]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    loadMessages();
  }, [loadMessages]);

  // Real-time incoming DMs
  useEffect(() => {
    return onDirectMessage((msg) => {
      if (msg.sender.id !== friendId) return;
      const newMsg: DirectMessageOut = {
        id: msg.id,
        sender: {
          id: msg.sender.id,
          username: msg.sender.username,
          elo_rating: 0,
          is_online: true,
          activity_status: "online",
          activity_details: {},
          clan_tag: null,
        },
        receiver: {
          id: currentUserId,
          username: "",
          elo_rating: 0,
          is_online: true,
          activity_status: "online",
          activity_details: {},
          clan_tag: null,
        },
        content: msg.content,
        is_read: false,
        created_at: msg.created_at,
      };
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
    });
  }, [onDirectMessage, friendId, currentUserId]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleSend = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || sending) return;
      setSending(true);
      try {
        const sent = await sendMessage(token, friendId, trimmed);
        setMessages((prev) => {
          if (prev.some((m) => m.id === sent.id)) return prev;
          return [...prev, sent];
        });
      } catch {
        toast.error("Nie udało się wysłać wiadomości", { id: "chat-send-error" });
      } finally {
        setSending(false);
      }
    },
    [token, friendId, sending],
  );

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 scrollbar-thin scrollbar-thumb-border min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-1 text-muted-foreground">
            <MessageSquare className="h-6 w-6 opacity-20" />
            <span className="text-xs">Brak wiadomości</span>
            <span className="text-[10px] text-muted-foreground/50">Napisz do {friendUsername}!</span>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.sender.id === currentUserId;
            return (
              <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] flex flex-col gap-0.5 ${isMine ? "items-end" : "items-start"}`}>
                  <div
                    className={`rounded-xl px-3 py-1.5 text-xs md:text-sm leading-snug ${
                      isMine
                        ? "bg-primary/15 text-foreground rounded-br-sm"
                        : "bg-secondary text-foreground rounded-bl-sm"
                    }`}
                  >
                    {msg.content}
                  </div>
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums px-0.5">
                    {formatDMTime(msg.created_at)}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={sending} placeholder={`Napisz do ${friendUsername}...`} />
    </>
  );
}

// ---------------------------------------------------------------------------
// ChatWidget — main floating widget with global + DM tabs
// ---------------------------------------------------------------------------

export default function ChatWidget() {
  const { user, token } = useAuth();
  const {
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
    closeDMTab,
    setActiveTab,
    openDMTab,
  } = useChat();
  const { isEnabled } = useSystemModules();
  const pathname = usePathname();

  const isGamePage = pathname.startsWith("/game/");

  if (!user || isGamePage || !isEnabled("chat")) return null;

  const handleToggle = () => {
    const willOpen = !chatOpen;
    setChatOpen(willOpen);
    if (willOpen) resetUnread();
  };

  const handleTabClick = (tab: "global" | string) => {
    if (tab === "global") {
      setActiveTab("global");
      resetUnread();
    } else {
      // Use openDMTab to clear unread for this tab
      const dmTab = dmTabs.find((t) => t.friendId === tab);
      if (dmTab) openDMTab(dmTab.friendId, dmTab.friendUsername);
    }
  };

  const handleCloseDMTab = (e: React.MouseEvent, friendId: string) => {
    e.stopPropagation();
    closeDMTab(friendId);
  };

  return (
    <div className="fixed bottom-16 right-3 z-50 flex flex-col items-end gap-2 md:bottom-6 md:right-6">
      {chatOpen && (
        <div className="flex h-[380px] w-[calc(100vw-1.5rem)] max-w-sm md:h-[500px] md:w-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl shadow-black/20 backdrop-blur-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 shrink-0">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="text-xs md:text-sm font-semibold uppercase tracking-[0.15em] text-foreground">Czat</span>
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

          {/* Tab bar — only shown when there are DM tabs */}
          {dmTabs.length > 0 && (
            <div className="flex overflow-x-auto gap-0 border-b border-border shrink-0 scrollbar-none">
              {/* Global tab */}
              <button
                onClick={() => handleTabClick("global")}
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer whitespace-nowrap transition-colors border-b-2 ${
                  activeTab === "global"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Globalny
              </button>

              {/* DM tabs */}
              {dmTabs.map((tab) => {
                const unread = dmUnread[tab.friendId] || 0;
                return (
                  <button
                    key={tab.friendId}
                    onClick={() => handleTabClick(tab.friendId)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer whitespace-nowrap transition-colors border-b-2 ${
                      activeTab === tab.friendId
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>{tab.friendUsername}</span>
                    {unread > 0 && (
                      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                    <span
                      role="button"
                      aria-label={`Zamknij czat z ${tab.friendUsername}`}
                      onClick={(e) => handleCloseDMTab(e, tab.friendId)}
                      className="flex items-center justify-center rounded hover:bg-muted/60 p-0.5 -mr-0.5"
                    >
                      <X className="h-3 w-3" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Content area */}
          {activeTab === "global" ? (
            <>
              <MessageList messages={messages} currentUserId={user.id} />
              <ChatInput onSend={sendMessage} disabled={!connected} />
            </>
          ) : (
            token &&
            (() => {
              const tab = dmTabs.find((t) => t.friendId === activeTab);
              if (!tab) return null;
              return (
                <DMChatView
                  key={tab.friendId}
                  friendId={tab.friendId}
                  friendUsername={tab.friendUsername}
                  currentUserId={user.id}
                  token={token}
                />
              );
            })()
          )}
        </div>
      )}

      {/* Toggle button */}
      {(() => {
        const totalDmUnread = Object.values(dmUnread).reduce((s, n) => s + n, 0);
        const totalUnread = unreadCount + totalDmUnread;
        return (
          <button
            onClick={handleToggle}
            className={`relative flex h-12 w-12 md:h-11 md:w-11 items-center justify-center rounded-full border shadow-lg backdrop-blur-xl transition-all active:scale-[0.93] ${
              chatOpen
                ? "border-primary/30 bg-primary/15 text-primary"
                : totalDmUnread > 0
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card/90 text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {chatOpen ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
            {!chatOpen && totalUnread > 0 && (
              <span
                className={`absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-0.5 text-[10px] font-bold text-white ${totalDmUnread > 0 ? "bg-primary animate-pulse" : "bg-destructive"}`}
              >
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            )}
          </button>
        );
      })()}
    </div>
  );
}
