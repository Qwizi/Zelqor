"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { Trophy, Medal, ChevronLeft, ChevronRight, Loader2, Target, Swords, Crown } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getLeaderboard, type LeaderboardEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BannedBadge } from "@/components/ui/banned-badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 20;

export default function LeaderboardPage() {
  const { user, loading, token } = useAuth();
  const router = useRouter();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageOverride, setPageOverride] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!containerRef.current || pageLoading) return;
    gsap.fromTo("[data-animate='row']", { x: -12, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, stagger: 0.04, ease: "power2.out" });
    gsap.fromTo("[data-animate='section']", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power2.out" });
  }, { scope: containerRef, dependencies: [pageLoading, pageOverride] });

  useEffect(() => {
    if (loading) return;
    if (!user || !token) {
      router.replace("/login");
      return;
    }

    getLeaderboard(token)
      .then((res) => setEntries(res.items))
      .finally(() => setPageLoading(false));
  }, [loading, router, token, user]);

  const myPlacement = entries.findIndex((entry) => entry.id === user?.id) + 1;

  if (loading || pageLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const defaultPage = myPlacement > 0 ? Math.ceil(myPlacement / PAGE_SIZE) : 1;
  const safePage = Math.min(pageOverride ?? defaultPage, totalPages);
  const paginatedEntries = entries.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div ref={containerRef} className="space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 px-4 md:px-0">
        <div>
          <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">Ranking</p>
          <h1 className="font-display text-2xl md:text-5xl text-foreground">Ranking</h1>
          <p className="hidden md:block mt-1 text-sm text-muted-foreground">
            ELO, wygrane, win rate i średni placement.
          </p>
        </div>
        <Badge variant="outline" className="hidden md:inline-flex text-sm px-3 py-1.5 text-foreground">
          {entries.length} graczy
        </Badge>
      </div>

      {/* ── Twoja pozycja ── */}
      {myPlacement > 0 && user && (
        <div className="px-4 md:px-0">
          <div data-animate="section" className="flex items-center justify-between gap-3 rounded-2xl border border-primary/20 md:border-primary/25 bg-primary/5 p-3.5 md:p-5">
            <div className="flex items-baseline gap-2 md:gap-3">
              <span className="font-display text-3xl md:text-5xl text-primary">#{myPlacement}</span>
              <span className="text-sm md:text-lg text-foreground">{user.username}</span>
            </div>
            <button
              className="rounded-full md:rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-2 md:px-4 md:py-2.5 text-xs md:text-sm font-semibold text-primary hover:bg-primary/20 transition-colors active:scale-[0.97]"
              onClick={() => setPageOverride(Math.ceil(myPlacement / PAGE_SIZE))}
            >
              Pokaż
            </button>
          </div>
        </div>
      )}

      {/* ── Lista/Tabela ── */}
      <div className="px-4 md:px-0">
        {/* Mobile: clean list */}
        <div className="md:hidden space-y-0.5">
          {paginatedEntries.map((entry, index) => {
            const isMe = entry.id === user?.id;
            const placement = (safePage - 1) * PAGE_SIZE + index + 1;
            const isTop3 = placement <= 3;

            return (
              <button
                key={entry.id}
                data-animate="row"
                onClick={() => router.push(`/profile/${entry.id}`)}
                className={`flex w-full items-center gap-3 rounded-xl py-3 px-1 text-left transition-all active:bg-muted/50 ${isMe ? "bg-primary/5" : ""}`}
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                  isTop3 ? "bg-accent/15 text-accent" : "bg-secondary text-muted-foreground"
                }`}>
                  {isTop3 ? <Medal className="h-4 w-4" /> : placement}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm font-semibold text-foreground truncate ${entry.is_banned ? "line-through opacity-60" : ""}`}>{entry.username}</span>
                    {isMe && <span className="text-[10px] font-bold text-primary">Ty</span>}
                    {entry.is_banned && <BannedBadge />}
                  </div>
                  <span className="text-xs text-muted-foreground">{Math.round(entry.win_rate * 100)}% WR · {entry.matches_played} meczy</span>
                </div>
                <span className="font-display text-lg tabular-nums text-accent shrink-0">{entry.elo_rating}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
              </button>
            );
          })}
        </div>

        {/* Desktop: table */}
        <Card className="hidden md:block rounded-2xl overflow-hidden">
          <Table className="text-base">
            <TableHeader>
              <TableRow>
                <TableHead className="h-12 pl-6 w-16 text-sm font-semibold">#</TableHead>
                <TableHead className="h-12 text-sm font-semibold">Gracz</TableHead>
                <TableHead className="h-12 text-sm font-semibold text-center">
                  <div className="flex items-center gap-1 justify-center"><Swords className="h-3.5 w-3.5" />Mecze</div>
                </TableHead>
                <TableHead className="h-12 text-sm font-semibold text-center">
                  <div className="flex items-center gap-1 justify-center"><Crown className="h-3.5 w-3.5" />Wygrane</div>
                </TableHead>
                <TableHead className="h-12 text-sm font-semibold text-center">
                  <div className="flex items-center gap-1 justify-center"><Target className="h-3.5 w-3.5" />Win Rate</div>
                </TableHead>
                <TableHead className="h-12 text-sm font-semibold text-center">Avg</TableHead>
                <TableHead className="h-12 pr-6 text-sm font-semibold text-right">
                  <div className="flex items-center gap-1 justify-end"><Trophy className="h-3.5 w-3.5 text-accent" />ELO</div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedEntries.map((entry, index) => {
                const isMe = entry.id === user?.id;
                const placement = (safePage - 1) * PAGE_SIZE + index + 1;
                const isTop3 = placement <= 3;

                return (
                  <TableRow
                    key={entry.id}
                    data-animate="row"
                    onClick={() => router.push(`/profile/${entry.id}`)}
                    className={`cursor-pointer ${isMe ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/50"}`}
                  >
                    <TableCell className="pl-6 py-3.5">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg font-display text-sm font-bold ${
                        isTop3 ? "bg-accent/15 text-accent" : "bg-secondary text-muted-foreground"
                      }`}>
                        {isTop3 ? <Medal className="h-4 w-4" /> : placement}
                      </div>
                    </TableCell>
                    <TableCell className="py-3.5">
                      <div className="flex items-center gap-2">
                        <Link href={`/profile/${entry.id}`} className={`text-base font-semibold text-foreground hover:text-primary transition-colors ${entry.is_banned ? "line-through opacity-60" : ""}`}>{entry.username}</Link>
                        {isMe && <Badge className="border-0 bg-primary/15 text-xs text-primary hover:bg-primary/15">Ty</Badge>}
                        {entry.is_banned && <BannedBadge />}
                      </div>
                    </TableCell>
                    <TableCell className="py-3.5 text-center"><span className="text-base tabular-nums text-foreground">{entry.matches_played}</span></TableCell>
                    <TableCell className="py-3.5 text-center"><span className="text-base tabular-nums text-foreground">{entry.wins}</span></TableCell>
                    <TableCell className="py-3.5 text-center">
                      <span className={`text-base tabular-nums font-semibold ${entry.win_rate >= 0.6 ? "text-green-400" : entry.win_rate >= 0.4 ? "text-foreground" : "text-muted-foreground"}`}>
                        {Math.round(entry.win_rate * 100)}%
                      </span>
                    </TableCell>
                    <TableCell className="py-3.5 text-center"><span className="text-base tabular-nums text-muted-foreground">{entry.average_placement.toFixed(1)}</span></TableCell>
                    <TableCell className="py-3.5 pr-6 text-right"><span className="font-display text-xl tabular-nums text-accent">{entry.elo_rating}</span></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* ── Paginacja ── */}
      <div className="flex items-center justify-between px-4 md:px-0">
        <span className="text-xs md:text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{safePage}</span> / {totalPages}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="flex h-9 w-9 md:h-10 md:w-auto items-center justify-center md:gap-2 md:px-4 rounded-full md:rounded-xl border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 transition-colors active:scale-[0.95]"
            disabled={safePage <= 1}
            onClick={() => setPageOverride(Math.max(1, safePage - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden md:inline text-sm">Poprzednia</span>
          </button>
          <button
            className="flex h-9 w-9 md:h-10 md:w-auto items-center justify-center md:gap-2 md:px-4 rounded-full md:rounded-xl border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 transition-colors active:scale-[0.95]"
            disabled={safePage >= totalPages}
            onClick={() => setPageOverride(Math.min(totalPages, safePage + 1))}
          >
            <span className="hidden md:inline text-sm">Następna</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
