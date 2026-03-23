"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Coins,
  Crown,
  Loader2,
  LogOut,
  MessageSquare,
  ScrollText,
  Send,
  Shield,
  Swords,
  Settings,
  Trash2,
  Trophy,
  UserMinus,
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
} from "@/hooks/queries";
import type { ClanMembershipOut } from "@/lib/api";

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

export default function ClanDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const clanId = params.clanId as string;

  const [tab, setTab] = useState<Tab>("members");
  const [donateAmount, setDonateAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [chatMsg, setChatMsg] = useState("");

  const { data: clan, isLoading } = useClan(clanId);
  const { data: membersData } = useClanMembers(clanId, 100);
  const { data: warsData } = useClanWars(clanId, 20);
  const { data: stats } = useClanStats(clanId);
  const { data: activityData } = useClanActivityLog(clanId, 50);
  const { data: chatData, refetch: refetchChat } = useClanChat(clanId, 50);
  const { data: joinReqData } = useClanJoinRequests(clanId, 50);

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
          )}
          {isOfficer && (
            <Link href={`/clans/${clanId}/settings`}>
              <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted">
                <Settings size={16} />
                <span className="hidden md:inline">Ustawienia</span>
              </Button>
            </Link>
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

      {/* Description */}
      {clan.description && (
        <div className="px-4 md:px-0">
          <p className="text-sm md:text-base text-muted-foreground">{clan.description}</p>
        </div>
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

      {/* ── Treasury (members) ── */}
      {isMember && (
        <div className="px-4 md:px-0">
          {/* Mobile */}
          <div className="md:hidden">
            <div className="flex items-center gap-2.5 mb-2">
              <Coins className="h-5 w-5 text-accent" />
              <span className="font-display text-xl tabular-nums text-accent">{clan.treasury_gold}</span>
              <span className="text-xs text-muted-foreground">złota w skarbcu</span>
              {clan.tax_percent > 0 && <span className="ml-auto text-[10px] text-muted-foreground">Podatek {clan.tax_percent}%</span>}
            </div>
            <div className="flex gap-2">
              <Input type="number" placeholder="Kwota" value={donateAmount} onChange={(e) => setDonateAmount(e.target.value)} className="w-24 h-9 text-sm" min={1} />
              <button onClick={handleDonate} disabled={donateMut.isPending} className="shrink-0 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors active:scale-[0.97]">Wpłać</button>
              {isOfficer && (
                <>
                  <Input type="number" placeholder="Kwota" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-24 h-9 text-sm" min={1} />
                  <button onClick={handleWithdraw} disabled={withdrawMut.isPending} className="shrink-0 rounded-xl border border-border bg-secondary/60 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition-colors active:scale-[0.97]">Wypłać</button>
                </>
              )}
            </div>
          </div>
          {/* Desktop */}
          <Card className="hidden md:block rounded-2xl">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Coins className="h-6 w-6 text-accent" />
                  <span className="font-mono tabular-nums text-2xl font-semibold text-accent">{clan.treasury_gold}</span>
                  <span className="text-base text-muted-foreground">złota</span>
                </div>
                {clan.tax_percent > 0 && <span className="text-base text-muted-foreground">Podatek: {clan.tax_percent}%</span>}
              </div>
              <div className="flex gap-3">
                <Input type="number" placeholder="Kwota" value={donateAmount} onChange={(e) => setDonateAmount(e.target.value)} className="w-32 h-12 text-base" min={1} />
                <Button size="lg" onClick={handleDonate} disabled={donateMut.isPending} className="h-12 px-6 text-base gap-2">
                  {donateMut.isPending && <Loader2 size={18} className="animate-spin" />}
                  Wpłać
                </Button>
                {isOfficer && (
                  <>
                    <Input type="number" placeholder="Kwota" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-32 h-12 text-base" min={1} />
                    <Button size="lg" variant="outline" onClick={handleWithdraw} disabled={withdrawMut.isPending} className="h-12 px-6 text-base gap-2">
                      {withdrawMut.isPending && <Loader2 size={18} className="animate-spin" />}
                      Wypłać
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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
        </div>
      )}

      {/* ── Wars ── */}
      {tab === "wars" && (
        <div className="px-4 md:px-0">
          {wars.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-14 text-center">
              <Swords size={32} className="text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Brak wojen.</p>
            </div>
          ) : (
            <>
              <div className="animate-list-in md:hidden space-y-0.5">
                {wars.map((war) => {
                  const isChallenger = war.challenger.id === clanId;
                  const opponent = isChallenger ? war.defender : war.challenger;
                  const eloChange = isChallenger ? war.challenger_elo_change : war.defender_elo_change;
                  const won = war.winner_id === clanId;
                  return (
                    <div key={war.id} className="flex items-center gap-3 rounded-xl py-3 px-1 hover-lift">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-display text-[9px] font-bold text-white" style={{ backgroundColor: opponent.color }}>{opponent.tag}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">vs [{opponent.tag}] {opponent.name}</p>
                        <span className="text-xs text-muted-foreground">{war.players_per_side}v{war.players_per_side}</span>
                      </div>
                      {war.status === "finished" ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant="outline" className={`rounded-full border-0 px-2 py-px text-[10px] ${won ? "bg-green-500/15 text-green-400" : "bg-destructive/15 text-destructive"}`}>{won ? "W" : "L"}</Badge>
                          {eloChange !== 0 && <span className={`text-xs font-semibold tabular-nums ${eloChange > 0 ? "text-green-400" : "text-destructive"}`}>{eloChange > 0 ? "+" : ""}{eloChange}</span>}
                        </div>
                      ) : (
                        <Badge variant="outline" className="shrink-0 rounded-full border-0 px-2 py-px text-[10px] bg-muted text-muted-foreground">{war.status === "pending" ? "Oczekuje" : war.status === "accepted" ? "Zaakceptowana" : war.status === "in_progress" ? "W trakcie" : war.status}</Badge>
                      )}
                    </div>
                  );
                })}
              </div>
              <Card className="hidden md:block rounded-2xl overflow-hidden">
                <Table className="text-base">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-14 pl-6 text-sm font-semibold">Przeciwnik</TableHead>
                      <TableHead className="h-14 text-sm font-semibold text-center">Format</TableHead>
                      <TableHead className="h-14 text-sm font-semibold text-center">Status</TableHead>
                      <TableHead className="h-14 pr-6 text-sm font-semibold text-right">ELO</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="animate-list-in">
                    {wars.map((war) => {
                      const isChallenger = war.challenger.id === clanId;
                      const opponent = isChallenger ? war.defender : war.challenger;
                      const eloChange = isChallenger ? war.challenger_elo_change : war.defender_elo_change;
                      const won = war.winner_id === clanId;
                      return (
                        <TableRow key={war.id} className="hover:bg-muted/50 hover-lift">
                          <TableCell className="pl-6 py-3.5">
                            <Link href={`/clans/${opponent.id}`} className="flex items-center gap-3 group">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold text-white" style={{ backgroundColor: opponent.color }}>{opponent.tag}</div>
                              <span className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">[{opponent.tag}] {opponent.name}</span>
                            </Link>
                          </TableCell>
                          <TableCell className="py-3.5 text-center text-base text-foreground">{war.players_per_side}v{war.players_per_side}</TableCell>
                          <TableCell className="py-3.5 text-center">
                            {war.status === "finished" ? (
                              <Badge variant="outline" className={`rounded-full border-0 px-3 py-1 text-sm ${won ? "bg-green-500/15 text-green-400 hover:bg-green-500/15" : "bg-destructive/15 text-destructive hover:bg-destructive/15"}`}>{won ? "Wygrana" : "Przegrana"}</Badge>
                            ) : (
                              <Badge variant="outline" className="rounded-full border-0 px-3 py-1 text-sm bg-muted text-muted-foreground hover:bg-muted">{war.status === "pending" ? "Oczekuje" : war.status === "accepted" ? "Zaakceptowana" : war.status === "in_progress" ? "W trakcie" : war.status}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="py-3.5 pr-6 text-right">
                            {war.status === "finished" && eloChange !== 0 && (
                              <span className={`font-display text-xl tabular-nums ${eloChange > 0 ? "text-green-400" : "text-destructive"}`}>{eloChange > 0 ? "+" : ""}{eloChange}</span>
                            )}
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
