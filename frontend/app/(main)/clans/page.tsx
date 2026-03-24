"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  Crown,
  Loader2,
  Medal,
  Plus,
  Search,
  Shield,
  Swords,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import {
  useClans,
  useMyClan,
  useMyInvitations,
  useAcceptInvitation,
  useDeclineInvitation,
  useClanLeaderboard,
} from "@/hooks/queries";
import { APIError } from "@/lib/api";

const ROLE_LABELS: Record<string, string> = {
  leader: "Lider",
  officer: "Oficer",
  member: "Członek",
  recruit: "Rekrut",
};

type Tab = "browse" | "invitations" | "leaderboard";

export default function ClansPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("browse");

  const { data: myClanData, isLoading: myLoading } = useMyClan();
  const { data: clansData, isLoading: clansLoading } = useClans(search, 50, 0);
  const { data: invData, isLoading: invLoading } = useMyInvitations();
  const { data: leaderboardData, isLoading: lbLoading } = useClanLeaderboard("elo", 50, 0);

  const acceptMut = useAcceptInvitation();
  const declineMut = useDeclineInvitation();

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  if (authLoading || myLoading) {
    return (
      <div className="animate-page-in space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
        <div className="px-4 md:px-0">
          <Skeleton className="h-6 w-24 mb-2" />
          <Skeleton className="h-10 w-48" />
        </div>
        <div className="px-4 md:px-0 space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const myClan = myClanData?.clan;
  const myMembership = myClanData?.membership;
  const clans = clansData?.items ?? [];
  const invitations = invData?.items ?? [];
  const leaderboard = leaderboardData?.items ?? [];
  const actionPending = acceptMut.isPending || declineMut.isPending;

  return (
    <div className="animate-page-in space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 px-4 md:px-0">
        <div>
          <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">SPOŁECZNOŚĆ</p>
          <h1 className="font-display text-2xl md:text-5xl text-foreground">Klany</h1>
          <p className="hidden md:block mt-1 text-sm text-muted-foreground">
            Dołącz do klanu lub utwórz własny.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {clans.length > 0 && (
            <Badge variant="outline" className="hidden md:inline-flex text-sm px-3 py-1.5 text-foreground">
              <Swords size={14} className="mr-1.5" />
              {clansData?.count ?? 0}
            </Badge>
          )}
          {!myClan && (
            <Link href="/clans/create">
              <Button size="sm" className="gap-1.5 md:h-10 md:px-5 md:text-base">
                <Plus size={16} />
                <span className="hidden md:inline">Utwórz klan</span>
                <span className="md:hidden">Utwórz</span>
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* ── My Clan Banner ── */}
      {myClan && myMembership && (
        <div className="px-4 md:px-0">
          <button
            onClick={() => router.push(`/clans/${myClan.id}`)}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-primary/20 md:border-primary/25 bg-primary/5 p-3.5 md:p-5 text-left transition-all hover-lift active:bg-primary/10"
          >
            <div className="flex items-center gap-3 md:gap-4">
              <div
                className="flex h-11 w-11 md:h-14 md:w-14 shrink-0 items-center justify-center rounded-xl font-display text-sm md:text-lg font-bold text-white"
                style={{ backgroundColor: myClan.color }}
              >
                {myClan.tag}
              </div>
              <div>
                <p className="text-base md:text-lg font-semibold text-foreground">{myClan.name}</p>
                <p className="text-xs md:text-sm text-muted-foreground">
                  {ROLE_LABELS[myMembership.role] || myMembership.role} &middot; {myClan.member_count}/{myClan.max_members} członków
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-display text-lg md:text-xl tabular-nums text-primary">{myClan.elo_rating}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
            </div>
          </button>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="px-4 md:px-0">
        {/* Mobile: horizontal scroll pills */}
        <div className="md:hidden overflow-x-auto pb-1 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
          <div className="inline-flex w-auto gap-1">
            {([
              { key: "browse" as Tab, label: "Przeglądaj", icon: <Search size={14} /> },
              { key: "invitations" as Tab, label: `Zaproszenia${invitations.length > 0 ? ` (${invitations.length})` : ""}`, icon: <Users size={14} /> },
              { key: "leaderboard" as Tab, label: "Ranking", icon: <Trophy size={14} /> },
            ]).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`shrink-0 gap-1.5 flex items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  tab === t.key
                    ? "border-primary/25 bg-primary/10 text-primary"
                    : "border-border bg-secondary/60 text-muted-foreground"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Desktop: larger pills */}
        <div className="hidden md:flex gap-1.5">
          {([
            { key: "browse" as Tab, label: "Przeglądaj", icon: <Search size={15} /> },
            { key: "invitations" as Tab, label: "Zaproszenia", count: invitations.length, icon: <Users size={15} /> },
            { key: "leaderboard" as Tab, label: "Ranking", icon: <Trophy size={15} /> },
          ]).map((t) => (
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
              {t.count !== undefined && t.count > 0 && (
                <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0.5 text-sm text-primary">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Browse ── */}
      {tab === "browse" && (
        <div className="px-4 md:px-0 space-y-3 md:space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 md:h-5 md:w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Szukaj klanu..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 md:pl-10 h-10 md:h-12 text-sm md:text-base rounded-full md:rounded-lg"
            />
          </div>

          {clansLoading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-16 md:h-20 animate-pulse rounded-xl border border-border/30 bg-muted/20" />
              ))}
            </div>
          ) : clans.length === 0 ? (
            <EmptyState
              icon={<Swords size={32} className="text-muted-foreground/40" />}
              message={search ? "Nie znaleziono klanów." : "Brak klanów."}
            />
          ) : (
            <>
              {/* Mobile: clean list */}
              <div className="animate-list-in md:hidden space-y-0.5">
                {clans.map((clan) => (
                  <button
                    key={clan.id}
                    onClick={() => router.push(`/clans/${clan.id}`)}
                    className="flex w-full items-center gap-3 rounded-xl py-3 px-1 text-left transition-all active:bg-muted/50 hover-lift"
                  >
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-display text-[10px] font-bold text-white"
                      style={{ backgroundColor: clan.color }}
                    >
                      {clan.tag}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{clan.name}</p>
                      <span className="text-xs text-muted-foreground">
                        Lv.{clan.level} &middot; {clan.member_count}/{clan.max_members} &middot; {clan.elo_rating} ELO
                      </span>
                    </div>
                    {!clan.is_recruiting && (
                      <Badge variant="outline" className="shrink-0 rounded-full px-2 py-px text-[10px] border-0 bg-destructive/15 text-destructive">Zamknięty</Badge>
                    )}
                    <span className="font-display text-lg tabular-nums text-accent shrink-0">{clan.elo_rating}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                  </button>
                ))}
              </div>

              {/* Desktop: table in card */}
              <Card className="hidden md:block rounded-2xl overflow-hidden">
                <Table className="text-base">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-14 pl-6 text-sm font-semibold">Klan</TableHead>
                      <TableHead className="h-14 text-sm font-semibold text-center">
                        <div className="flex items-center gap-1 justify-center"><Users className="h-3.5 w-3.5" />Członkowie</div>
                      </TableHead>
                      <TableHead className="h-14 text-sm font-semibold text-center">Poziom</TableHead>
                      <TableHead className="h-14 text-sm font-semibold text-center">Status</TableHead>
                      <TableHead className="h-14 pr-6 text-sm font-semibold text-right">
                        <div className="flex items-center gap-1 justify-end"><Trophy className="h-3.5 w-3.5 text-accent" />ELO</div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="animate-list-in">
                    {clans.map((clan) => (
                      <TableRow
                        key={clan.id}
                        onClick={() => router.push(`/clans/${clan.id}`)}
                        className="cursor-pointer hover:bg-muted/50 hover-lift"
                      >
                        <TableCell className="pl-6 py-3.5">
                          <div className="flex items-center gap-3">
                            <div
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold text-white"
                              style={{ backgroundColor: clan.color }}
                            >
                              {clan.tag}
                            </div>
                            <div>
                              <p className="text-base font-semibold text-foreground">{clan.name}</p>
                              {clan.description && (
                                <p className="text-sm text-muted-foreground truncate max-w-xs">{clan.description}</p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-3.5 text-center">
                          <span className="text-base tabular-nums text-foreground">{clan.member_count}/{clan.max_members}</span>
                        </TableCell>
                        <TableCell className="py-3.5 text-center">
                          <span className="text-base tabular-nums text-foreground">{clan.level}</span>
                        </TableCell>
                        <TableCell className="py-3.5 text-center">
                          {clan.is_public ? (
                            <Badge variant="outline" className="rounded-full border-0 px-3 py-1 text-sm bg-green-500/15 text-green-400 hover:bg-green-500/15">Publiczny</Badge>
                          ) : (
                            <Badge variant="outline" className="rounded-full border-0 px-3 py-1 text-sm bg-muted text-muted-foreground hover:bg-muted">Prywatny</Badge>
                          )}
                        </TableCell>
                        <TableCell className="py-3.5 pr-6 text-right">
                          <span className="font-display text-xl tabular-nums text-accent">{clan.elo_rating}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ── Invitations ── */}
      {tab === "invitations" && (
        <div className="px-4 md:px-0">
          {invLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : invitations.length === 0 ? (
            <EmptyState
              icon={<Users size={32} className="text-muted-foreground/40" />}
              message="Brak oczekujących zaproszeń."
            />
          ) : (
            <>
              {/* Mobile */}
              <div className="animate-list-in md:hidden space-y-0.5">
                {invitations.map((inv) => {
                  const busy = (acceptMut.isPending && acceptMut.variables === inv.id) ||
                    (declineMut.isPending && declineMut.variables === inv.id);
                  return (
                    <div key={inv.id} className="flex items-center gap-3 rounded-xl py-3 px-1 hover-lift">
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-display text-[10px] font-bold text-white"
                        style={{ backgroundColor: inv.clan.color }}
                      >
                        {inv.clan.tag}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">[{inv.clan.tag}] {inv.clan.name}</p>
                        <p className="text-xs text-muted-foreground">od {inv.invited_by.username}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          disabled={actionPending}
                          onClick={() => acceptMut.mutate(inv.id, {
                            onSuccess: () => toast.success("Dołączono do klanu!", { id: "clan-accept-invite" }),
                            onError: (err) => toast.error(err instanceof APIError ? err.message : "Nie udało się dołączyć", { id: "clan-accept-invite-error" }),
                          })}
                          className="flex items-center justify-center h-8 w-8 rounded-lg text-green-400 hover:bg-green-400/10 disabled:opacity-40 transition-colors"
                        >
                          {busy && acceptMut.variables === inv.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        </button>
                        <button
                          disabled={actionPending}
                          onClick={() => declineMut.mutate(inv.id, {
                            onSuccess: () => toast.success("Odrzucono zaproszenie", { id: "clan-decline-invite" }),
                            onError: (err) => toast.error(err instanceof APIError ? err.message : "Nie udało się odrzucić", { id: "clan-decline-invite-error" }),
                          })}
                          className="flex items-center justify-center h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"
                        >
                          {busy && declineMut.variables === inv.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop */}
              <Card className="hidden md:block rounded-2xl overflow-hidden">
                <div className="animate-list-in divide-y divide-border">
                  {invitations.map((inv) => {
                    const busy = (acceptMut.isPending && acceptMut.variables === inv.id) ||
                      (declineMut.isPending && declineMut.variables === inv.id);
                    return (
                      <div key={inv.id} className="flex items-center gap-4 px-6 py-4 hover-lift">
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold text-white"
                          style={{ backgroundColor: inv.clan.color }}
                        >
                          {inv.clan.tag}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-base font-semibold text-foreground truncate">[{inv.clan.tag}] {inv.clan.name}</p>
                          <p className="text-sm text-muted-foreground">Zaproszenie od {inv.invited_by.username}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="ghost"
                            disabled={actionPending}
                            onClick={() => acceptMut.mutate(inv.id, {
                              onSuccess: () => toast.success("Dołączono do klanu!", { id: "clan-accept-invite" }),
                              onError: (err) => toast.error(err instanceof APIError ? err.message : "Nie udało się dołączyć", { id: "clan-accept-invite-error" }),
                            })}
                            className="gap-2 text-base text-green-400 hover:text-green-400 hover:bg-green-400/10"
                          >
                            {busy && acceptMut.variables === inv.id ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                            Przyjmij
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={actionPending}
                            onClick={() => declineMut.mutate(inv.id, {
                              onSuccess: () => toast.success("Odrzucono", { id: "clan-decline-invite" }),
                              onError: (err) => toast.error(err instanceof APIError ? err.message : "Nie udało się odrzucić", { id: "clan-decline-invite-error" }),
                            })}
                            className="gap-2 text-base text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            {busy && declineMut.variables === inv.id ? <Loader2 size={18} className="animate-spin" /> : <X size={18} />}
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

      {/* ── Leaderboard ── */}
      {tab === "leaderboard" && (
        <div className="px-4 md:px-0">
          {lbLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : leaderboard.length === 0 ? (
            <EmptyState
              icon={<Trophy size={32} className="text-muted-foreground/40" />}
              message="Brak klanów w rankingu."
            />
          ) : (
            <>
              {/* Podium top 3 */}
              {leaderboard.length >= 1 && (
                <div className="mb-4 md:mb-6">
                  <div className="flex items-stretch md:items-end justify-center gap-2 md:gap-4">
                    {/* 2nd */}
                    {leaderboard[1] && (
                      <button
                        onClick={() => router.push(`/clans/${leaderboard[1].id}`)}
                        className="flex flex-col items-center justify-end gap-2 rounded-2xl border border-border bg-card px-3 py-4 md:px-6 md:py-5 flex-1 md:flex-none md:w-48 min-h-[132px] md:min-h-0 transition-all hover-lift"
                      >
                        <span className="text-[10px] font-bold text-[#C0C0C0] uppercase tracking-widest">#2</span>
                        <div className="flex h-11 w-11 md:h-14 md:w-14 shrink-0 items-center justify-center rounded-full border-2 border-[#C0C0C0] bg-[#C0C0C0]/10 font-display text-xs md:text-sm font-bold" style={{ color: leaderboard[1].color }}>
                          {leaderboard[1].tag}
                        </div>
                        <p className="text-xs md:text-sm font-bold text-foreground truncate w-full text-center">{leaderboard[1].name}</p>
                        <p className="font-display text-sm md:text-lg text-[#C0C0C0] tabular-nums">{leaderboard[1].elo_rating}</p>
                      </button>
                    )}
                    {/* 1st */}
                    <button
                      onClick={() => router.push(`/clans/${leaderboard[0].id}`)}
                      className="flex flex-col items-center justify-end gap-2 rounded-2xl border border-[#FFD700]/40 bg-[#FFD700]/5 px-3 py-4 md:px-6 md:py-5 flex-1 md:flex-none md:w-56 min-h-[172px] md:min-h-0 transition-all hover-lift"
                    >
                      <Crown className="h-5 w-5 text-[#FFD700] shrink-0" />
                      <div
                        className="flex h-14 w-14 md:h-16 md:w-16 shrink-0 items-center justify-center rounded-full border-2 border-[#FFD700] bg-[#FFD700]/10 font-display text-sm md:text-base font-bold"
                        style={{ color: leaderboard[0].color }}
                      >
                        {leaderboard[0].tag}
                      </div>
                      <p className="text-xs md:text-sm font-bold text-foreground truncate w-full text-center">{leaderboard[0].name}</p>
                      <p className="font-display text-base md:text-xl text-[#FFD700] tabular-nums">{leaderboard[0].elo_rating}</p>
                    </button>
                    {/* 3rd */}
                    {leaderboard[2] && (
                      <button
                        onClick={() => router.push(`/clans/${leaderboard[2].id}`)}
                        className="flex flex-col items-center justify-end gap-2 rounded-2xl border border-border bg-card px-3 py-4 md:px-6 md:py-5 flex-1 md:flex-none md:w-48 min-h-[116px] md:min-h-0 transition-all hover-lift"
                      >
                        <span className="text-[10px] font-bold text-[#CD7F32] uppercase tracking-widest">#3</span>
                        <div className="flex h-10 w-10 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-full border-2 border-[#CD7F32] bg-[#CD7F32]/10 font-display text-xs font-bold" style={{ color: leaderboard[2].color }}>
                          {leaderboard[2].tag}
                        </div>
                        <p className="text-xs md:text-sm font-bold text-foreground truncate w-full text-center">{leaderboard[2].name}</p>
                        <p className="font-display text-xs md:text-base text-[#CD7F32] tabular-nums">{leaderboard[2].elo_rating}</p>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {leaderboard.length > 3 && (
                <>
                  {/* Mobile list */}
                  <div className="animate-list-in md:hidden space-y-0.5">
                    {leaderboard.slice(3).map((clan, idx) => (
                      <button
                        key={clan.id}
                        onClick={() => router.push(`/clans/${clan.id}`)}
                        className="flex w-full items-center gap-3 rounded-xl py-3 px-1 text-left transition-all active:bg-muted/50 hover-lift"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-xs font-bold text-muted-foreground">
                          {idx + 4}
                        </div>
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-display text-[9px] font-bold text-white"
                          style={{ backgroundColor: clan.color }}
                        >
                          {clan.tag}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{clan.name}</p>
                          <span className="text-xs text-muted-foreground">Lv.{clan.level} &middot; {clan.member_count} członków</span>
                        </div>
                        <span className="font-display text-lg tabular-nums text-accent shrink-0">{clan.elo_rating}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                      </button>
                    ))}
                  </div>

                  {/* Desktop table */}
                  <Card className="hidden md:block rounded-2xl overflow-hidden">
                    <Table className="text-base">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-12 pl-6 w-16 text-sm font-semibold">#</TableHead>
                          <TableHead className="h-12 text-sm font-semibold">Klan</TableHead>
                          <TableHead className="h-12 text-sm font-semibold text-center">
                            <div className="flex items-center gap-1 justify-center"><Users className="h-3.5 w-3.5" />Członkowie</div>
                          </TableHead>
                          <TableHead className="h-12 text-sm font-semibold text-center">Poziom</TableHead>
                          <TableHead className="h-12 pr-6 text-sm font-semibold text-right">
                            <div className="flex items-center gap-1 justify-end"><Trophy className="h-3.5 w-3.5 text-accent" />ELO</div>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="animate-list-in">
                        {leaderboard.slice(3).map((clan, idx) => (
                          <TableRow
                            key={clan.id}
                            onClick={() => router.push(`/clans/${clan.id}`)}
                            className="cursor-pointer hover:bg-muted/50 hover-lift"
                          >
                            <TableCell className="pl-6 py-3.5">
                              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-sm font-bold text-muted-foreground font-display">
                                {idx + 4}
                              </div>
                            </TableCell>
                            <TableCell className="py-3.5">
                              <div className="flex items-center gap-3">
                                <div
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold text-white"
                                  style={{ backgroundColor: clan.color }}
                                >
                                  {clan.tag}
                                </div>
                                <span className="text-base font-semibold text-foreground">{clan.name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="py-3.5 text-center">
                              <span className="text-base tabular-nums text-foreground">{clan.member_count}</span>
                            </TableCell>
                            <TableCell className="py-3.5 text-center">
                              <span className="text-base tabular-nums text-foreground">{clan.level}</span>
                            </TableCell>
                            <TableCell className="py-3.5 pr-6 text-right">
                              <span className="font-display text-xl tabular-nums text-accent">{clan.elo_rating}</span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
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
