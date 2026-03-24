"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, MessageSquare, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ClanTag } from "@/components/ClanTag";
import { MessagesSkeleton } from "@/components/skeletons/MessagesSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useConversations, useMessages, useSendMessage } from "@/hooks/queries";
import { useSocialSocketContext } from "@/hooks/SocialSocketContext";
import { useAuth } from "@/hooks/useAuth";
import type { ConversationOut, DirectMessageOut } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Activity helpers
// ---------------------------------------------------------------------------

function activityDot(status: string): string {
  switch (status) {
    case "in_game":
      return "bg-accent";
    case "in_queue":
      return "bg-yellow-500";
    case "online":
      return "bg-green-500";
    default:
      return "bg-muted-foreground/30";
  }
}

function activityLabel(status: string): string {
  switch (status) {
    case "in_game":
      return "W grze";
    case "in_queue":
      return "W kolejce";
    case "online":
      return "Online";
    default:
      return "Offline";
  }
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "teraz";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}g`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Conversation list item
// ---------------------------------------------------------------------------

function ConversationItem({ conv, active, onClick }: { conv: ConversationOut; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "hover-lift w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-left transition-all",
        active ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/60 border border-transparent",
      )}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-base font-bold uppercase text-foreground">
          {conv.partner.username.charAt(0)}
        </div>
        <div
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
            activityDot(conv.partner.activity_status),
          )}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className={cn("text-base font-semibold truncate", active ? "text-primary" : "text-foreground")}>
            {conv.partner.clan_tag && <ClanTag tag={conv.partner.clan_tag} className="text-sm mr-1" />}
            {conv.partner.username}
          </span>
          <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
            {timeAgo(conv.last_message.created_at)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <p className="text-sm text-muted-foreground truncate">
            {conv.last_message.is_mine && <span className="text-muted-foreground/60">Ty: </span>}
            {conv.last_message.content}
          </p>
          {conv.unread_count > 0 && (
            <span className="shrink-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground px-1 leading-none">
              {conv.unread_count > 9 ? "9+" : conv.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({ message, isMine }: { message: DirectMessageOut; isMine: boolean }) {
  return (
    <div className={cn("flex", isMine ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[75%] flex flex-col gap-0.5", isMine ? "items-end" : "items-start")}>
        {!isMine && (
          <span className="text-xs font-medium text-muted-foreground px-1">
            {message.sender.clan_tag && <ClanTag tag={message.sender.clan_tag} className="text-[10px] mr-0.5" />}
            {message.sender.username}
          </span>
        )}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-base leading-relaxed",
            isMine ? "bg-primary/15 text-foreground rounded-br-md" : "bg-secondary text-foreground rounded-bl-md",
          )}
        >
          {message.content}
        </div>
        <span className="text-[10px] text-muted-foreground/60 px-1 tabular-nums">{formatTime(message.created_at)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat view (right panel)
// ---------------------------------------------------------------------------

function ChatView({
  partnerId,
  partnerName,
  partnerStatus,
  currentUserId,
  onBack,
}: {
  partnerId: string;
  partnerName: string;
  partnerStatus: string;
  currentUserId: string;
  onBack: () => void;
}) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { onDirectMessage } = useSocialSocketContext();

  const { data: messagesData, isLoading: loading } = useMessages(partnerId, 50);
  const sendMessageMutation = useSendMessage();

  const sending = sendMessageMutation.isPending;

  // Messages in chronological order (API returns newest-first)
  const messages = messagesData ? [...messagesData.items].reverse() : [];

  // Invalidate message thread when a new DM arrives via WebSocket
  useEffect(() => {
    return onDirectMessage((msg) => {
      if (msg.sender.id !== partnerId) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.messages.thread(partnerId),
      });
    });
  }, [onDirectMessage, partnerId, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    setInput("");
    try {
      await sendMessageMutation.mutateAsync({ userId: partnerId, content: trimmed });
    } catch {
      toast.error("Nie udało się wysłać wiadomości", { id: "messages-send-error" });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border shrink-0">
        <button
          onClick={onBack}
          className="md:hidden flex items-center justify-center h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="relative shrink-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-base font-bold uppercase text-foreground">
            {partnerName.charAt(0)}
          </div>
          <div
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
              activityDot(partnerStatus),
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-foreground">{partnerName}</p>
          <p className="text-sm text-muted-foreground">{activityLabel(partnerStatus)}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <MessageSquare size={36} className="text-muted-foreground/30" />
            <p className="text-base text-muted-foreground">Brak wiadomości. Napisz coś!</p>
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} isMine={msg.sender.id === currentUserId} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-t border-border shrink-0">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Napisz wiadomość..."
          className="flex-1 h-12 rounded-xl text-base px-4"
          disabled={sending}
          maxLength={2000}
        />
        <Button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          size="lg"
          className="h-12 w-12 rounded-xl p-0 shrink-0"
        >
          {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty chat placeholder
// ---------------------------------------------------------------------------

function EmptyChatPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
        <MessageSquare size={28} className="text-primary" />
      </div>
      <div>
        <h3 className="font-display text-xl text-foreground">Wybierz rozmowę</h3>
        <p className="text-base text-muted-foreground mt-1">Kliknij na znajomego, aby rozpocząć czat.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function MessagesPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { onDirectMessage } = useSocialSocketContext();

  const [activePartnerId, setActivePartnerId] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);

  const { data: conversations = [], isLoading: loading } = useConversations();

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  // Invalidate conversations when a new DM arrives via WebSocket
  useEffect(() => {
    return onDirectMessage(() => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.messages.conversations(),
      });
    });
  }, [onDirectMessage, queryClient]);

  const activeConv = conversations.find((c) => c.partner.id === activePartnerId);
  const totalUnread = conversations.reduce((s, c) => s + c.unread_count, 0);

  function openConversation(partnerId: string) {
    setActivePartnerId(partnerId);
    setShowChat(true);
  }

  function handleBack() {
    setShowChat(false);
  }

  if (authLoading) return <MessagesSkeleton />;

  if (!user) return null;

  return (
    <div className="animate-page-in space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 px-4 md:px-0">
        <div>
          <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">
            SPOŁECZNOŚĆ
          </p>
          <h1 className="font-display text-2xl md:text-5xl text-foreground">Wiadomości</h1>
          <p className="hidden md:block mt-1 text-sm text-muted-foreground">Czatuj ze znajomymi.</p>
        </div>
        <Badge variant="outline" className="hidden md:inline-flex text-sm px-3 py-1.5 text-foreground">
          <MessageSquare size={14} className="mr-1.5" />
          {conversations.length}
          {totalUnread > 0 && (
            <span className="ml-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
              {totalUnread}
            </span>
          )}
        </Badge>
      </div>

      {/* ── Body ── */}
      <div className="px-4 md:px-0">
        {/* ── Mobile ── */}
        <div className="md:hidden">
          {!showChat ? (
            <div className="animate-list-in space-y-1">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-14 text-center">
                  <MessageSquare size={32} className="text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Brak rozmów. Napisz do znajomego!</p>
                </div>
              ) : (
                conversations.map((conv) => (
                  <ConversationItem
                    key={conv.partner.id}
                    conv={conv}
                    active={conv.partner.id === activePartnerId}
                    onClick={() => openConversation(conv.partner.id)}
                  />
                ))
              )}
            </div>
          ) : (
            <div className="h-[calc(100vh-12rem)] flex flex-col rounded-2xl border border-border bg-card overflow-hidden">
              {activeConv ? (
                <ChatView
                  partnerId={activeConv.partner.id}
                  partnerName={activeConv.partner.username}
                  partnerStatus={activeConv.partner.activity_status}
                  currentUserId={user.id}
                  onBack={handleBack}
                />
              ) : (
                <EmptyChatPlaceholder />
              )}
            </div>
          )}
        </div>

        {/* ── Desktop: two-panel layout ── */}
        <div className="hidden md:flex gap-6 h-[calc(100vh-16rem)]">
          {/* Left: conversation list */}
          <Card className="w-80 lg:w-96 shrink-0 flex flex-col overflow-hidden rounded-2xl">
            <div className="px-5 py-3.5 border-b border-border shrink-0">
              <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground font-medium">Rozmowy</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2.5">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-14 text-center px-4">
                  <MessageSquare size={32} className="text-muted-foreground/30" />
                  <p className="text-base text-muted-foreground">Brak rozmów</p>
                  <p className="text-sm text-muted-foreground/60">Użyj ikony czatu przy znajomym, aby rozpocząć.</p>
                </div>
              ) : (
                <div className="animate-list-in space-y-0.5">
                  {conversations.map((conv) => (
                    <ConversationItem
                      key={conv.partner.id}
                      conv={conv}
                      active={conv.partner.id === activePartnerId}
                      onClick={() => openConversation(conv.partner.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Right: chat */}
          <Card className="flex-1 flex flex-col overflow-hidden rounded-2xl">
            {activeConv ? (
              <ChatView
                partnerId={activeConv.partner.id}
                partnerName={activeConv.partner.username}
                partnerStatus={activeConv.partner.activity_status}
                currentUserId={user.id}
                onBack={handleBack}
              />
            ) : (
              <EmptyChatPlaceholder />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
