"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useSocialSocketContext } from "@/hooks/SocialSocketContext";
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from "@/hooks/queries";
import { type NotificationOut } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Bell,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Shield,
  Swords,
  Trophy,
  UserPlus,
  X,
} from "lucide-react";
import { NotificationsSkeleton } from "@/components/skeletons/NotificationsSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function notifIcon(type: string) {
  switch (type) {
    case "friend_request_received": return <UserPlus size={18} className="text-primary" />;
    case "friend_request_accepted": return <Check size={18} className="text-green-400" />;
    case "match_won": return <Trophy size={18} className="text-accent" />;
    case "match_lost": return <X size={18} className="text-destructive" />;
    case "player_eliminated": return <Shield size={18} className="text-destructive" />;
    case "game_invite": return <Swords size={18} className="text-primary" />;
    default: return <Bell size={18} className="text-muted-foreground" />;
  }
}

function notifLabel(type: string): string {
  switch (type) {
    case "friend_request_received": return "Zaproszenie";
    case "friend_request_accepted": return "Znajomy";
    case "match_won": return "Wygrana";
    case "match_lost": return "Przegrana";
    case "player_eliminated": return "Eliminacja";
    case "game_invite": return "Zaproszenie do gry";
    default: return "Powiadomienie";
  }
}

function notifHref(n: NotificationOut): string | null {
  switch (n.type) {
    case "friend_request_received":
    case "friend_request_accepted":
      return "/friends";
    case "game_invite":
      return n.data.lobby_id ? `/lobby/${n.data.lobby_id}` : null;
    case "match_won":
    case "match_lost":
    case "player_eliminated":
      return n.data.match_id ? `/match/${n.data.match_id}` : null;
    default:
      return null;
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "teraz";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}g`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("pl-PL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

export default function NotificationsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { onNotification } = useSocialSocketContext();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);

  const offset = (page - 1) * PAGE_SIZE;
  const { data: notificationsData, isLoading: loading } = useNotifications(PAGE_SIZE, offset);
  const markReadMutation = useMarkNotificationRead();
  const markAllReadMutation = useMarkAllNotificationsRead();

  const notifications = notificationsData?.items ?? [];
  const total = notificationsData?.count ?? 0;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  // Real-time: invalidate query when a new notification arrives
  useEffect(() => {
    return onNotification(() => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });
  }, [onNotification, queryClient]);

  async function handleMarkRead(id: string) {
    await markReadMutation.mutateAsync(id);
    toast.success("Oznaczono jako przeczytane");
  }

  async function handleMarkAllRead() {
    await markAllReadMutation.mutateAsync();
    toast.success("Wszystkie oznaczone jako przeczytane");
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const unreadOnPage = notifications.filter((n) => !n.is_read).length;

  if (authLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="animate-page-in space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 px-4 md:px-0">
        <div>
          <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">AKTYWNOŚĆ</p>
          <h1 className="font-display text-2xl md:text-5xl text-foreground">Powiadomienia</h1>
          <p className="hidden md:block mt-1 text-sm text-muted-foreground">
            Historia aktywności i powiadomień.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {unreadOnPage > 0 && (
            <Button
              variant="ghost"
              onClick={handleMarkAllRead}
              className="hidden md:inline-flex gap-2 text-sm text-primary hover:text-primary"
            >
              <CheckCheck size={16} />
              Oznacz wszystkie
            </Button>
          )}
          <Badge variant="outline" className="hidden md:inline-flex text-sm px-3 py-1.5 text-foreground">
            <Bell size={14} className="mr-1.5" />
            {total}
          </Badge>
        </div>
      </div>

      {/* ── Mobile: mark all ── */}
      {unreadOnPage > 0 && (
        <div className="px-4 md:hidden">
          <button
            onClick={handleMarkAllRead}
            className="flex items-center gap-1.5 text-xs text-primary"
          >
            <CheckCheck size={14} />
            Oznacz wszystkie jako przeczytane
          </button>
        </div>
      )}

      {/* ── List ── */}
      <div className="px-4 md:px-0">
        {loading ? (
          <NotificationsSkeleton />
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-14 text-center">
            <Bell size={36} className="text-muted-foreground/30" />
            <p className="text-base text-muted-foreground">Brak powiadomień</p>
          </div>
        ) : (
          <>
            {/* Mobile: flat list */}
            <div className="animate-list-in md:hidden space-y-0.5">
              {notifications.map((n) => {
                const href = notifHref(n);
                return (
                  <button
                    key={n.id}
                    onClick={() => {
                      if (!n.is_read) handleMarkRead(n.id);
                      if (href) router.push(href);
                    }}
                    className={cn(
                      "hover-lift w-full flex items-center gap-3 rounded-xl py-3 px-2 text-left transition-all active:bg-muted/50",
                      !n.is_read && "bg-primary/5"
                    )}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
                      {notifIcon(n.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold text-foreground truncate">{n.title}</p>
                      {n.body && <p className="text-sm text-muted-foreground truncate">{n.body}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[10px] text-muted-foreground tabular-nums">{timeAgo(n.created_at)}</span>
                      {!n.is_read && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Desktop: table */}
            <Card className="hidden md:block rounded-2xl overflow-hidden">
              <Table className="text-base">
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-14 pl-6 text-base font-semibold w-12"></TableHead>
                    <TableHead className="h-14 text-base font-semibold">Typ</TableHead>
                    <TableHead className="h-14 text-base font-semibold">Treść</TableHead>
                    <TableHead className="h-14 text-base font-semibold text-right pr-6">Czas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="animate-list-in">
                  {notifications.map((n) => {
                    const href = notifHref(n);
                    return (
                      <TableRow
                        key={n.id}
                        onClick={() => {
                          if (!n.is_read) handleMarkRead(n.id);
                          if (href) router.push(href);
                        }}
                        className={cn(
                          "hover-lift cursor-pointer",
                          !n.is_read ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/50"
                        )}
                      >
                        <TableCell className="pl-6 py-4">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
                            {notifIcon(n.type)}
                          </div>
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-medium text-muted-foreground">{notifLabel(n.type)}</span>
                            {!n.is_read && (
                              <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-4">
                          <p className="text-base font-semibold text-foreground">{n.title}</p>
                          {n.body && <p className="text-sm text-muted-foreground mt-0.5">{n.body}</p>}
                        </TableCell>
                        <TableCell className="py-4 pr-6 text-right">
                          <span className="text-sm text-muted-foreground tabular-nums">{formatDate(n.created_at)}</span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </>
        )}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 md:px-0">
          <span className="text-xs md:text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{page}</span> / {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="flex h-9 w-9 md:h-10 md:w-auto items-center justify-center md:gap-2 md:px-4 rounded-full md:rounded-xl border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 transition-colors active:scale-[0.95]"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden md:inline text-sm">Poprzednia</span>
            </button>
            <button
              className="flex h-9 w-9 md:h-10 md:w-auto items-center justify-center md:gap-2 md:px-4 rounded-full md:rounded-xl border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 transition-colors active:scale-[0.95]"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <span className="hidden md:inline text-sm">Następna</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
