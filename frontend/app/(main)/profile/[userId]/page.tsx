"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ClanTag } from "@/components/ClanTag";
import {
  ArrowLeft,
  ChevronRight,
  Crown,
  Layers,
  Loader2,
  Package,
  Settings,
  Swords,
  Trophy,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import { ProfileSkeleton } from "@/components/skeletons/ProfileSkeleton";
import { useAuth } from "@/hooks/useAuth";
import {
  APIError,
  type LeaderboardEntry,
  type Match,
  type WalletOut,
  type InventoryItemOut,
  type DeckOut,
  type User as UserType,
} from "@/lib/api";
import {
  useMe,
  useMyMatches,
  useMyWallet,
  useMyInventory,
  useMyDecks,
  useLeaderboard,
  usePlayerMatches,
  useFriends,
  useSentRequests,
  useReceivedRequests,
  useSendFriendRequest,
} from "@/hooks/queries";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { BannedBadge } from "@/components/ui/banned-badge";
import dynamic from "next/dynamic";

const ProfileCharts = dynamic(() => import("@/components/profile/ProfileCharts"), { ssr: false });

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const userId = params.userId as string;

  const isOwnProfile = user?.id === userId;

  const [friendSent, setFriendSent] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Own profile queries
  const { data: profileData } = useMe();
  const { data: myMatchesData, isLoading: myMatchesLoading } = useMyMatches(isOwnProfile ? 50 : undefined);
  const { data: walletData } = useMyWallet();
  const { data: inventoryData } = useMyInventory(isOwnProfile ? 8 : undefined);
  const { data: myDecksData } = useMyDecks();

  // Other profile queries
  const { data: playerMatchesData, isLoading: playerMatchesLoading } = usePlayerMatches(
    isOwnProfile ? "" : userId,
    50
  );

  // Shared queries
  const { data: leaderboardData, isLoading: lbLoading } = useLeaderboard(1000);

  // Friend status queries (only meaningful for other profiles, but hooks must be unconditional)
  const { data: friendsData } = useFriends(isOwnProfile ? undefined : 200);
  const { data: sentData } = useSentRequests(isOwnProfile ? undefined : 200);
  const { data: receivedData } = useReceivedRequests(isOwnProfile ? undefined : 200);

  const sendFriendMutation = useSendFriendRequest();

  // Derived values
  const profile = useMemo<UserType | null>(
    () => (isOwnProfile ? (profileData ?? null) : null),
    [isOwnProfile, profileData]
  );

  const matches = useMemo<Match[]>(
    () => (isOwnProfile ? (myMatchesData?.items ?? []) : (playerMatchesData?.items ?? [])),
    [isOwnProfile, myMatchesData, playerMatchesData]
  );

  const wallet = useMemo<WalletOut | null>(
    () => (isOwnProfile ? (walletData ?? null) : null),
    [isOwnProfile, walletData]
  );

  const inventory = useMemo<InventoryItemOut[]>(
    () => (isOwnProfile ? (inventoryData?.items ?? []) : []),
    [isOwnProfile, inventoryData]
  );

  const decks = useMemo<DeckOut[]>(
    () => (isOwnProfile ? (myDecksData?.items ?? []) : []),
    [isOwnProfile, myDecksData]
  );

  const { entry, placement } = useMemo<{ entry: LeaderboardEntry | null; placement: number | null }>(() => {
    if (!leaderboardData) return { entry: null, placement: null };
    const idx = leaderboardData.items.findIndex((e) => e.id === userId);
    if (idx < 0) return { entry: null, placement: null };
    return { entry: leaderboardData.items[idx], placement: idx + 1 };
  }, [leaderboardData, userId]);

  const friendshipStatus = useMemo<"none" | "pending" | "accepted">(() => {
    if (isOwnProfile) return "none";
    const isFriend = friendsData?.items.some(
      (f) => f.from_user.id === userId || f.to_user.id === userId
    ) ?? false;
    if (isFriend) return "accepted";
    const hasSent = sentData?.items.some((f) => f.to_user.id === userId) ?? false;
    const hasReceived = receivedData?.items.some((f) => f.from_user.id === userId) ?? false;
    if (hasSent || hasReceived) return "pending";
    return "none";
  }, [isOwnProfile, userId, friendsData, sentData, receivedData]);

  const dataLoading = useMemo(() => {
    if (authLoading) return true;
    if (lbLoading) return true;
    if (isOwnProfile) return myMatchesLoading;
    return playerMatchesLoading;
  }, [authLoading, lbLoading, isOwnProfile, myMatchesLoading, playerMatchesLoading]);

  const notFound = useMemo(() => {
    if (isOwnProfile) return false;
    if (lbLoading) return false;
    return entry === null;
  }, [isOwnProfile, lbLoading, entry]);

  useGSAP(() => {
    if (!containerRef.current || dataLoading) return;

    containerRef.current.querySelectorAll("[data-counter]").forEach((el) => {
      const target = parseInt(el.getAttribute("data-counter") || "0", 10);
      const suffix = el.getAttribute("data-suffix") || "";
      const obj = { val: 0 };
      gsap.to(obj, {
        val: target, duration: 1, ease: "power2.out",
        onUpdate: () => { el.textContent = Math.round(obj.val).toString() + suffix; },
      });
    });
  }, { scope: containerRef, dependencies: [dataLoading] });

  // Auth redirect
  if (!authLoading && !user) {
    router.replace("/login");
    return null;
  }

  if (authLoading || dataLoading) {
    return <ProfileSkeleton />;
  }

  if (notFound && !isOwnProfile) {
    return (
      <div className="space-y-4 px-4 md:px-0">
        <h1 className="font-display text-2xl text-foreground">Profil gracza</h1>
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <Swords className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-4 text-sm text-muted-foreground">Nie znaleziono gracza</p>
          <Link href="/leaderboard" className="mt-4 inline-flex items-center gap-2 text-xs text-primary">
            <ArrowLeft className="h-3 w-3" /> Ranking
          </Link>
        </div>
      </div>
    );
  }

  async function handleAddFriend() {
    if (!entry?.username || friendSent) return;
    try {
      await sendFriendMutation.mutateAsync(entry.username);
      setFriendSent(true);
      toast.success("Zaproszenie wysłane");
    } catch (err) {
      if (err instanceof APIError && err.status === 400) {
        const body = err.body as Record<string, unknown> | undefined;
        const detail =
          typeof body?.detail === "string"
            ? body.detail
            : "Już jesteście znajomymi";
        toast.error(detail);
      } else {
        toast.error("Nie udało się wysłać zaproszenia");
      }
    }
  }

  const friendLoading = sendFriendMutation.isPending;

  const currentUser = profile ?? user!;
  const displayName = isOwnProfile ? currentUser.username : (entry?.username ?? "Gracz");
  const isBanned = isOwnProfile ? currentUser.is_banned : (entry?.is_banned ?? false);
  const elo = isOwnProfile ? currentUser.elo_rating : (entry?.elo_rating ?? 0);
  const matchesPlayed = isOwnProfile ? matches.length : (entry?.matches_played ?? 0);
  const wins = isOwnProfile
    ? matches.filter((m) => m.status === "finished" && m.winner_id === currentUser.id).length
    : (entry?.wins ?? 0);
  const winRate = isOwnProfile
    ? (matches.filter((m) => m.status === "finished").length > 0
      ? Math.round((wins / matches.filter((m) => m.status === "finished").length) * 100)
      : 0)
    : Math.round((entry?.win_rate ?? 0) * 100);
  const defaultDeck = decks.find((d) => d.is_default);

  return (
    <div ref={containerRef} className="animate-page-in space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 md:px-0">
        {!isOwnProfile && (
          <Link
            href="/leaderboard"
            className="inline-flex items-center justify-center h-9 w-9 rounded-full text-muted-foreground transition-all hover:text-foreground hover:bg-muted active:scale-[0.95] shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        <div className="flex-1 min-w-0">
          <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground">Profil</p>
          <h1 className="font-display text-2xl md:text-3xl text-foreground truncate">
            {(isOwnProfile ? currentUser.clan_tag : entry?.clan_tag) && <ClanTag tag={isOwnProfile ? currentUser.clan_tag : entry?.clan_tag} className="text-lg md:text-xl mr-1.5" />}
            {displayName}
          </h1>
        </div>
        {isOwnProfile && (
          <Link
            href="/settings"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-[0.95]"
          >
            <Settings className="h-4 w-4" />
          </Link>
        )}
        {!isOwnProfile && friendshipStatus === "none" && (
          <button
            onClick={handleAddFriend}
            disabled={friendLoading || friendSent}
            className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {friendLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <UserPlus className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">
              {friendSent ? "Wysłano" : "Dodaj do znajomych"}
            </span>
          </button>
        )}
        {!isOwnProfile && friendshipStatus === "pending" && (
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-muted-foreground">
            <UserPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Zaproszenie wysłane</span>
          </span>
        )}
        {!isOwnProfile && friendshipStatus === "accepted" && (
          <span className="inline-flex items-center gap-2 rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1.5 text-xs font-semibold text-green-400">
            <Users className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Znajomy</span>
          </span>
        )}
      </div>

      {/* Banned banner */}
      {isBanned && (
        <div className="px-4 md:px-0">
          <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3">
            <BannedBadge className="text-xs px-2 py-1" />
            <span className="text-sm text-destructive font-medium">
              {isOwnProfile ? "Twoje konto zostało zbanowane." : "To konto zostało zbanowane."}
            </span>
          </div>
        </div>
      )}

      {/* Identity + stats */}
      <div className="px-4 md:px-0">
        <div className="md:rounded-2xl md:border md:border-border md:bg-card md:p-5">
          <div className="flex items-center gap-3 md:gap-4">
            <div className="flex h-12 w-12 md:h-16 md:w-16 shrink-0 items-center justify-center rounded-2xl border border-border bg-primary/10">
              {placement !== null && placement <= 3 ? (
                <Crown className="h-6 w-6 md:h-7 md:w-7 text-accent" />
              ) : (
                <User className="h-6 w-6 md:h-7 md:w-7 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-display text-lg md:text-2xl text-foreground truncate">{displayName}</span>
                {placement && (
                  <span className="text-xs md:text-sm text-muted-foreground font-medium">#{placement}</span>
                )}
                {isBanned && <BannedBadge />}
              </div>
              {isOwnProfile && (
                <p className="text-xs md:text-sm text-muted-foreground truncate">{currentUser.email}</p>
              )}
            </div>
            {isOwnProfile && wallet && (
              <div className="hidden md:flex items-center gap-1.5 text-accent">
                <Trophy className="h-4 w-4" />
                <span className="font-display text-lg tabular-nums">{wallet.gold.toLocaleString("pl-PL")}g</span>
              </div>
            )}
          </div>

          {/* Stats — horizontal scroll on mobile, grid on desktop */}
          <div className="animate-stagger flex gap-2 mt-3 md:mt-5 overflow-x-auto pb-0.5 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
            {[
              { value: elo, label: "ELO", color: "text-accent", isNum: true },
              { value: matchesPlayed, label: "Mecze", color: "text-primary", isNum: true },
              { value: wins, label: "Wygrane", color: "text-emerald-300", isNum: true },
              { value: winRate, label: "Win Rate", color: "text-violet-300", isNum: true, suffix: "%" },
            ].map((s) => (
              <div key={s.label} className="hover-lift flex shrink-0 items-center gap-2.5 rounded-xl bg-secondary/50 border border-border px-3 py-2 md:p-4 md:flex-col md:items-start md:gap-1.5 min-w-[100px] md:min-w-0">
                <span className="text-[9px] md:text-xs uppercase tracking-[0.15em] md:tracking-[0.2em] text-muted-foreground font-medium">{s.label}</span>
                <span data-counter={s.isNum ? s.value : undefined} data-suffix={s.suffix ?? ""} className={`font-display text-base md:text-3xl tabular-nums ${s.color} ml-auto md:ml-0`}>{s.isNum ? "0" + (s.suffix ?? "") : s.value}</span>
              </div>
            ))}
          </div>

          {/* Extra stats */}
          {entry && (
            <div className="mt-3 flex flex-wrap gap-3 text-xs md:text-sm text-muted-foreground">
              <span>Śr. placement: <span className="text-foreground/80">{entry.average_placement.toFixed(2)}</span></span>
              {isOwnProfile && wallet && (
                <span className="md:hidden">Złoto: <span className="text-accent">{wallet.gold.toLocaleString("pl-PL")}</span></span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* === CHARTS — for all profiles === */}
      {matches.length > 0 && (
        <div className="px-4 md:px-0">
          <ProfileCharts matches={matches} userId={userId} currentElo={elo} />
        </div>
      )}

      {/* === MATCHES — for all profiles === */}
      {matches.length > 0 && (
          <div className="px-4 md:px-0">
            <div className="md:rounded-2xl md:border md:border-border md:bg-card md:p-5">
              <div className="flex items-center justify-between mb-2 md:mb-4">
                <p className="text-[11px] md:text-sm uppercase tracking-[0.18em] md:tracking-[0.2em] text-muted-foreground font-medium">Ostatnie mecze</p>
                {isOwnProfile && (
                  <Link href="/dashboard" className="text-xs md:text-sm text-primary hover:text-primary/80 transition-colors">
                    Panel <ChevronRight className="inline h-3 w-3 md:h-4 md:w-4" />
                  </Link>
                )}
              </div>

              {matches.length === 0 ? (
                <div className="rounded-xl border border-border bg-secondary/30 py-8 text-center">
                  <Swords className="mx-auto h-6 w-6 md:h-8 md:w-8 text-muted-foreground/40" />
                  <p className="mt-2 text-xs md:text-sm text-muted-foreground">Brak meczów</p>
                </div>
              ) : (
                <>
                <div className="md:hidden space-y-0.5">
                  {matches.slice(0, 8).map((match) => {
                    const isActive = match.status === "in_progress" || match.status === "selecting";
                    const isWinner = match.winner_id === userId;
                    const profilePlayer = match.players.find((p) => p.user_id === userId);
                    const isLoss = match.status === "finished" && !isWinner && profilePlayer && !profilePlayer.is_alive;
                    const date = new Date(match.finished_at ?? match.started_at ?? match.created_at);
                    return (
                      <button key={match.id} className="hover-lift flex w-full items-center gap-3 rounded-xl py-2.5 px-1 text-left transition-all active:bg-muted/50"
                        onClick={() => router.push(isActive ? `/game/${match.id}` : `/match/${match.id}`)}>
                        <div className="flex gap-0.5 shrink-0">
                          {match.players.map((p) => (<div key={p.id} className="h-4 w-4 rounded-md" style={{ backgroundColor: p.color, opacity: !p.is_alive && match.status === "finished" ? 0.3 : 1 }} />))}
                        </div>
                        <span className="text-xs font-medium flex-1">
                          {isActive ? <span className="text-primary">Na żywo</span> : isWinner ? <span className="text-accent">Wygrana</span> : isLoss ? <span className="text-destructive">Przegrana</span> : <span className="text-muted-foreground">Zakończony</span>}
                          <span className="text-[10px] text-muted-foreground ml-1.5">{match.max_players <= 2 ? "1v1" : `${match.max_players}P`}</span>
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">{date.toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}</span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                      </button>
                    );
                  })}
                </div>

                {/* Desktop: proper table */}
                <Table className="hidden md:table text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-10 text-xs font-semibold">Wynik</TableHead>
                      <TableHead className="h-10 text-xs font-semibold">Gracze</TableHead>
                      <TableHead className="h-10 text-xs font-semibold">Tryb</TableHead>
                      <TableHead className="h-10 text-xs font-semibold text-right">Czas</TableHead>
                      <TableHead className="h-10 text-xs font-semibold text-right">Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {matches.slice(0, 8).map((match) => {
                      const isActive = match.status === "in_progress" || match.status === "selecting";
                      const isWinner = match.winner_id === userId;
                      const profilePlayer = match.players.find((p) => p.user_id === userId);
                      const isLoss = match.status === "finished" && !isWinner && profilePlayer && !profilePlayer.is_alive;
                      const date = new Date(match.finished_at ?? match.started_at ?? match.created_at);
                      const startDate = match.started_at ? new Date(match.started_at) : null;
                      const endDate = match.finished_at ? new Date(match.finished_at) : null;
                      const durationMin = startDate && endDate ? Math.round((endDate.getTime() - startDate.getTime()) / 60000) : null;
                      return (
                        <TableRow key={match.id} className="hover-lift cursor-pointer hover:bg-muted/30" onClick={() => router.push(isActive ? `/game/${match.id}` : `/match/${match.id}`)}>
                          <TableCell className="py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="flex gap-0.5 shrink-0">
                                {match.players.map((p) => (<div key={p.id} className="h-5 w-5 rounded" style={{ backgroundColor: p.color, opacity: !p.is_alive && match.status === "finished" ? 0.3 : 1 }} />))}
                              </div>
                              <span className="text-sm font-medium">
                                {isActive ? <span className="text-primary">Na żywo</span> : isWinner ? <span className="text-accent">Wygrana</span> : isLoss ? <span className="text-destructive">Przegrana</span> : <span className="text-muted-foreground">{match.status === "cancelled" ? "Anulowany" : "Zakończony"}</span>}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 text-sm text-muted-foreground">{match.players.length} graczy</TableCell>
                          <TableCell className="py-2.5 text-sm text-muted-foreground">{match.max_players <= 2 ? "1v1" : `${match.max_players}P`}</TableCell>
                          <TableCell className="py-2.5 text-sm text-muted-foreground text-right tabular-nums">{durationMin != null ? `${durationMin} min` : isActive ? "W toku" : "—"}</TableCell>
                          <TableCell className="py-2.5 text-sm text-muted-foreground text-right tabular-nums">{date.toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </>
              )}
            </div>
          </div>
      )}

      {/* === OWN PROFILE SECTIONS === */}
      {isOwnProfile && (
        <>
          {/* Inventory preview */}
          <div className="px-4 md:px-0">
            <div className="md:rounded-2xl md:border md:border-border md:bg-card md:p-5">
              <div className="flex items-center justify-between mb-2 md:mb-4">
                <p className="text-[11px] md:text-sm uppercase tracking-[0.18em] md:tracking-[0.2em] text-muted-foreground font-medium">Ekwipunek</p>
                <Link href="/inventory" className="text-xs md:text-sm text-primary hover:text-primary/80 transition-colors">
                  Pełny <ChevronRight className="inline h-3 w-3 md:h-4 md:w-4" />
                </Link>
              </div>

              {inventory.length === 0 ? (
                <div className="rounded-xl border border-border bg-secondary/30 py-8 text-center">
                  <Package className="mx-auto h-6 w-6 md:h-8 md:w-8 text-muted-foreground/40" />
                  <p className="mt-2 text-xs md:text-sm text-muted-foreground">Brak przedmiotów</p>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-1.5 md:grid-cols-8 lg:grid-cols-10 md:gap-2">
                  {inventory.map((inv) => (
                    <Link key={inv.id} href="/inventory" title={`${inv.item.name} ×${inv.quantity}`}
                      className="relative flex flex-col items-center justify-center rounded-xl border border-border bg-secondary/50 p-1.5 md:p-2 transition-all hover:bg-muted hover:border-border/60 hover:scale-[1.02] aspect-square md:aspect-auto md:py-2.5">
                      <span className="text-lg md:text-xl leading-none select-none">{inv.item.icon || "📦"}</span>
                      <span className="mt-1 text-[9px] md:text-[10px] font-medium text-foreground/80 text-center leading-tight line-clamp-1">{inv.item.name.replace(/^(Blueprint|Pakiet|Bonus): ?/, "")}</span>
                      {inv.quantity > 1 && <span className="absolute top-0.5 right-1 text-[7px] md:text-[9px] text-muted-foreground font-semibold">×{inv.quantity}</span>}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Active deck */}
          <div className="px-4 md:px-0">
            <div className="md:rounded-2xl md:border md:border-border md:bg-card md:p-5">
              <div className="flex items-center justify-between mb-2 md:mb-4">
                <p className="text-[11px] md:text-sm uppercase tracking-[0.18em] md:tracking-[0.2em] text-muted-foreground font-medium">Aktywna talia</p>
                <Link href="/decks" className="text-xs md:text-sm text-primary hover:text-primary/80 transition-colors">
                  Zarządzaj <ChevronRight className="inline h-3 w-3 md:h-4 md:w-4" />
                </Link>
              </div>

              {!defaultDeck ? (
                <div className="rounded-xl border border-border bg-secondary/30 py-8 text-center">
                  <Layers className="mx-auto h-6 w-6 md:h-8 md:w-8 text-muted-foreground/40" />
                  <p className="mt-2 text-xs md:text-sm text-muted-foreground">Brak domyślnej talii</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-secondary/50 p-3 md:p-4">
                  <div className="flex items-center gap-2.5 md:gap-3 mb-2 md:mb-3">
                    <Layers className="h-4 w-4 md:h-5 md:w-5 text-primary shrink-0" />
                    <span className="text-sm md:text-lg font-medium text-foreground">{defaultDeck.name}</span>
                    <Badge className="bg-accent/20 text-accent border-accent/30 text-[10px] md:text-xs">domyślna</Badge>
                  </div>
                  {defaultDeck.items.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 md:gap-2">
                      {defaultDeck.items.map((di, i) => (
                        <span key={i} className="rounded-full border border-border bg-secondary px-2.5 py-0.5 md:px-3 md:py-1 text-[10px] md:text-sm text-foreground/80">
                          {di.item.name}{di.quantity > 1 && ` ×${di.quantity}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* === OTHER PROFILE — Leaderboard CTA === */}
      {!isOwnProfile && (
        <div className="px-4 md:px-0">
          <div className="flex items-center justify-between rounded-2xl border border-border bg-card/50 md:bg-card p-3 md:p-5">
            <div className="flex items-center gap-2 md:gap-3">
              <Trophy className="h-4 w-4 md:h-5 md:w-5 text-accent" />
              <span className="text-xs md:text-base text-muted-foreground">Pełna tabela liderów</span>
            </div>
            <Link
              href="/leaderboard"
              className="rounded-full md:rounded-xl border border-primary/20 bg-primary/10 px-3 py-1.5 md:px-5 md:py-2.5 text-xs md:text-sm font-semibold text-primary hover:bg-primary/20 transition-colors active:scale-[0.97]"
            >
              Ranking
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
