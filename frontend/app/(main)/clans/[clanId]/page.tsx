"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Calendar,
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
  Shield,
  Star,
  Swords,
  Settings,
  Trash2,
  Trophy,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import {
  useClan,
  useClanMembers,
  useClanWars,
  useClanStats,
  useClanActivityLog,
  useClanChat,
  useLeaveClan,
  useKickMember,
  usePromoteMember,
  useDemoteMember,
  useTransferLeadership,
  useDonateGold,
  useWithdrawGold,
  useJoinClan,
  useSendClanChat,
  useDissolveClan,
  useClanJoinRequests,
  useAcceptJoinRequest,
  useDeclineJoinRequest,
  useMyClan,
  useInvitePlayer,
  useFriends,
  useDeclareWar,
  useAcceptWar,
  useDeclineWar,
  useJoinWar,
  useWarParticipants,
  useClans,
} from "@/hooks/queries";
import type { ClanMembershipOut, ClanWarOut } from "@/lib/api";

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
      <Badge variant="outline" className={`rounded-full border-0 px-2.5 py-0.5 text-xs ${won ? "bg-green-500/15 text-green-400" : "bg-destructive/15 text-destructive"}`}>
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
    <Badge variant="outline" className={`rounded-full border-0 px-2.5 py-0.5 text-xs ${colorMap[status] ?? "bg-muted text-muted-foreground"}`}>
      {WAR_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

function WarParticipants({ warId }: { warId: string }) {
  const { data: participants } = useWarParticipants(warId);
  if (!participants?.length) return <p className="text-xs text-muted-foreground">Brak uczestników</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {participants.map((p) => (
        <span key={p.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-foreground">
          {p.user.username}
        </span>
      ))}
    </div>
  );
}

type WarCardMutations = {
  acceptWarMut: ReturnType<typeof useAcceptWar>;
  declineWarMut: ReturnType<typeof useDeclineWar>;
  joinWarMut: ReturnType<typeof useJoinWar>;
};

function WarCard({
  war, clanId, isMember, isExpanded, onToggle, acceptWarMut, declineWarMut, joinWarMut,
}: { war: ClanWarOut; clanId: string; isMember: boolean; isExpanded: boolean; onToggle: () => void } & WarCardMutations) {
  const isChallenger = war.challenger.id === clanId;
  const opponent = isChallenger ? war.defender : war.challenger;
  const eloChange = isChallenger ? war.challenger_elo_change : war.defender_elo_change;
  const won = war.winner_id === clanId;
  const isDefender = war.defender.id === clanId;
  const isPendingForUs = war.status === "pending" && isDefender;

  return (
    <div className="rounded-2xl border border-border bg-card/50 overflow-hidden">
      {/* Main row */}
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/30 transition-colors">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold text-white" style={{ backgroundColor: opponent.color }}>
          {opponent.tag}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">vs [{opponent.tag}] {opponent.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground">{war.players_per_side}v{war.players_per_side}</span>
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
            <span className={`text-xs font-semibold tabular-nums ${eloChange > 0 ? "text-green-400" : "text-destructive"}`}>
              {eloChange > 0 ? "+" : ""}{eloChange}
            </span>
          )}
          <ChevronRight className={`h-4 w-4 text-muted-foreground/40 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
        </div>
      </button>

      {/* Expanded panel */}
      {isExpanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {/* Participants for accepted/in_progress/finished */}
          {(war.status === "accepted" || war.status === "in_progress" || war.status === "finished") && (
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Uczestnicy</p>
              <WarParticipants warId={war.id} />
            </div>
          )}

          {/* Winner for finished */}
          {war.status === "finished" && war.winner_id && (
            <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2">
              <Trophy className="h-3.5 w-3.5 text-accent shrink-0" />
              <span className="text-xs text-foreground">
                Wygrał: <span className="font-semibold">{war.winner_id === war.challenger.id ? war.challenger.name : war.defender.name}</span>
              </span>
            </div>
          )}

          {/* Action buttons */}
          {isMember && (
            <div className="flex flex-wrap gap-2">
              {isPendingForUs && (
                <>
                  <Button
                    size="sm"
                    className="gap-1.5 text-green-400 hover:text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20"
                    variant="ghost"
                    disabled={acceptWarMut.isPending}
                    onClick={() => acceptWarMut.mutate(war.id, {
                      onSuccess: () => toast.success("Zaakceptowano wojnę"),
                      onError: () => toast.error("Błąd"),
                    })}
                  >
                    {acceptWarMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    Akceptuj
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-destructive hover:text-destructive bg-destructive/10 hover:bg-destructive/20 border border-destructive/20"
                    disabled={declineWarMut.isPending}
                    onClick={() => declineWarMut.mutate(war.id, {
                      onSuccess: () => toast.success("Odrzucono wojnę"),
                      onError: () => toast.error("Błąd"),
                    })}
                  >
                    {declineWarMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                    Odrzuć
                  </Button>
                </>
              )}
              {war.status === "accepted" && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={joinWarMut.isPending}
                  onClick={() => joinWarMut.mutate(war.id, {
                    onSuccess: () => toast.success("Dołączono do wojny!"),
                    onError: () => toast.error("Nie udało się dołączyć"),
                  })}
                >
                  {joinWarMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Swords size={13} />}
                  Dołącz
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ClanDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const clanId = params.clanId as string;

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
  const [expandedWarId, setExpandedWarId] = useState<string | null>(null);

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
  const acceptWarMut = useAcceptWar();
  const declineWarMut = useDeclineWar();
  const joinWarMut = useJoinWar();

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
  const myRank = myM ? ROLE_RANK[myM.role] ?? 0 : 0;
  const isInAnyClan = !!myClanData?.clan;

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
    const amount = parseInt(donateAmount);
    if (!amount || amount < 1) return;
    donateMut.mutate({ clanId, amount }, {
      onSuccess: () => { toast.success(`Wpłacono ${amount} złota`); setDonateAmount(""); },
      onError: () => toast.error("Nie udało się wpłacić"),
    });
  };

  const handleWithdraw = () => {
    const amount = parseInt(withdrawAmount);
    if (!amount || amount < 1) return;
    withdrawMut.mutate({ clanId, amount }, {
      onSuccess: () => { toast.success(`Wypłacono ${amount} złota`); setWithdrawAmount(""); },
      onError: () => toast.error("Nie udało się wypłacić"),
    });
  };

  const handleSendChat = () => {
    if (!chatMsg.trim()) return;
    chatMut.mutate({ clanId, content: chatMsg.trim() }, {
      onSuccess: () => { setChatMsg(""); refetchChat(); },
      onError: () => toast.error("Nie udało się wysłać"),
    });
  };

  const tabs: { key: Tab; label: string; mobileLabel: string; icon: React.ReactNode; show: boolean; count?: number }[] = [
    { key: "members", label: "Członkowie", mobileLabel: "Członkowie", icon: <Users size={14} />, show: true },
    { key: "wars", label: "Wojny", mobileLabel: "Wojny", icon: <Swords size={14} />, show: true },
    { key: "chat", label: "Czat", mobileLabel: "Czat", icon: <MessageSquare size={14} />, show: isMember },
    { key: "activity", label: "Aktywność", mobileLabel: "Log", icon: <ScrollText size={14} />, show: isMember },
    { key: "requests", label: "Prośby", mobileLabel: "Prośby", icon: <Users size={14} />, show: isOfficer, count: joinRequests.length },
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
            <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">KLAN</p>
            <h1 className="font-display text-2xl md:text-5xl text-foreground">{clan.name}</h1>
            <div className="flex items-center gap-2 md:gap-3 mt-0.5 md:mt-1 text-xs md:text-sm text-muted-foreground">
              <span>Lv. {clan.level}</span>
              <span>&middot;</span>
              <span className="flex items-center gap-1"><Trophy className="h-3.5 w-3.5" />{clan.elo_rating} ELO</span>
              <span>&middot;</span>
              <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{clan.member_count}/{clan.max_members}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-1.5 md:gap-2 shrink-0 pt-1">
          {!isMember && clan.is_recruiting && (
            isInAnyClan ? (
              <span className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">
                Musisz opuścić obecny klan
              </span>
            ) : (
              <Button
                size="sm"
                disabled={joinMut.isPending}
                className="gap-1.5 md:h-10 md:px-5 md:text-base"
                onClick={() => joinMut.mutate({ clanId }, {
                  onSuccess: (res) => {
                    if (res.joined) { toast.success("Dołączono!"); router.refresh(); }
                    else toast.success(res.message || "Wysłano prośbę");
                  },
                  onError: () => toast.error("Nie udało się dołączyć"),
                })}
              >
                {joinMut.isPending && <Loader2 size={14} className="animate-spin" />}
                {clan.is_public ? "Dołącz" : "Poproś"}
              </Button>
            )
          )}
          {isOfficer && (
            <>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => setShowInvitePanel((v) => !v)}
              >
                <UserPlus size={16} />
                <span className="hidden md:inline">Zaproś</span>
                {invitableFriends.length > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-foreground/20 text-[10px] font-bold tabular-nums">
                    {invitableFriends.length}
                  </span>
                )}
              </Button>
              <Link href={`/clans/${clanId}/settings`}>
                <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted">
                  <Settings size={16} />
                  <span className="hidden md:inline">Ustawienia</span>
                </Button>
              </Link>
            </>
          )}
          {isMember && !isLeader && (
            <Button
              size="sm"
              variant="ghost"
              disabled={leaveMut.isPending}
              className="gap-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={() => leaveMut.mutate(clanId, {
                onSuccess: () => { toast.success("Opuszczono klan"); router.push("/clans"); },
                onError: () => toast.error("Błąd"),
              })}
            >
              <LogOut size={16} />
              <span className="hidden md:inline">Opuść</span>
            </Button>
          )}
          {isLeader && (
            <Button
              size="sm"
              variant="ghost"
              disabled={dissolveMut.isPending}
              className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => {
                if (confirm("Na pewno chcesz rozwiązać klan?")) {
                  dissolveMut.mutate(clanId, {
                    onSuccess: () => { toast.success("Klan rozwiązany"); router.push("/clans"); },
                    onError: () => toast.error("Błąd"),
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
        const xpForLevel = (l: number) => l * l * 150;
        const xpCurrent = xpForLevel(lvl);
        const xpNext = xpForLevel(lvl + 1);
        const xpInLevel = xp - xpCurrent;
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
                  <span className="text-[10px] text-muted-foreground tabular-nums">{xpInLevel.toLocaleString()} / {xpNeeded.toLocaleString()} XP</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400 transition-all duration-700" style={{ width: `${pct}%` }} />
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
              <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">Zaproś znajomych</p>
              <p className="text-xs text-muted-foreground mt-0.5">{invitableFriends.length} znajomych bez klanu</p>
            </div>
          </div>
          {invitableFriends.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-6 text-center">
              <UserPlus size={24} className="text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Brak znajomych do zaproszenia. Znajomi muszą być bez klanu.</p>
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
                      <p className="text-xs md:text-sm text-muted-foreground">ELO: <span className="text-accent tabular-nums">{friend.elo_rating}</span></p>
                    </div>
                    <Button
                      size="sm"
                      disabled={isPending}
                      className="shrink-0 gap-1.5"
                      onClick={() => inviteMut.mutate(
                        { clanId, userId: friend.id },
                        {
                          onSuccess: () => toast.success(`Zaproszono ${friend.username}`),
                          onError: () => toast.error("Nie udało się zaprosić"),
                        }
                      )}
                    >
                      {isPending ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
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
            <span className="text-muted-foreground">Wojny: <span className="text-foreground font-semibold tabular-nums">{stats.wars_total}</span></span>
            <span className="text-muted-foreground">W: <span className="text-green-400 font-semibold tabular-nums">{stats.wars_won}</span></span>
            <span className="text-muted-foreground">L: <span className="text-destructive font-semibold tabular-nums">{stats.wars_lost}</span></span>
            <span className="text-muted-foreground">WR: <span className="text-accent font-semibold tabular-nums">{(stats.war_win_rate * 100).toFixed(0)}%</span></span>
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
                  <div className={`font-display text-2xl font-bold tabular-nums ${s.color || "text-foreground"}`}>{s.value}</div>
                  <div className="text-sm text-muted-foreground">{s.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── Treasury Vault (Revolut-style) ── */}
      {isMember && (() => {
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
              <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium mb-1">Skarbiec klanu</p>
              <p className="font-display text-4xl md:text-5xl tabular-nums text-accent">{clan.treasury_gold.toLocaleString()}</p>
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
                        <div
                          className="absolute inset-y-0 left-0 bg-accent/[0.04]"
                          style={{ width: `${pct}%` }}
                        />
                        <div className="relative flex items-center gap-3 flex-1 min-w-0">
                          {medal ? (
                            <span className="text-lg w-7 text-center shrink-0">{medal}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground/50 w-7 text-center tabular-nums shrink-0">{idx + 1}</span>
                          )}
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-sm font-bold uppercase text-foreground">
                            {m.user.username.charAt(0)}
                          </div>
                          <p className="text-sm font-medium text-foreground truncate">{m.user.username}</p>
                        </div>
                        <div className="relative flex items-center gap-2 shrink-0">
                          <span className="font-mono text-sm tabular-nums text-accent font-semibold">{m.contributions_gold.toLocaleString()}</span>
                          <span className="text-[10px] text-muted-foreground/60 tabular-nums w-10 text-right">{pct.toFixed(0)}%</span>
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
            {tabs.filter((t) => t.show).map((t) => (
              <button
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
                {(t.count ?? 0) > 0 && <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 py-0 text-[10px] font-semibold text-primary">{t.count}</span>}
              </button>
            ))}
          </div>
        </div>
        {/* Desktop */}
        <div className="hidden md:flex gap-1.5">
          {tabs.filter((t) => t.show).map((t) => (
            <button
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
              {(t.count ?? 0) > 0 && <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0.5 text-sm text-primary">{t.count}</span>}
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
                <button onClick={() => router.push(`/profile/${m.user.id}`)} className="flex flex-1 min-w-0 items-center gap-3 text-left active:opacity-70 transition-opacity">
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
                    <p className="text-xs text-muted-foreground">ELO: <span className="text-accent tabular-nums text-sm">{m.user.elo_rating}</span></p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                </button>
                {isMember && canManage(m) && m.user.id !== user?.id && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    {m.role !== "officer" && m.role !== "leader" && (
                      <button onClick={() => promoteMut.mutate({ clanId, userId: m.user.id }, { onSuccess: () => toast.success("Awansowano"), onError: () => toast.error("Błąd") })} disabled={promoteMut.isPending} className="flex items-center justify-center h-8 w-8 rounded-lg text-green-400 hover:bg-green-400/10 disabled:opacity-40 transition-colors" title="Awansuj"><ArrowUp size={14} /></button>
                    )}
                    {m.role !== "recruit" && m.role !== "leader" && (
                      <button onClick={() => demoteMut.mutate({ clanId, userId: m.user.id }, { onSuccess: () => toast.success("Zdegradowano"), onError: () => toast.error("Błąd") })} disabled={demoteMut.isPending} className="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors" title="Degraduj"><ArrowDown size={14} /></button>
                    )}
                    <button onClick={() => kickMut.mutate({ clanId, userId: m.user.id }, { onSuccess: () => toast.success("Wyrzucono"), onError: () => toast.error("Błąd") })} disabled={kickMut.isPending} className="flex items-center justify-center h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors" title="Wyrzuć"><UserMinus size={14} /></button>
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
                  <TableHead className="h-14 text-sm font-semibold text-center"><div className="flex items-center gap-1 justify-center"><Trophy className="h-3.5 w-3.5 text-accent" />ELO</div></TableHead>
                  <TableHead className="h-14 text-sm font-semibold text-center"><div className="flex items-center gap-1 justify-center"><Coins className="h-3.5 w-3.5" />Wpłaty</div></TableHead>
                  {isMember && <TableHead className="h-14 pr-6 text-sm font-semibold text-right">Akcja</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody className="animate-list-in">
                {members.map((m) => (
                  <TableRow key={m.id} className="hover:bg-muted/50 hover-lift">
                    <TableCell className="pl-6 py-3.5">
                      <Link href={`/profile/${m.user.id}`} className="flex items-center gap-3 group">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-base font-bold uppercase text-foreground">{m.user.username.charAt(0)}</div>
                        <div className="flex items-center gap-1.5">
                          {ROLE_ICON[m.role]}
                          <span className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">{m.user.username}</span>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="py-3.5 text-center">
                      <Badge variant="outline" className={`rounded-full border-0 px-3 py-1 text-sm ${
                        m.role === "leader" ? "bg-[#FFD700]/15 text-[#FFD700]" :
                        m.role === "officer" ? "bg-blue-400/15 text-blue-400" :
                        "bg-muted text-muted-foreground"
                      } hover:bg-transparent`}>
                        {ROLE_LABELS[m.role]}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3.5 text-center"><span className="font-display text-xl tabular-nums text-accent">{m.user.elo_rating}</span></TableCell>
                    <TableCell className="py-3.5 text-center"><span className="text-base tabular-nums text-foreground">{m.contributions_gold}g</span></TableCell>
                    {isMember && (
                      <TableCell className="py-3.5 pr-6 text-right">
                        {canManage(m) && m.user.id !== user?.id && (
                          <div className="flex items-center justify-end gap-1">
                            {m.role !== "officer" && m.role !== "leader" && (
                              <Button variant="ghost" size="sm" onClick={() => promoteMut.mutate({ clanId, userId: m.user.id }, { onSuccess: () => toast.success("Awansowano"), onError: () => toast.error("Błąd") })} disabled={promoteMut.isPending} className="text-green-400 hover:text-green-400 hover:bg-green-400/10"><ArrowUp size={16} /></Button>
                            )}
                            {m.role !== "recruit" && m.role !== "leader" && (
                              <Button variant="ghost" size="sm" onClick={() => demoteMut.mutate({ clanId, userId: m.user.id }, { onSuccess: () => toast.success("Zdegradowano"), onError: () => toast.error("Błąd") })} disabled={demoteMut.isPending}><ArrowDown size={16} /></Button>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => kickMut.mutate({ clanId, userId: m.user.id }, { onSuccess: () => toast.success("Wyrzucono"), onError: () => toast.error("Błąd") })} disabled={kickMut.isPending} className="text-destructive hover:text-destructive hover:bg-destructive/10"><UserMinus size={16} /></Button>
                            {isLeader && (
                              <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Przekazać lidera do ${m.user.username}?`)) transferMut.mutate({ clanId, userId: m.user.id }, { onSuccess: () => toast.success("Lider przekazany"), onError: () => toast.error("Błąd") }); }} className="text-[#FFD700] hover:text-[#FFD700] hover:bg-[#FFD700]/10"><Crown size={16} /></Button>
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
          {isOfficer && (
            <>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant={showDeclareWar ? "outline" : "default"}
                  className="gap-1.5"
                  onClick={() => setShowDeclareWar((v) => !v)}
                >
                  <Swords size={14} />
                  {showDeclareWar ? "Anuluj" : "Wypowiedz wojnę"}
                </Button>
              </div>

              {showDeclareWar && (
                <section className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 md:p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10">
                      <Swords className="h-4 w-4 text-destructive" />
                    </div>
                    <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">Wypowiedz wojnę</p>
                  </div>

                  <div className="space-y-3">
                    {/* Target clan search */}
                    <div className="relative">
                      <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
                        <Search className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <Input
                        placeholder="Szukaj klanu przeciwnika..."
                        value={warTargetId ? warTargetName : warTargetSearch}
                        onChange={(e) => {
                          setWarTargetId("");
                          setWarTargetName("");
                          setWarTargetSearch(e.target.value);
                        }}
                        className="pl-9 h-10"
                      />
                      {!warTargetId && warTargetSearch.length >= 2 && (
                        <div className="absolute z-10 mt-1 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                          {(clanSearchData?.items ?? []).filter((c) => c.id !== clanId).length === 0 ? (
                            <div className="px-4 py-3 text-sm text-muted-foreground text-center">Brak wyników</div>
                          ) : (
                            (clanSearchData?.items ?? []).filter((c) => c.id !== clanId).map((c) => (
                              <button
                                key={c.id}
                                onClick={() => { setWarTargetId(c.id); setWarTargetName(`[${c.tag}] ${c.name}`); setWarTargetSearch(""); }}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted transition-colors"
                              >
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-display text-[10px] font-bold text-white" style={{ backgroundColor: c.color }}>{c.tag}</div>
                                <div>
                                  <p className="text-sm font-semibold text-foreground">{c.name}</p>
                                  <p className="text-[10px] text-muted-foreground">{c.member_count} czł. · {c.elo_rating} ELO</p>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    {warTargetId && (
                      <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                        <Swords className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="text-sm text-foreground font-medium">{warTargetName}</span>
                        <button onClick={() => { setWarTargetId(""); setWarTargetName(""); }} className="ml-auto text-muted-foreground hover:text-foreground">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Stawka (złoto, min. 100)</label>
                        <Input
                          type="number"
                          min={100}
                          value={warWager}
                          onChange={(e) => setWarWager(e.target.value)}
                          className="h-10"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Graczy na stronę (1–5)</label>
                        <Input
                          type="number"
                          min={1}
                          max={5}
                          value={warPlayers}
                          onChange={(e) => setWarPlayers(e.target.value)}
                          className="h-10"
                        />
                      </div>
                    </div>

                    <Button
                      className="w-full gap-2"
                      disabled={!warTargetId || declareWarMut.isPending}
                      onClick={() => {
                        const wager = parseInt(warWager);
                        const players = parseInt(warPlayers);
                        if (!warTargetId || isNaN(wager) || wager < 100 || isNaN(players) || players < 1 || players > 5) return;
                        declareWarMut.mutate(
                          { clanId, targetId: warTargetId, data: { wager_gold: wager, players_per_side: players } },
                          {
                            onSuccess: () => {
                              toast.success("Wypowiedziano wojnę!");
                              setShowDeclareWar(false);
                              setWarTargetId(""); setWarTargetName(""); setWarTargetSearch(""); setWarWager("100"); setWarPlayers("3");
                            },
                            onError: () => toast.error("Nie udało się wypowiedzieć wojny"),
                          }
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
                <WarCard
                  key={war.id}
                  war={war}
                  clanId={clanId}
                  isMember={isMember}
                  isExpanded={expandedWarId === war.id}
                  onToggle={() => setExpandedWarId((id) => id === war.id ? null : war.id)}
                  acceptWarMut={acceptWarMut}
                  declineWarMut={declineWarMut}
                  joinWarMut={joinWarMut}
                />
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
                <Button size="lg" onClick={handleSendChat} disabled={chatMut.isPending || !chatMsg.trim()} className="h-10 md:h-12 px-4 md:px-6 gap-2">
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
                      <span className="text-muted-foreground">
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
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
                  const busy = (acceptJrMut.isPending && acceptJrMut.variables === jr.id) || (declineJrMut.isPending && declineJrMut.variables === jr.id);
                  return (
                    <div key={jr.id} className="flex items-center gap-3 rounded-xl py-3 px-1 hover-lift">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-sm font-bold uppercase text-foreground">{jr.user.username.charAt(0)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{jr.user.username}</p>
                        <p className="text-xs text-muted-foreground">ELO: <span className="text-accent tabular-nums">{jr.user.elo_rating}</span>{jr.message && ` — "${jr.message}"`}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button disabled={busy} onClick={() => acceptJrMut.mutate(jr.id, { onSuccess: () => toast.success("Przyjęto"), onError: () => toast.error("Błąd") })} className="flex items-center justify-center h-8 w-8 rounded-lg text-green-400 hover:bg-green-400/10 disabled:opacity-40 transition-colors"><Check size={14} /></button>
                        <button disabled={busy} onClick={() => declineJrMut.mutate(jr.id, { onSuccess: () => toast.success("Odrzucono"), onError: () => toast.error("Błąd") })} className="flex items-center justify-center h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"><X size={14} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Desktop */}
              <Card className="hidden md:block rounded-2xl overflow-hidden">
                <div className="animate-list-in divide-y divide-border">
                  {joinRequests.map((jr) => {
                    const busy = (acceptJrMut.isPending && acceptJrMut.variables === jr.id) || (declineJrMut.isPending && declineJrMut.variables === jr.id);
                    return (
                      <div key={jr.id} className="flex items-center gap-4 px-6 py-4 hover-lift">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-base font-bold uppercase text-foreground">{jr.user.username.charAt(0)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-base font-semibold text-foreground truncate">{jr.user.username}</p>
                          <p className="text-sm text-muted-foreground">ELO: <span className="text-accent tabular-nums">{jr.user.elo_rating}</span>{jr.message && ` — "${jr.message}"`}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button variant="ghost" disabled={busy} onClick={() => acceptJrMut.mutate(jr.id, { onSuccess: () => toast.success("Przyjęto"), onError: () => toast.error("Błąd") })} className="gap-2 text-base text-green-400 hover:text-green-400 hover:bg-green-400/10">
                            {busy && acceptJrMut.variables === jr.id ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                            Przyjmij
                          </Button>
                          <Button variant="ghost" disabled={busy} onClick={() => declineJrMut.mutate(jr.id, { onSuccess: () => toast.success("Odrzucono"), onError: () => toast.error("Błąd") })} className="gap-2 text-base text-destructive hover:text-destructive hover:bg-destructive/10">
                            {busy && declineJrMut.variables === jr.id ? <Loader2 size={18} className="animate-spin" /> : <X size={18} />}
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
