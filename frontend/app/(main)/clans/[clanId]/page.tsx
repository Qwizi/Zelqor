"use client";

import {
  ArrowDown,
  ArrowUp,
  Calendar as CalendarIcon,
  Check,
  ChevronRight,
  Coins,
  Crown,
  Loader2,
  LogOut,
  MessageSquare,
  ScrollText,
  Search,
  Send,
  Settings,
  Shield,
  Star,
  Swords,
  Trash2,
  Trophy,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useAcceptJoinRequest,
  useClan,
  useClanActivityLog,
  useClanChat,
  useClanJoinRequests,
  useClanMembers,
  useClanStats,
  useClans,
  useClanWars,
  useDeclareWar,
  useDeclineJoinRequest,
  useDemoteMember,
  useDissolveClan,
  useDonateGold,
  useFriends,
  useInvitePlayer,
  useJoinClan,
  useKickMember,
  useLeaveClan,
  useMyClan,
  usePromoteMember,
  useSendClanChat,
  useTransferLeadership,
  useWithdrawGold,
} from "@/hooks/queries";
import { useAuth } from "@/hooks/useAuth";
import type { ClanMembershipOut, ClanWarOut } from "@/lib/api";
import { APIError } from "@/lib/api";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = {
  leader: "Lider",
  officer: "Oficer",
  member: "Członek",
  recruit: "Rekrut",
};

const ROLE_ICON: Record<string, React.ReactNode> = {
  leader: <Crown className="h-3.5 w-3.5 text-[#FFD700]" />,
  officer: <Shield className="h-3.5 w-3.5 text-blue-400" />,
};

const ACTION_LABELS: Record<string, string> = {
  member_joined: "dołączył do klanu",
  member_left: "opuścił klan",
  member_kicked: "został wyrzucony",
  member_promoted: "został awansowany",
  member_demoted: "został zdegradowany",
  gold_donated: "wpłacił złoto",
  gold_withdrawn: "wypłacił złoto",
  settings_changed: "zmienił ustawienia",
  war_declared: "wypowiedział wojnę",
  war_won: "wygrał wojnę",
  war_lost: "przegrał wojnę",
  clan_leveled_up: "klan awansował",
  leader_transferred: "przekazał lidera",
};

type Tab = "members" | "wars" | "chat" | "activity" | "requests";

const ROLE_RANK: Record<string, number> = { leader: 4, officer: 3, member: 2, recruit: 1 };

const WAR_STATUS_LABELS: Record<string, string> = {
  pending: "Oczekuje",
  accepted: "Zaakceptowana",
  in_progress: "W trakcie",
  finished: "Zakończona",
  declined: "Odrzucona",
  cancelled: "Anulowana",
};

function WarStatusBadge({ status, won }: { status: string; won?: boolean }) {
  if (status === "finished") {
    return (
      <Badge
        variant="outline"
        className={`rounded-full border-0 px-2.5 py-0.5 text-xs ${won ? "bg-green-500/15 text-green-400" : "bg-destructive/15 text-destructive"}`}
      >
        {won ? "Wygrana" : "Przegrana"}
      </Badge>
    );
  }
  const colorMap: Record<string, string> = {
    pending: "bg-yellow-500/15 text-yellow-400",
    accepted: "bg-blue-500/15 text-blue-400",
    in_progress: "bg-primary/15 text-primary",
    declined: "bg-muted text-muted-foreground",
    cancelled: "bg-muted text-muted-foreground",
  };
  return (
    <Badge
      variant="outline"
      className={`rounded-full border-0 px-2.5 py-0.5 text-xs ${colorMap[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {WAR_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

function WarCard({ war, clanId }: { war: ClanWarOut; clanId: string }) {
  const isChallenger = war.challenger.id === clanId;
  const opponent = isChallenger ? war.defender : war.challenger;
  const eloChange = isChallenger ? war.challenger_elo_change : war.defender_elo_change;
  const won = war.winner_id === clanId;

  return (
    <Link
      href={`/clans/wars/${war.id}`}
      className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-border bg-card/50 hover:bg-muted/30 transition-colors"
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold text-white"
        style={{ backgroundColor: opponent.color }}
      >
        {opponent.tag}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">
          vs [{opponent.tag}] {opponent.name}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-muted-foreground">
            {war.players_per_side}v{war.players_per_side}
          </span>
          {war.wager_gold > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-[10px] text-accent tabular-nums">{war.wager_gold.toLocaleString()}g</span>
            </>
          )}
          {war.started_at && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(war.started_at).toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <WarStatusBadge status={war.status} won={won} />
        {war.status === "finished" && eloChange !== 0 && (
          <span
            className={`text-xs font-semibold tabular-nums ${eloChange > 0 ? "text-green-400" : "text-destructive"}`}
          >
            {eloChange > 0 ? "+" : ""}
            {eloChange}
          </span>
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
      </div>
    </Link>
  );
}

export default function ClanDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const clanId = params.clanId as string;

  const searchParams = useSearchParams();

  const [tab, setTab] = useState<Tab>("members");
  const [donateAmount, setDonateAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [chatMsg, setChatMsg] = useState("");
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [showDeclareWar, setShowDeclareWar] = useState(false);
  const [warTargetSearch, setWarTargetSearch] = useState("");
  const [warTargetId, setWarTargetId] = useState("");
  const [warTargetName, setWarTargetName] = useState("");
  const [warWager, setWarWager] = useState("100");
  const [warPlayers, setWarPlayers] = useState("3");
  const [warScheduledAt, setWarScheduledAt] = useState("");

  // Auto-open war form when redirected from another clan page
  useEffect(() => {
    const targetId = searchParams.get("war_target");
    const targetName = searchParams.get("war_target_name");
    if (targetId && targetName) {
      setWarTargetId(targetId);
      setWarTargetName(targetName);
      setTab("wars");
      setShowDeclareWar(true);
    }
  }, [searchParams]);

  const { data: clan, isLoading } = useClan(clanId);
  const { data: membersData } = useClanMembers(clanId, 100);
  const { data: warsData } = useClanWars(clanId, 20);
  const { data: stats } = useClanStats(clanId);
  const { data: activityData } = useClanActivityLog(clanId, 50);
  const { data: chatData, refetch: refetchChat } = useClanChat(clanId, 50);
  const { data: joinReqData } = useClanJoinRequests(clanId, 50);
  const { data: myClanData } = useMyClan();
  const { data: friendsData } = useFriends(100);
  const { data: clanSearchData } = useClans(warTargetSearch.length >= 2 ? warTargetSearch : undefined, 10);

  const leaveMut = useLeaveClan();
  const kickMut = useKickMember();
  const promoteMut = usePromoteMember();
  const demoteMut = useDemoteMember();
  const transferMut = useTransferLeadership();
  const donateMut = useDonateGold();
  const withdrawMut = useWithdrawGold();
  const joinMut = useJoinClan();
  const chatMut = useSendClanChat();
  const dissolveMut = useDissolveClan();
  const acceptJrMut = useAcceptJoinRequest();
  const declineJrMut = useDeclineJoinRequest();
  const inviteMut = useInvitePlayer();
  const declareWarMut = useDeclareWar();

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  if (isLoading || authLoading) {
    return (
      <div className="animate-page-in space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
        <div className="px-4 md:px-0">
          <Skeleton className="h-6 w-24 mb-2" />
          <Skeleton className="h-10 w-64" />
        </div>
        <div className="px-4 md:px-0 space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!clan) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-14 text-center">
        <Swords size={32} className="text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Klan nie znaleziony.</p>
      </div>
    );
  }

  const myM = clan.my_membership;
  const isMember = !!myM;
  const isLeader = myM?.role === "leader";
  const isOfficer = myM?.role === "officer" || isLeader;
  const members = membersData?.items ?? [];
  const wars = warsData?.items ?? [];
  const activity = activityData?.items ?? [];
  const chatMessages = chatData?.items ?? [];
  const joinRequests = joinReqData?.items ?? [];
  const myRank = myM ? (ROLE_RANK[myM.role] ?? 0) : 0;
  const isInAnyClan = !!myClanData?.clan;
  const myOwnClanId = myClanData?.clan?.id;
  const isOfficerInOwnClan = myClanData?.membership?.role === "officer" || myClanData?.membership?.role === "leader";
  const canDeclareWar = !isMember && isOfficerInOwnClan && myOwnClanId && myOwnClanId !== clanId;

  // Friends not already in any clan (clan_tag === null means no clan)
  const allFriends = friendsData?.items ?? [];
  const memberUserIds = new Set(members.map((m) => m.user.id));
  const invitableFriends = allFriends.filter((f) => {
    const friend = f.from_user.id === user?.id ? f.to_user : f.from_user;
    return !friend.clan_tag && !memberUserIds.has(friend.id);
  });

  function canManage(target: ClanMembershipOut) {
    return myRank > (ROLE_RANK[target.role] ?? 0);
  }

  const handleDonate = () => {
    const amount = parseInt(donateAmount, 10);
    if (!amount || amount < 1) return;
    donateMut.mutate(
      { clanId, amount },
      {
        onSuccess: () => {
          toast.success(`Wpłacono ${amount} złota`, { id: "clan-donate" });
          setDonateAmount("");
        },
        onError: (err) =>
          toast.error(err instanceof APIError ? err.message : "Nie udało się wpłacić", { id: "clan-donate-error" }),
      },
    );
  };

  const _handleWithdraw = () => {
    const amount = parseInt(withdrawAmount, 10);
    if (!amount || amount < 1) return;
    withdrawMut.mutate(
      { clanId, amount },
      {
        onSuccess: () => {
          toast.success(`Wypłacono ${amount} złota`, { id: "clan-withdraw" });
          setWithdrawAmount("");
        },
        onError: (err) =>
          toast.error(err instanceof APIError ? err.message : "Nie udało się wypłacić", { id: "clan-withdraw-error" }),
      },
    );
  };

  const handleSendChat = () => {
    if (!chatMsg.trim()) return;
    chatMut.mutate(
      { clanId, content: chatMsg.trim() },
      {
        onSuccess: () => {
          setChatMsg("");
          refetchChat();
        },
        onError: (err) =>
          toast.error(err instanceof APIError ? err.message : "Nie udało się wysłać", { id: "clan-chat-error" }),
      },
    );
  };

  const tabs: { key: Tab; label: string; mobileLabel: string; icon: React.ReactNode; show: boolean; count?: number }[] =
    [
      { key: "members", label: "Członkowie", mobileLabel: "Członkowie", icon: <Users size={14} />, show: true },
      { key: "wars", label: "Wojny", mobileLabel: "Wojny", icon: <Swords size={14} />, show: true },
      { key: "chat", label: "Czat", mobileLabel: "Czat", icon: <MessageSquare size={14} />, show: isMember },
      { key: "activity", label: "Aktywność", mobileLabel: "Log", icon: <ScrollText size={14} />, show: isMember },
      {
        key: "requests",
        label: "Prośby",
        mobileLabel: "Prośby",
        icon: <Users size={14} />,
        show: isOfficer,
        count: joinRequests.length,
      },
    ];

  return (
    <div className="animate-page-in space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 px-4 md:px-0">
        <div className="flex items-center gap-3 md:gap-4">
          <div
            className="flex h-12 w-12 md:h-16 md:w-16 shrink-0 items-center justify-center rounded-xl font-display text-sm md:text-xl font-bold text-white"
            style={{ backgroundColor: clan.color }}
          >
            {clan.tag}
          </div>
          <div>
            <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">
              KLAN
            </p>
            <h1 className="font-display text-2xl md:text-5xl text-foreground">{clan.name}</h1>
            <div className="flex items-center gap-2 md:gap-3 mt-0.5 md:mt-1 text-xs md:text-sm text-muted-foreground">
              <span>Lv. {clan.level}</span>
              <span>&middot;</span>
              <span className="flex items-center gap-1">
                <Trophy className="h-3.5 w-3.5" />
                {clan.elo_rating} ELO
              </span>
              <span>&middot;</span>
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {clan.member_count}/{clan.max_members}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-1.5 md:gap-2 shrink-0 pt-1">
          {!isMember &&
            clan.is_recruiting &&
            (isInAnyClan ? (
              <span className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">
                Musisz opuścić obecny klan
              </span>
            ) : (
              <Button
                disabled={joinMut.isPending}
                className="gap-2 h-9 md:h-10 md:px-5 md:text-sm"
                onClick={() =>
                  joinMut.mutate(
                    { clanId },
                    {
                      onSuccess: (res) => {
                        if (res.joined) {
                          toast.success("Dołączono!", { id: "clan-join" });
                          router.refresh();
                        } else toast.success(res.message || "Wysłano prośbę", { id: "clan-join" });
                      },
                      onError: (err) =>
                        toast.error(err instanceof APIError ? err.message : "Nie udało się dołączyć", {
                          id: "clan-join-error",
                        }),
                    },
                  )
                }
              >
                {joinMut.isPending && <Loader2 size={14} className="animate-spin" />}
                {clan.is_public ? "Dołącz" : "Poproś"}
              </Button>
            ))}
          {canDeclareWar && (
            <Button
              variant="destructive"
              className="gap-2 h-9 md:h-10 md:px-5 md:text-sm"
              onClick={() => {
                router.push(
                  `/clans/${myOwnClanId}?war_target=${clanId}&war_target_name=${encodeURIComponent(`[${clan.tag}] ${clan.name}`)}`,
                );
              }}
            >
              <Swords size={16} />
              <span className="hidden md:inline">Wypowiedz wojnę</span>
            </Button>
          )}
          {isOfficer && (
            <>
              <Button className="gap-2 h-9 md:h-10 md:px-5 md:text-sm" onClick={() => setShowInvitePanel((v) => !v)}>
                <UserPlus size={16} />
                <span className="hidden md:inline">Zaproś</span>
                {invitableFriends.length > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-foreground/20 text-[10px] font-bold tabular-nums">
                    {invitableFriends.length}
                  </span>
                )}
              </Button>
              <Link href={`/clans/${clanId}/settings`}>
                <Button variant="outline" className="gap-2 h-9 md:h-10 md:px-5 md:text-sm">
                  <Settings size={16} />
                  <span className="hidden md:inline">Ustawienia</span>
                </Button>
              </Link>
            </>
          )}
          {isMember && !isLeader && (
            <Button
              variant="outline"
              disabled={leaveMut.isPending}
              className="gap-2 h-9 md:h-10 md:px-5 md:text-sm text-muted-foreground hover:text-destructive hover:border-destructive/30"
              onClick={() =>
                leaveMut.mutate(clanId, {
                  onSuccess: () => {
                    toast.success("Opuszczono klan", { id: "clan-leave" });
                    router.push("/clans");
                  },
                  onError: (err) =>
                    toast.error(err instanceof APIError ? err.message : "Nie udało się opuścić klanu", {
                      id: "clan-leave-error",
                    }),
                })
              }
            >
              <LogOut size={16} />
              <span className="hidden md:inline">Opuść</span>
            </Button>
          )}
          {isLeader && (
            <Button
              variant="outline"
              disabled={dissolveMut.isPending}
              className="gap-2 h-9 md:h-10 md:px-5 md:text-sm text-destructive hover:text-destructive hover:border-destructive/30 hover:bg-destructive/10"
              onClick={() => {
                if (confirm("Na pewno chcesz rozwiązać klan?")) {
                  dissolveMut.mutate(clanId, {
                    onSuccess: () => {
                      toast.success("Klan rozwiązany", { id: "clan-dissolve" });
                      router.push("/clans");
                    },
                    onError: (err) =>
                      toast.error(err instanceof APIError ? err.message : "Nie udało się rozwiązać klanu", {
                        id: "clan-dissolve-error",
                      }),
                  });
                }
              }}
            >
              <Trash2 size={16} />
              <span className="hidden md:inline">Rozwiąż</span>
            </Button>
          )}
        </div>
      </div>

      {/* Clan Level Progress */}
      {(() => {
        const lvl = clan.level ?? 1;
        const xp = clan.experience ?? 0;
        // Thresholds from ClanLevel seed migration
        const thresholds: Record<number, number> = {
          1: 0,
          2: 100,
          3: 250,
          4: 500,
          5: 1000,
          6: 2000,
          7: 4000,
          8: 8000,
          9: 16000,
          10: 32000,
          11: 48000,
          12: 72000,
          13: 108000,
          14: 162000,
          15: 243000,
          16: 364500,
          17: 546750,
          18: 820125,
          19: 1230187,
          20: 1845280,
        };
        const xpCurrent = thresholds[lvl] ?? 0;
        const xpNext = thresholds[lvl + 1] ?? xpCurrent + 10000;
        const xpInLevel = Math.max(0, xp - xpCurrent);
        const xpNeeded = xpNext - xpCurrent;
        const pct = Math.min(100, xpNeeded > 0 ? Math.round((xpInLevel / xpNeeded) * 100) : 100);
        return (
          <div className="px-4 md:px-0">
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/50 px-4 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10">
                <Star className="h-3.5 w-3.5 text-violet-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-foreground">Poziom {lvl}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {xpInLevel.toLocaleString()} / {xpNeeded.toLocaleString()} XP do lvl {lvl + 1}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400 transition-all duration-700"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">{pct}%</span>
            </div>
          </div>
        );
      })()}

      {/* Description */}
      {clan.description && (
        <div className="px-4 md:px-0">
          <p className="text-sm md:text-base text-muted-foreground">{clan.description}</p>
        </div>
      )}

      {/* ── Invite Panel (shows when button clicked) ── */}
      {isOfficer && showInvitePanel && (
        <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4 md:p-6 mx-4 md:mx-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
              <UserPlus className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">
                Zaproś znajomych
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{invitableFriends.length} znajomych bez klanu</p>
            </div>
          </div>
          {invitableFriends.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-6 text-center">
              <UserPlus size={24} className="text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Brak znajomych do zaproszenia. Znajomi muszą być bez klanu.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
              {invitableFriends.map((f) => {
                const friend = f.from_user.id === user?.id ? f.to_user : f.from_user;
                const isPending = inviteMut.isPending && inviteMut.variables?.userId === friend.id;
                return (
                  <div key={f.id} className="flex items-center gap-3 px-4 md:px-6 py-3 md:py-4 bg-card/50">
                    <div className="flex h-9 w-9 md:h-10 md:w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-sm md:text-base font-bold uppercase text-foreground">
                      {friend.username.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm md:text-base font-semibold text-foreground truncate">{friend.username}</p>
                      <p className="text-xs md:text-sm text-muted-foreground">
                        ELO: <span className="text-accent tabular-nums">{friend.elo_rating}</span>
                      </p>
                    </div>
                    <Button
                      disabled={isPending}
                      className="shrink-0 gap-2 h-9 md:h-10 md:px-5 md:text-sm"
                      onClick={() =>
                        inviteMut.mutate(
                          { clanId, userId: friend.id },
                          {
                            onSuccess: () => toast.success(`Zaproszono ${friend.username}`, { id: "clan-invite" }),
                            onError: (err) =>
                              toast.error(err instanceof APIError ? err.message : "Nie udało się zaprosić", {
                                id: "clan-invite-error",
                              }),
                          },
                        )
                      }
                    >
                      {isPending ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                      Zaproś
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── Stats ── */}
      {stats && (
        <div className="px-4 md:px-0">
          {/* Mobile: compact inline */}
          <div className="flex items-center gap-4 md:hidden text-sm">
            <span className="text-muted-foreground">
              Wojny: <span className="text-foreground font-semibold tabular-nums">{stats.wars_total}</span>
            </span>
            <span className="text-muted-foreground">
              W: <span className="text-green-400 font-semibold tabular-nums">{stats.wars_won}</span>
            </span>
            <span className="text-muted-foreground">
              L: <span className="text-destructive font-semibold tabular-nums">{stats.wars_lost}</span>
            </span>
            <span className="text-muted-foreground">
              WR:{" "}
              <span className="text-accent font-semibold tabular-nums">{(stats.war_win_rate * 100).toFixed(0)}%</span>
            </span>
          </div>
          {/* Desktop: card grid */}
          <div className="hidden md:grid grid-cols-4 gap-3">
            {[
              { label: "Wojny", value: stats.wars_total },
              { label: "Wygrane", value: stats.wars_won, color: "text-green-400" },
              { label: "Przegrane", value: stats.wars_lost, color: "text-destructive" },
              { label: "Win rate", value: `${(stats.war_win_rate * 100).toFixed(0)}%`, color: "text-accent" },
            ].map((s) => (
              <Card key={s.label} className="rounded-2xl">
                <CardContent className="p-4 text-center">
                  <div className={`font-display text-2xl font-bold tabular-nums ${s.color || "text-foreground"}`}>
                    {s.value}
                  </div>
                  <div className="text-sm text-muted-foreground">{s.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── Treasury Vault (Revolut-style) ── */}
      {isMember &&
        (() => {
          const contributors = (members ?? [])
            .filter((m) => m.contributions_gold > 0)
            .sort((a, b) => b.contributions_gold - a.contributions_gold);
          const totalContributed = contributors.reduce((sum, m) => sum + m.contributions_gold, 0);

          return (
            <section className="rounded-2xl border border-border bg-card/50 mx-4 md:mx-0 overflow-hidden">
              {/* Hero amount */}
              <div className="flex flex-col items-center py-6 md:py-8 px-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 mb-3">
                  <Coins className="h-6 w-6 text-accent" />
                </div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium mb-1">
                  Skarbiec klanu
                </p>
                <p className="font-display text-4xl md:text-5xl tabular-nums text-accent">
                  {clan.treasury_gold.toLocaleString()}
                </p>
                <p className="text-sm text-muted-foreground mt-1">złota</p>
                {clan.tax_percent > 0 && (
                  <p className="text-xs text-muted-foreground/60 mt-2">Podatek od transakcji: {clan.tax_percent}%</p>
                )}
              </div>

              {/* Deposit bar */}
              <div className="border-t border-border px-4 md:px-6 py-4">
                <div className="flex items-center gap-3 max-w-md mx-auto">
                  <Input
                    type="number"
                    placeholder="Kwota"
                    value={donateAmount}
                    onChange={(e) => setDonateAmount(e.target.value)}
                    className="flex-1 h-11 md:h-12 text-base text-center font-mono"
                    min={1}
                  />
                  <Button
                    onClick={handleDonate}
                    disabled={donateMut.isPending || !donateAmount}
                    className="h-11 md:h-12 px-6 md:px-8 text-base gap-2 shrink-0"
                  >
                    {donateMut.isPending && <Loader2 size={18} className="animate-spin" />}
                    Wpłać
                  </Button>
                </div>
              </div>

              {/* Contributors list */}
              {contributors.length > 0 && (
                <div className="border-t border-border">
                  <div className="px-4 md:px-6 py-3">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">
                      Wpłaty ({contributors.length})
                    </p>
                  </div>
                  <div className="divide-y divide-border">
                    {contributors.map((m, idx) => {
                      const pct = totalContributed > 0 ? (m.contributions_gold / totalContributed) * 100 : 0;
                      const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : null;
                      return (
                        <div key={m.id} className="flex items-center gap-3 px-4 md:px-6 py-3 relative overflow-hidden">
                          {/* Background progress bar */}
                          <div className="absolute inset-y-0 left-0 bg-accent/[0.04]" style={{ width: `${pct}%` }} />
                          <div className="relative flex items-center gap-3 flex-1 min-w-0">
                            {medal ? (
                              <span className="text-lg w-7 text-center shrink-0">{medal}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground/50 w-7 text-center tabular-nums shrink-0">
                                {idx + 1}
                              </span>
                            )}
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-sm font-bold uppercase text-foreground">
                              {m.user.username.charAt(0)}
                            </div>
                            <p className="text-sm font-medium text-foreground truncate">{m.user.username}</p>
                          </div>
                          <div className="relative flex items-center gap-2 shrink-0">
                            <span className="font-mono text-sm tabular-nums text-accent font-semibold">
                              {m.contributions_gold.toLocaleString()}
                            </span>
                            <span className="text-[10px] text-muted-foreground/60 tabular-nums w-10 text-right">
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          );
        })()}

      {/* ── Tabs ── */}
      <div className="px-4 md:px-0">
        {/* Mobile */}
        <div className="md:hidden overflow-x-auto pb-1 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
          <div className="inline-flex w-auto gap-1">
            {tabs
              .filter((t) => t.show)
              .map((t) => (
                <button
                  type="button"
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`shrink-0 flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                    tab === t.key
                      ? "border-primary/25 bg-primary/10 text-primary"
                      : "border-border bg-secondary/60 text-muted-foreground"
                  }`}
                >
                  {t.icon}
                  {t.mobileLabel}
                  {(t.count ?? 0) > 0 && (
                    <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 py-0 text-[10px] font-semibold text-primary">
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
          </div>
        </div>
        {/* Desktop */}
        <div className="hidden md:flex gap-1.5">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <button
                type="button"
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-lg font-medium transition-colors ${
                  tab === t.key
                    ? "border border-primary/40 bg-primary/15 text-primary"
                    : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {t.icon}
                {t.label}
                {(t.count ?? 0) > 0 && (
                  <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0.5 text-sm text-primary">{t.count}</span>
                )}
              </button>
            ))}
        </div>
      </div>

      {/* ── Members ── */}
      {tab === "members" && (
        <div className="px-4 md:px-0">
          {/* Mobile */}
          <div className="animate-list-in md:hidden space-y-0.5">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-xl py-3 px-1 hover-lift">
                <button
                  type="button"
                  onClick={() => router.push(`/profile/${m.user.id}`)}
                  className="flex flex-1 min-w-0 items-center gap-3 text-left active:opacity-70 transition-opacity"
                >
                  <div className="relative shrink-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-sm font-bold uppercase text-foreground">
                      {m.user.username.charAt(0)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {ROLE_ICON[m.role]}
                      <span className="text-sm font-semibold text-foreground truncate">{m.user.username}</span>
                      <span className="text-[10px] text-muted-foreground">{ROLE_LABELS[m.role]}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      ELO: <span className="text-accent tabular-nums text-sm">{m.user.elo_rating}</span>
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                </button>
                {isMember && canManage(m) && m.user.id !== user?.id && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    {m.role !== "officer" && m.role !== "leader" && (
                      <button
                        type="button"
                        onClick={() =>
                          promoteMut.mutate(
                            { clanId, userId: m.user.id },
                            {
                              onSuccess: () => toast.success("Awansowano", { id: "clan-promote" }),
                              onError: (err) =>
                                toast.error(err instanceof APIError ? err.message : "Nie udało się awansować", {
                                  id: "clan-promote-error",
                                }),
                            },
                          )
                        }
                        disabled={promoteMut.isPending}
                        className="flex items-center justify-center h-8 w-8 rounded-lg text-green-400 hover:bg-green-400/10 disabled:opacity-40 transition-colors"
                        title="Awansuj"
                      >
                        <ArrowUp size={14} />
                      </button>
                    )}
                    {m.role !== "recruit" && m.role !== "leader" && (
                      <button
                        type="button"
                        onClick={() =>
                          demoteMut.mutate(
                            { clanId, userId: m.user.id },
                            {
                              onSuccess: () => toast.success("Zdegradowano", { id: "clan-demote" }),
                              onError: (err) =>
                                toast.error(err instanceof APIError ? err.message : "Nie udało się zdegradować", {
                                  id: "clan-demote-error",
                                }),
                            },
                          )
                        }
                        disabled={demoteMut.isPending}
                        className="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                        title="Degraduj"
                      >
                        <ArrowDown size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        kickMut.mutate(
                          { clanId, userId: m.user.id },
                          {
                            onSuccess: () => toast.success("Wyrzucono", { id: "clan-kick" }),
                            onError: (err) =>
                              toast.error(err instanceof APIError ? err.message : "Nie udało się wyrzucić", {
                                id: "clan-kick-error",
                              }),
                          },
                        )
                      }
                      disabled={kickMut.isPending}
                      className="flex items-center justify-center h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"
                      title="Wyrzuć"
                    >
                      <UserMinus size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop */}
          <Card className="hidden md:block rounded-2xl overflow-hidden">
            <Table className="text-base">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-14 pl-6 text-sm font-semibold">Gracz</TableHead>
                  <TableHead className="h-14 text-sm font-semibold text-center">Rola</TableHead>
                  <TableHead className="h-14 text-sm font-semibold text-center">
                    <div className="flex items-center gap-1 justify-center">
                      <Trophy className="h-3.5 w-3.5 text-accent" />
                      ELO
                    </div>
                  </TableHead>
                  <TableHead className="h-14 text-sm font-semibold text-center">
                    <div className="flex items-center gap-1 justify-center">
                      <Coins className="h-3.5 w-3.5" />
                      Wpłaty
                    </div>
                  </TableHead>
                  {isMember && <TableHead className="h-14 pr-6 text-sm font-semibold text-right">Akcja</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody className="animate-list-in">
                {members.map((m) => (
                  <TableRow key={m.id} className="hover:bg-muted/50 hover-lift">
                    <TableCell className="pl-6 py-3.5">
                      <Link href={`/profile/${m.user.id}`} className="flex items-center gap-3 group">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-base font-bold uppercase text-foreground">
                          {m.user.username.charAt(0)}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {ROLE_ICON[m.role]}
                          <span className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                            {m.user.username}
                          </span>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="py-3.5 text-center">
                      <Badge
                        variant="outline"
                        className={`rounded-full border-0 px-3 py-1 text-sm ${
                          m.role === "leader"
                            ? "bg-[#FFD700]/15 text-[#FFD700]"
                            : m.role === "officer"
                              ? "bg-blue-400/15 text-blue-400"
                              : "bg-muted text-muted-foreground"
                        } hover:bg-transparent`}
                      >
                        {ROLE_LABELS[m.role]}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3.5 text-center">
                      <span className="font-display text-xl tabular-nums text-accent">{m.user.elo_rating}</span>
                    </TableCell>
                    <TableCell className="py-3.5 text-center">
                      <span className="text-base tabular-nums text-foreground">{m.contributions_gold}g</span>
                    </TableCell>
                    {isMember && (
                      <TableCell className="py-3.5 pr-6 text-right">
                        {canManage(m) && m.user.id !== user?.id && (
                          <div className="flex items-center justify-end gap-1">
                            {m.role !== "officer" && m.role !== "leader" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  promoteMut.mutate(
                                    { clanId, userId: m.user.id },
                                    {
                                      onSuccess: () => toast.success("Awansowano", { id: "clan-promote" }),
                                      onError: (err) =>
                                        toast.error(err instanceof APIError ? err.message : "Nie udało się awansować", {
                                          id: "clan-promote-error",
                                        }),
                                    },
                                  )
                                }
                                disabled={promoteMut.isPending}
                                className="text-green-400 hover:text-green-400 hover:bg-green-400/10"
                              >
                                <ArrowUp size={16} />
                              </Button>
                            )}
                            {m.role !== "recruit" && m.role !== "leader" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  demoteMut.mutate(
                                    { clanId, userId: m.user.id },
                                    {
                                      onSuccess: () => toast.success("Zdegradowano", { id: "clan-demote" }),
                                      onError: (err) =>
                                        toast.error(
                                          err instanceof APIError ? err.message : "Nie udało się zdegradować",
                                          { id: "clan-demote-error" },
                                        ),
                                    },
                                  )
                                }
                                disabled={demoteMut.isPending}
                              >
                                <ArrowDown size={16} />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                kickMut.mutate(
                                  { clanId, userId: m.user.id },
                                  {
                                    onSuccess: () => toast.success("Wyrzucono", { id: "clan-kick" }),
                                    onError: (err) =>
                                      toast.error(err instanceof APIError ? err.message : "Nie udało się wyrzucić", {
                                        id: "clan-kick-error",
                                      }),
                                  },
                                )
                              }
                              disabled={kickMut.isPending}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <UserMinus size={16} />
                            </Button>
                            {isLeader && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (confirm(`Przekazać lidera do ${m.user.username}?`))
                                    transferMut.mutate(
                                      { clanId, userId: m.user.id },
                                      {
                                        onSuccess: () => toast.success("Lider przekazany", { id: "clan-transfer" }),
                                        onError: (err) =>
                                          toast.error(
                                            err instanceof APIError ? err.message : "Nie udało się przekazać lidera",
                                            { id: "clan-transfer-error" },
                                          ),
                                      },
                                    );
                                }}
                                className="text-[#FFD700] hover:text-[#FFD700] hover:bg-[#FFD700]/10"
                              >
                                <Crown size={16} />
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Invite panel moved to top of page */}
        </div>
      )}

      {/* ── Wars ── */}
      {tab === "wars" && (
        <div className="px-4 md:px-0 space-y-3">
          {/* Declare War button + form */}
          {(isOfficer || canDeclareWar) && (
            <>
              <div className="flex justify-end">
                <Button
                  variant={showDeclareWar ? "outline" : "destructive"}
                  className="gap-2 h-10 md:h-12 md:text-base md:px-6"
                  onClick={() => setShowDeclareWar((v) => !v)}
                >
                  <Swords size={16} />
                  {showDeclareWar ? "Anuluj" : "Wypowiedz wojnę"}
                </Button>
              </div>

              {showDeclareWar && (
                <section className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 md:p-6">
                  <div className="mb-5 flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10">
                      <Swords className="h-4 w-4 text-destructive" />
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">
                        Wypowiedz wojnę
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">Stawka zostanie pobrana ze skarbca klanu</p>
                    </div>
                  </div>

                  <div className="space-y-5">
                    {/* Target clan search */}
                    <div className="space-y-2">
                      <label
                        htmlFor="war-target-search"
                        className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-medium"
                      >
                        Klan przeciwnika
                      </label>
                      <div className="relative">
                        <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
                          <Search className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <Input
                          id="war-target-search"
                          placeholder="Szukaj klanu..."
                          value={warTargetId ? warTargetName : warTargetSearch}
                          onChange={(e) => {
                            setWarTargetId("");
                            setWarTargetName("");
                            setWarTargetSearch(e.target.value);
                          }}
                          className="pl-10 h-10 md:h-12 md:text-base"
                        />
                        {!warTargetId && warTargetSearch.length >= 2 && (
                          <div className="absolute z-10 mt-1 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden max-h-60 overflow-y-auto">
                            {(clanSearchData?.items ?? []).filter((c) => c.id !== clanId).length === 0 ? (
                              <div className="px-4 py-4 text-sm text-muted-foreground text-center">Brak wyników</div>
                            ) : (
                              (clanSearchData?.items ?? [])
                                .filter((c) => c.id !== clanId)
                                .map((c) => (
                                  <button
                                    type="button"
                                    key={c.id}
                                    onClick={() => {
                                      setWarTargetId(c.id);
                                      setWarTargetName(`[${c.tag}] ${c.name}`);
                                      setWarTargetSearch("");
                                    }}
                                    className="flex w-full items-center gap-3 px-4 py-3 md:py-4 text-left hover:bg-muted transition-colors"
                                  >
                                    <div
                                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold text-white"
                                      style={{ backgroundColor: c.color }}
                                    >
                                      {c.tag}
                                    </div>
                                    <div>
                                      <p className="text-sm md:text-base font-semibold text-foreground">{c.name}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {c.member_count} członków · {c.elo_rating} ELO
                                      </p>
                                    </div>
                                  </button>
                                ))
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {warTargetId && (
                      <div className="flex items-center gap-3 rounded-xl border border-accent/20 bg-accent/5 px-4 py-3">
                        <Swords className="h-4 w-4 text-accent shrink-0" />
                        <span className="text-sm md:text-base text-foreground font-semibold">{warTargetName}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setWarTargetId("");
                            setWarTargetName("");
                          }}
                          className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <label
                          htmlFor="war-wager"
                          className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-medium"
                        >
                          Stawka (złoto)
                        </label>
                        <Input
                          id="war-wager"
                          type="number"
                          min={100}
                          placeholder="min. 100"
                          value={warWager}
                          onChange={(e) => setWarWager(e.target.value)}
                          className="h-10 md:h-12 md:text-base font-mono"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Minimalna stawka: 100 złota. Wygrana = pula obu klanów.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <label
                          htmlFor="war-players"
                          className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-medium"
                        >
                          Graczy na stronę
                        </label>
                        <Input
                          id="war-players"
                          type="number"
                          min={1}
                          max={5}
                          value={warPlayers}
                          onChange={(e) => setWarPlayers(e.target.value)}
                          className="h-10 md:h-12 md:text-base font-mono"
                        />
                        <p className="text-[10px] text-muted-foreground">Od 1 do 5 graczy na stronę (np. 3v3).</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-medium">
                        Zaplanowana data (opcjonalnie)
                      </span>
                      <Popover>
                        <PopoverTrigger
                          className={cn(
                            "flex w-full items-center justify-start gap-2 rounded-md border border-input bg-background px-3 text-left font-normal h-10 md:h-12 md:text-base transition-colors hover:bg-muted",
                            !warScheduledAt && "text-muted-foreground",
                          )}
                        >
                          <CalendarIcon className="h-4 w-4 shrink-0" />
                          {warScheduledAt
                            ? new Date(warScheduledAt).toLocaleString("pl-PL", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })
                            : "Wybierz datę i godzinę..."}
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={warScheduledAt ? new Date(warScheduledAt) : undefined}
                            onSelect={(date) => {
                              if (!date) {
                                setWarScheduledAt("");
                                return;
                              }
                              const prev = warScheduledAt ? new Date(warScheduledAt) : new Date();
                              date.setHours(prev.getHours(), prev.getMinutes());
                              setWarScheduledAt(date.toISOString());
                            }}
                          />
                          <div className="border-t border-border px-4 py-3 flex items-center gap-2">
                            <label htmlFor="war-time" className="text-xs text-muted-foreground shrink-0">
                              Godzina:
                            </label>
                            <Input
                              id="war-time"
                              type="time"
                              className="h-9 w-28 text-sm"
                              value={
                                warScheduledAt
                                  ? `${String(new Date(warScheduledAt).getHours()).padStart(2, "0")}:${String(new Date(warScheduledAt).getMinutes()).padStart(2, "0")}`
                                  : ""
                              }
                              onChange={(e) => {
                                const [h, m] = e.target.value.split(":").map(Number);
                                const d = warScheduledAt ? new Date(warScheduledAt) : new Date();
                                d.setHours(h, m);
                                setWarScheduledAt(d.toISOString());
                              }}
                            />
                            {warScheduledAt && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="ml-auto text-xs text-muted-foreground"
                                onClick={() => setWarScheduledAt("")}
                              >
                                Wyczyść
                              </Button>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <p className="text-[10px] text-muted-foreground">
                        Zostaw puste aby rozpocząć wojnę od razu po akceptacji.
                      </p>
                    </div>

                    <Button
                      variant="destructive"
                      className="w-full md:w-auto h-10 md:h-12 md:text-base md:px-10 gap-2"
                      disabled={!warTargetId || declareWarMut.isPending}
                      onClick={() => {
                        const wager = parseInt(warWager, 10);
                        const players = parseInt(warPlayers, 10);
                        if (
                          !warTargetId ||
                          Number.isNaN(wager) ||
                          wager < 100 ||
                          Number.isNaN(players) ||
                          players < 1 ||
                          players > 5
                        )
                          return;
                        const attackerClanId = canDeclareWar ? (myOwnClanId as string) : clanId;
                        declareWarMut.mutate(
                          {
                            clanId: attackerClanId,
                            targetId: warTargetId,
                            data: {
                              wager_gold: wager,
                              players_per_side: players,
                              ...(warScheduledAt ? { scheduled_at: new Date(warScheduledAt).toISOString() } : {}),
                            },
                          },
                          {
                            onSuccess: () => {
                              toast.success("Wypowiedziano wojnę!", { id: "war-declare" });
                              setShowDeclareWar(false);
                              setWarTargetId("");
                              setWarTargetName("");
                              setWarTargetSearch("");
                              setWarWager("100");
                              setWarPlayers("3");
                              setWarScheduledAt("");
                            },
                            onError: (err) =>
                              toast.error(err instanceof APIError ? err.message : "Nie udało się wypowiedzieć wojny", {
                                id: "war-declare-error",
                              }),
                          },
                        );
                      }}
                    >
                      {declareWarMut.isPending && <Loader2 size={14} className="animate-spin" />}
                      Wypowiedz wojnę
                    </Button>
                  </div>
                </section>
              )}
            </>
          )}

          {/* War list */}
          {wars.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-14 text-center">
              <Swords size={32} className="text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Brak wojen.</p>
            </div>
          ) : (
            <div className="animate-list-in space-y-2">
              {wars.map((war) => (
                <WarCard key={war.id} war={war} clanId={clanId} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Chat ── */}
      {tab === "chat" && isMember && (
        <div className="px-4 md:px-0">
          <Card className="rounded-2xl">
            <CardContent className="p-4 md:p-5">
              <div className="max-h-80 md:max-h-96 space-y-2 overflow-y-auto mb-3">
                {chatMessages.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Brak wiadomości</p>
                ) : (
                  [...chatMessages].reverse().map((msg) => (
                    <div key={msg.id} className="flex gap-2 text-sm">
                      <span className="font-semibold text-primary shrink-0">{msg.user.username}</span>
                      <span className="text-foreground/80 break-all">{msg.content}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                        {new Date(msg.created_at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Napisz wiadomość..."
                  value={chatMsg}
                  onChange={(e) => setChatMsg(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
                  maxLength={500}
                  className="h-10 md:h-12 md:text-base"
                />
                <Button
                  size="lg"
                  onClick={handleSendChat}
                  disabled={chatMut.isPending || !chatMsg.trim()}
                  className="h-10 md:h-12 px-4 md:px-6 gap-2"
                >
                  {chatMut.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  <span className="hidden md:inline">Wyślij</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Activity ── */}
      {tab === "activity" && isMember && (
        <div className="px-4 md:px-0">
          {activity.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-14 text-center">
              <ScrollText size={32} className="text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Brak aktywności.</p>
            </div>
          ) : (
            <Card className="rounded-2xl overflow-hidden">
              <div className="animate-list-in divide-y divide-border">
                {activity.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 px-4 md:px-6 py-3 md:py-4">
                    <div className="flex-1 min-w-0 text-sm md:text-base">
                      <span className="font-semibold text-foreground">{log.actor?.username || "System"}</span>{" "}
                      <span className="text-muted-foreground">{ACTION_LABELS[log.action] || log.action}</span>
                      {log.detail?.amount != null && (
                        <span className="text-accent font-semibold"> ({String(log.detail.amount)}g)</span>
                      )}
                      {log.detail?.against != null && (
                        <span className="text-muted-foreground"> vs [{String(log.detail.against)}]</span>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {new Date(log.created_at).toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Requests ── */}
      {tab === "requests" && isOfficer && (
        <div className="px-4 md:px-0">
          {joinRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-14 text-center">
              <Users size={32} className="text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Brak próśb o dołączenie.</p>
            </div>
          ) : (
            <>
              {/* Mobile */}
              <div className="animate-list-in md:hidden space-y-0.5">
                {joinRequests.map((jr) => {
                  const busy =
                    (acceptJrMut.isPending && acceptJrMut.variables === jr.id) ||
                    (declineJrMut.isPending && declineJrMut.variables === jr.id);
                  return (
                    <div key={jr.id} className="flex items-center gap-3 rounded-xl py-3 px-1 hover-lift">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-sm font-bold uppercase text-foreground">
                        {jr.user.username.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{jr.user.username}</p>
                        <p className="text-xs text-muted-foreground">
                          ELO: <span className="text-accent tabular-nums">{jr.user.elo_rating}</span>
                          {jr.message && ` — "${jr.message}"`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            acceptJrMut.mutate(jr.id, {
                              onSuccess: () => toast.success("Przyjęto", { id: "clan-accept-jr" }),
                              onError: (err) =>
                                toast.error(err instanceof APIError ? err.message : "Nie udało się przyjąć", {
                                  id: "clan-accept-jr-error",
                                }),
                            })
                          }
                          className="flex items-center justify-center h-8 w-8 rounded-lg text-green-400 hover:bg-green-400/10 disabled:opacity-40 transition-colors"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            declineJrMut.mutate(jr.id, {
                              onSuccess: () => toast.success("Odrzucono", { id: "clan-decline-jr" }),
                              onError: (err) =>
                                toast.error(err instanceof APIError ? err.message : "Nie udało się odrzucić", {
                                  id: "clan-decline-jr-error",
                                }),
                            })
                          }
                          className="flex items-center justify-center h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Desktop */}
              <Card className="hidden md:block rounded-2xl overflow-hidden">
                <div className="animate-list-in divide-y divide-border">
                  {joinRequests.map((jr) => {
                    const busy =
                      (acceptJrMut.isPending && acceptJrMut.variables === jr.id) ||
                      (declineJrMut.isPending && declineJrMut.variables === jr.id);
                    return (
                      <div key={jr.id} className="flex items-center gap-4 px-6 py-4 hover-lift">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-base font-bold uppercase text-foreground">
                          {jr.user.username.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-base font-semibold text-foreground truncate">{jr.user.username}</p>
                          <p className="text-sm text-muted-foreground">
                            ELO: <span className="text-accent tabular-nums">{jr.user.elo_rating}</span>
                            {jr.message && ` — "${jr.message}"`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              acceptJrMut.mutate(jr.id, {
                                onSuccess: () => toast.success("Przyjęto", { id: "clan-accept-jr" }),
                                onError: (err) =>
                                  toast.error(err instanceof APIError ? err.message : "Nie udało się przyjąć", {
                                    id: "clan-accept-jr-error",
                                  }),
                              })
                            }
                            className="gap-2 text-base text-green-400 hover:text-green-400 hover:bg-green-400/10"
                          >
                            {busy && acceptJrMut.variables === jr.id ? (
                              <Loader2 size={18} className="animate-spin" />
                            ) : (
                              <Check size={18} />
                            )}
                            Przyjmij
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              declineJrMut.mutate(jr.id, {
                                onSuccess: () => toast.success("Odrzucono", { id: "clan-decline-jr" }),
                                onError: (err) =>
                                  toast.error(err instanceof APIError ? err.message : "Nie udało się odrzucić", {
                                    id: "clan-decline-jr-error",
                                  }),
                              })
                            }
                            className="gap-2 text-base text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            {busy && declineJrMut.variables === jr.id ? (
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
        </div>
      )}
    </div>
  );
}
