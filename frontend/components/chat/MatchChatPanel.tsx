"use client";

import { ChevronDown, ChevronUp, MessageSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChatInput } from "./ChatInput";
import { type ChatMessage, MessageList } from "./MessageList";

const CHAT_NOTIFICATION_SOUND = "/assets/audio/gui/int_popup.ogg";

function playNotificationSound() {
  try {
    const audio = new Audio(CHAT_NOTIFICATION_SOUND);
    audio.volume = 0.3;
    audio.play().catch(() => {});
  } catch {}
}

interface MatchChatPanelProps {
  messages: ChatMessage[];
  currentUserId: string;
  onSend: (content: string) => void;
}

export default function MatchChatPanel({ messages, currentUserId, onSend }: MatchChatPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const prevCountRef = useRef(messages.length);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = messages.length > 0;
      prevCountRef.current = messages.length;
      return;
    }

    const newCount = messages.length - prevCountRef.current;
    prevCountRef.current = messages.length;

    if (newCount <= 0) return;

    const latestMsg = messages[messages.length - 1];
    if (latestMsg && latestMsg.user_id !== currentUserId) {
      playNotificationSound();
      if (!expanded && !mobileOpen) {
        setUnread((u) => u + newCount);
      }
    }
  }, [messages.length, currentUserId, expanded, mobileOpen, messages]);

  return (
    <>
      {/* ═══ MOBILE: FAB + Bottom Sheet ═══ */}

      {/* FAB button */}
      <button
        onClick={() => {
          setMobileOpen(true);
          setUnread(0);
        }}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-all active:scale-95 sm:hidden"
        title="Czat meczu"
      >
        <MessageSquare className="h-4 w-4 text-primary" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-0.5 text-[9px] font-bold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* Bottom sheet overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          {/* Scrim */}
          <div className="absolute inset-0 bg-background/60" onClick={() => setMobileOpen(false)} />

          {/* Sheet */}
          <div className="absolute inset-x-0 bottom-0 flex max-h-[60vh] flex-col overflow-hidden rounded-t-[20px] border-t border-border bg-card shadow-lg">
            {/* Drag handle */}
            <div className="flex justify-center py-2">
              <div className="h-1 w-8 rounded-full bg-muted-foreground/30" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">Czat meczu</span>
                <span className="text-xs text-muted-foreground">{messages.length}</span>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-hidden border-t border-border">
              <div className="flex h-full flex-col">
                <MessageList messages={messages} currentUserId={currentUserId} />
              </div>
            </div>

            {/* Input */}
            <ChatInput onSend={onSend} placeholder="Napisz do graczy..." />
          </div>
        </div>
      )}

      {/* ═══ DESKTOP: Collapsible panel ═══ */}
      <div className="hidden w-64 flex-col overflow-hidden rounded-2xl border border-border bg-card/85 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:flex">
        {/* Header */}
        <button
          onClick={() => {
            setExpanded(!expanded);
            if (!expanded) setUnread(0);
          }}
          className="flex items-center justify-between px-3 py-2 transition-colors hover:bg-muted/30"
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Czat meczu
            </span>
            {!expanded && unread > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-primary-foreground">
                {unread}
              </span>
            )}
          </div>
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-3 w-3 text-muted-foreground" />
          )}
        </button>

        {expanded && (
          <>
            <div className="h-36 border-t border-border">
              <div className="flex h-full flex-col">
                <MessageList messages={messages} currentUserId={currentUserId} />
              </div>
            </div>
            <ChatInput onSend={onSend} placeholder="Napisz do graczy..." />
          </>
        )}
      </div>
    </>
  );
}
