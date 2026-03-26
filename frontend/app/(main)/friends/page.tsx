"use client";

import { Check, ChevronRight, Eye, Loader2, Send, Trash2, UserPlus, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FriendsSkeleton } from "@/components/skeletons/FriendsSkeleton";
import { RefreshingOverlay } from "@/components/ui/refreshing-overlay";
import {
  useAcceptFriendRequest,
  useFriends,
  useReceivedRequests,
  useRejectFriendRequest,
  useRemoveFriend,
  useSendFriendRequest,
  useSentRequests,
} from "@/hooks/queries";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

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

function activityLabel(
  status: string,
  details?: { game_mode?: string; players_count?: number; started_at?: string },
): string {
  const mode = details?.game_mode;
  switch (status) {
    case "in_game": {
      const parts = ["W grze"];
      if (mode) parts.push(mode);
      if (details?.players_count) parts.push(`${details.players_count}P`);
      return parts.join(" · ");
    }
    case "in_queue":
      return mode ? `Szuka · ${mode}` : "W kolejce";
    case "online":
      return "Online";
    default:
      return "Offline";
  }
}

import { ClanTag } from "@/components/ClanTag";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function FriendsPage() {
  const { user, loading, token } = useAuth();
  const router = useRouter();

  const [sendUsername, setSendUsername] = useState("");

  const { data: friendsData, isLoading: friendsLoading, isFetching: friendsFetching } = useFriends();
  const { data: receivedData, isLoading: receivedLoading, isFetching: receivedFetching } = useReceivedRequests();
  const { data: sentData, isLoading: sentLoading, isFetching: sentFetching } = useSentRequests();
  const isRefreshing =
    (friendsFetching || receivedFetching || sentFetching) && !friendsLoading && !receivedLoading && !sentLoading;

  const sendMutation = useSendFriendRequest();
  const acceptMutation = useAcceptFriendRequest();
  const rejectMutation = useRejectFriendRequest();
  const removeMutation = useRemoveFriend();

  const friends = friendsData?.items ?? [];
  const received = receivedData?.items ?? [];
  const sent = sentData?.items ?? [];

  const pageLoading = friendsLoading || receivedLoading || sentLoading;
  const actionPending = acceptMutation.isPending || rejectMutation.isPending || removeMutation.isPending;

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  async function handleSendRequest() {
    if (!sendUsername.trim()) return;
    try {
      await sendMutation.mutateAsync(sendUsername.trim());
      toast.success(`Wysłano zaproszenie do ${sendUsername.trim()}.`, { id: "friends-request-sent" });
      setSendUsername("");
    } catch {
      toast.error("Nie udało się wysłać zaproszenia.", { id: "friends-request-send-error" });
    }
  }

  async function handleAccept(friendshipId: string) {
    try {
      await acceptMutation.mutateAsync(friendshipId);
      toast.success("Zaproszenie zaakceptowane.", { id: "friends-accept" });
    } catch {
      toast.error("Nie udało się zaakceptować zaproszenia.", { id: "friends-accept-error" });
    }
  }

  async function handleReject(friendshipId: string) {
    try {
      await rejectMutation.mutateAsync(friendshipId);
      toast.success("Zaproszenie odrzucone.", { id: "friends-reject" });
    } catch {
      toast.error("Nie udało się odrzucić zaproszenia.", { id: "friends-reject-error" });
    }
  }

  async function handleCancel(friendshipId: string) {
    try {
      await rejectMutation.mutateAsync(friendshipId);
      toast.success("Zaproszenie anulowane.", { id: "friends-cancel" });
    } catch {
      toast.error("Nie udało się anulować zaproszenia.", { id: "friends-cancel-error" });
    }
  }

  async function handleRemove(friendshipId: string) {
    try {
      await removeMutation.mutateAsync(friendshipId);
      toast.success("Usunięto ze znajomych.", { id: "friends-remove" });
    } catch {
      toast.error("Nie udało się usunąć znajomego.", { id: "friends-remove-error" });
    }
  }

  if (loading || pageLoading) {
    return <FriendsSkeleton />;
  }

  return (
    <RefreshingOverlay active={isRefreshing}>
      <div className="animate-page-in space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-4 px-4 md:px-0">
          <div>
            <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">
              SPOŁECZNOŚĆ
            </p>
            <h1 className="font-display text-2xl md:text-5xl text-foreground">Znajomi</h1>
            <p className="hidden md:block mt-1 text-sm text-muted-foreground">
              Zarządzaj listą znajomych i zaproszeniami.
            </p>
          </div>
          <Badge variant="outline" className="hidden md:inline-flex text-sm px-3 py-1.5 text-foreground">
            <Users size={14} className="mr-1.5" />
            {friends.length}
          </Badge>
        </div>

        {/* ── Dodaj znajomego ── */}
        <div className="px-4 md:px-0">
          {/* Mobile: flat */}
          <div className="md:hidden">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium mb-2.5">
              Dodaj znajomego
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Nazwa użytkownika..."
                value={sendUsername}
                onChange={(e) => setSendUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSendRequest();
                }}
                className="flex-1 rounded-xl"
                disabled={sendMutation.isPending}
              />
              <button
                onClick={handleSendRequest}
                disabled={sendMutation.isPending || !sendUsername.trim()}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20 disabled:opacity-40 disabled:pointer-events-none transition-colors active:scale-[0.97]"
              >
                {sendMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Wyślij
              </button>
            </div>
          </div>

          {/* Desktop: Card */}
          <Card className="hidden md:block rounded-2xl">
            <CardContent className="p-5">
              <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground font-medium mb-3">
                Dodaj znajomego
              </p>
              <div className="flex gap-3">
                <Input
                  placeholder="Nazwa użytkownika..."
                  value={sendUsername}
                  onChange={(e) => setSendUsername(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSendRequest();
                  }}
                  className="flex-1 h-12 text-base px-4"
                  disabled={sendMutation.isPending}
                />
                <Button
                  onClick={handleSendRequest}
                  disabled={sendMutation.isPending || !sendUsername.trim()}
                  size="lg"
                  className="shrink-0 gap-2 h-12 px-6 text-base"
                >
                  {sendMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  Wyślij
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Tabs ── */}
        <div className="px-4 md:px-0">
          <Tabs defaultValue="friends">
            {/* Mobile: horizontal scroll pills */}
            <div className="md:hidden overflow-x-auto pb-1 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
              <TabsList className="inline-flex w-auto gap-1 bg-transparent p-0 mb-3">
                <TabsTrigger
                  value="friends"
                  className="shrink-0 gap-1.5 rounded-full border border-border bg-secondary/60 px-4 py-2 text-sm data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                >
                  <Users size={14} />
                  Znajomi
                  {friends.length > 0 && (
                    <span className="ml-1 rounded-full bg-secondary px-1.5 py-0 text-[10px] font-semibold text-muted-foreground">
                      {friends.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="received"
                  className="shrink-0 gap-1.5 rounded-full border border-border bg-secondary/60 px-4 py-2 text-sm data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                >
                  <UserPlus size={14} />
                  Otrzymane
                  {received.length > 0 && (
                    <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0 text-[10px] font-semibold text-primary">
                      {received.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="sent"
                  className="shrink-0 gap-1.5 rounded-full border border-border bg-secondary/60 px-4 py-2 text-sm data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                >
                  <Send size={14} />
                  Wysłane
                  {sent.length > 0 && (
                    <span className="ml-1 rounded-full bg-secondary px-1.5 py-0 text-[10px] font-semibold text-muted-foreground">
                      {sent.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Desktop: standard TabsList */}
            <TabsList className="hidden md:inline-flex mb-4">
              <TabsTrigger value="friends" className="gap-1.5">
                <Users size={15} />
                Znajomi
                {friends.length > 0 && (
                  <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                    {friends.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="received" className="gap-1.5">
                <UserPlus size={15} />
                Otrzymane
                {received.length > 0 && (
                  <Badge className="ml-1 px-1.5 py-0 text-xs bg-primary text-primary-foreground">
                    {received.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="sent" className="gap-1.5">
                <Send size={15} />
                Wysłane
                {sent.length > 0 && (
                  <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                    {sent.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* ── Znajomi ── */}
            <TabsContent value="friends">
              {friends.length === 0 ? (
                <EmptyState
                  icon={<Users size={32} className="text-muted-foreground/40" />}
                  message="Nie masz jeszcze znajomych."
                />
              ) : (
                <>
                  {/* Mobile: clickable rows */}
                  <div className="animate-list-in md:hidden space-y-0.5">
                    {friends.map((f) => {
                      const friend = f.from_user.id === user?.id ? f.to_user : f.from_user;
                      const busy = removeMutation.isPending && removeMutation.variables === f.id;
                      return (
                        <div key={f.id} className="flex items-center gap-3 rounded-xl py-3 px-1 hover-lift">
                          <button
                            onClick={() => router.push(`/profile/${friend.id}`)}
                            className="flex flex-1 min-w-0 items-center gap-3 text-left active:opacity-70 transition-opacity"
                          >
                            <div className="relative shrink-0">
                              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-sm font-bold uppercase text-foreground">
                                {friend.username.charAt(0)}
                              </div>
                              <div
                                className={cn(
                                  "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                                  activityDot(friend.activity_status),
                                )}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-base font-semibold text-foreground truncate">
                                {friend.clan_tag && <ClanTag tag={friend.clan_tag} className="text-sm mr-1" />}
                                {friend.username}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                ELO: <span className="text-accent tabular-nums text-sm">{friend.elo_rating}</span>
                              </p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                          </button>
                          <button
                            disabled={actionPending}
                            onClick={() => handleRemove(f.id)}
                            className="shrink-0 flex items-center justify-center h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"
                            aria-label="Usuń znajomego"
                          >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop: Table in Card */}
                  <Card className="hidden md:block rounded-2xl overflow-hidden">
                    <Table className="text-base">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-14 pl-6 text-base font-semibold">Gracz</TableHead>
                          <TableHead className="h-14 text-base font-semibold text-center">ELO</TableHead>
                          <TableHead className="h-14 text-base font-semibold text-center">Status</TableHead>
                          <TableHead className="h-14 pr-6 text-base font-semibold text-right">Akcja</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="animate-list-in">
                        {friends.map((f) => {
                          const friend = f.from_user.id === user?.id ? f.to_user : f.from_user;
                          const busy = removeMutation.isPending && removeMutation.variables === f.id;
                          return (
                            <TableRow key={f.id} className="hover:bg-muted/50 hover-lift">
                              <TableCell className="pl-6 py-4">
                                <Link href={`/profile/${friend.id}`} className="flex items-center gap-3 group">
                                  <div className="relative shrink-0">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-base font-bold uppercase text-foreground">
                                      {friend.username.charAt(0)}
                                    </div>
                                    <div
                                      className={cn(
                                        "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                                        activityDot(friend.activity_status),
                                      )}
                                    />
                                  </div>
                                  <span className="text-base font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                                    {friend.clan_tag && <ClanTag tag={friend.clan_tag} className="text-sm mr-1" />}
                                    {friend.username}
                                  </span>
                                </Link>
                              </TableCell>
                              <TableCell className="py-4 text-center">
                                <span className="font-display text-xl tabular-nums text-accent">
                                  {friend.elo_rating}
                                </span>
                              </TableCell>
                              <TableCell className="py-4 text-center">
                                <span className="text-sm text-muted-foreground">
                                  {activityLabel(friend.activity_status, friend.activity_details)}
                                </span>
                                {friend.activity_status === "in_game" && friend.activity_details?.match_id && (
                                  <Link
                                    href={`/spectate/${friend.activity_details.match_id}`}
                                    className="ml-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                                    title="Oglądaj mecz"
                                  >
                                    <Eye className="h-3 w-3" />
                                    Oglądaj
                                  </Link>
                                )}
                              </TableCell>
                              <TableCell className="py-4 pr-6 text-right">
                                <Button
                                  variant="ghost"
                                  disabled={actionPending}
                                  onClick={() => handleRemove(f.id)}
                                  className="gap-2 text-base text-destructive hover:text-destructive hover:bg-destructive/10"
                                >
                                  {busy ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                                  Usuń
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Card>
                </>
              )}
            </TabsContent>

            {/* ── Otrzymane ── */}
            <TabsContent value="received">
              {received.length === 0 ? (
                <EmptyState
                  icon={<UserPlus size={32} className="text-muted-foreground/40" />}
                  message="Brak oczekujących zaproszeń."
                />
              ) : (
                <>
                  {/* Mobile: rows with inline action buttons */}
                  <div className="animate-list-in md:hidden space-y-0.5">
                    {received.map((f) => {
                      const busy =
                        (acceptMutation.isPending && acceptMutation.variables === f.id) ||
                        (rejectMutation.isPending && rejectMutation.variables === f.id);
                      return (
                        <div key={f.id} className="flex items-center gap-3 rounded-xl py-3 px-1 hover-lift">
                          <div className="relative shrink-0">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-xs font-bold uppercase text-foreground">
                              {f.from_user.username.charAt(0)}
                            </div>
                            <div
                              className={cn(
                                "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                                activityDot(f.from_user.activity_status),
                              )}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-semibold text-foreground truncate">
                              {f.from_user.clan_tag && <ClanTag tag={f.from_user.clan_tag} className="text-sm mr-1" />}
                              {f.from_user.username}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              ELO: <span className="text-accent tabular-nums text-sm">{f.from_user.elo_rating}</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              disabled={actionPending}
                              onClick={() => handleAccept(f.id)}
                              className="flex items-center justify-center h-8 w-8 rounded-lg text-green-400 hover:bg-green-400/10 disabled:opacity-40 transition-colors"
                              aria-label="Akceptuj"
                            >
                              {busy && acceptMutation.variables === f.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Check size={14} />
                              )}
                            </button>
                            <button
                              disabled={actionPending}
                              onClick={() => handleReject(f.id)}
                              className="flex items-center justify-center h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"
                              aria-label="Odrzuć"
                            >
                              {busy && rejectMutation.variables === f.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <X size={14} />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop: Card with divide-y rows */}
                  <Card className="hidden md:block rounded-2xl overflow-hidden">
                    <div className="animate-list-in divide-y divide-border">
                      {received.map((f) => {
                        const busy =
                          (acceptMutation.isPending && acceptMutation.variables === f.id) ||
                          (rejectMutation.isPending && rejectMutation.variables === f.id);
                        return (
                          <div key={f.id} className="flex items-center gap-4 px-6 py-4 hover-lift">
                            <div className="relative shrink-0">
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-base font-bold uppercase text-foreground">
                                {f.from_user.username.charAt(0)}
                              </div>
                              <div
                                className={cn(
                                  "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                                  activityDot(f.from_user.activity_status),
                                )}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-base font-semibold text-foreground truncate">
                                {f.from_user.clan_tag && (
                                  <ClanTag tag={f.from_user.clan_tag} className="text-sm mr-1" />
                                )}
                                {f.from_user.username}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                ELO: <span className="text-accent tabular-nums">{f.from_user.elo_rating}</span>
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Button
                                variant="ghost"
                                disabled={actionPending}
                                onClick={() => handleAccept(f.id)}
                                className="gap-2 text-base text-green-400 hover:text-green-400 hover:bg-green-400/10"
                              >
                                {busy && acceptMutation.variables === f.id ? (
                                  <Loader2 size={18} className="animate-spin" />
                                ) : (
                                  <Check size={18} />
                                )}
                                Akceptuj
                              </Button>
                              <Button
                                variant="ghost"
                                disabled={actionPending}
                                onClick={() => handleReject(f.id)}
                                className="gap-2 text-base text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                {busy && rejectMutation.variables === f.id ? (
                                  <Loader2 size={18} className="animate-spin" />
                                ) : (
                                  <X size={18} />
                                )}
                                Odrzuć
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                </>
              )}
            </TabsContent>

            {/* ── Wysłane ── */}
            <TabsContent value="sent">
              {sent.length === 0 ? (
                <EmptyState
                  icon={<Send size={32} className="text-muted-foreground/40" />}
                  message="Brak wysłanych zaproszeń."
                />
              ) : (
                <>
                  {/* Mobile: rows with cancel button */}
                  <div className="animate-list-in md:hidden space-y-0.5">
                    {sent.map((f) => {
                      const busy = rejectMutation.isPending && rejectMutation.variables === f.id;
                      return (
                        <div key={f.id} className="flex items-center gap-3 rounded-xl py-3 px-1 hover-lift">
                          <div className="relative shrink-0">
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-sm font-bold uppercase text-foreground">
                              {f.to_user.username.charAt(0)}
                            </div>
                            <div
                              className={cn(
                                "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                                activityDot(f.to_user.activity_status),
                              )}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-semibold text-foreground truncate">
                              {f.to_user.clan_tag && <ClanTag tag={f.to_user.clan_tag} className="text-sm mr-1" />}
                              {f.to_user.username}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              ELO: <span className="text-accent tabular-nums text-sm">{f.to_user.elo_rating}</span>
                            </p>
                          </div>
                          <button
                            disabled={actionPending}
                            onClick={() => handleCancel(f.id)}
                            className="shrink-0 flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"
                            aria-label="Anuluj zaproszenie"
                          >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop: Card with divide-y rows */}
                  <Card className="hidden md:block rounded-2xl overflow-hidden">
                    <div className="animate-list-in divide-y divide-border">
                      {sent.map((f) => {
                        const busy = rejectMutation.isPending && rejectMutation.variables === f.id;
                        return (
                          <div key={f.id} className="flex items-center gap-4 px-6 py-4 hover-lift">
                            <div className="relative shrink-0">
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-base font-bold uppercase text-foreground">
                                {f.to_user.username.charAt(0)}
                              </div>
                              <div
                                className={cn(
                                  "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                                  activityDot(f.to_user.activity_status),
                                )}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-base font-semibold text-foreground truncate">
                                {f.to_user.clan_tag && <ClanTag tag={f.to_user.clan_tag} className="text-sm mr-1" />}
                                {f.to_user.username}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                ELO: <span className="text-accent tabular-nums">{f.to_user.elo_rating}</span>
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              disabled={actionPending}
                              onClick={() => handleCancel(f.id)}
                              className="shrink-0 gap-2 text-base text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            >
                              {busy ? <Loader2 size={18} className="animate-spin" /> : <X size={18} />}
                              Anuluj
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </RefreshingOverlay>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-14 text-center">
      {icon}
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
