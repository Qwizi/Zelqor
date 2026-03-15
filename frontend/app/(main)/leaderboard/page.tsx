"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trophy, Medal, ChevronLeft, ChevronRight, Loader2, Target, Swords, Crown } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getLeaderboard, type LeaderboardEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">Ranking</p>
          <h1 className="font-display text-4xl sm:text-5xl text-foreground">Tabela liderów</h1>
          <p className="text-base text-muted-foreground">
            Ranking uwzględnia ELO, wygrane, win rate i średni placement.
          </p>
        </div>
        <Badge variant="outline" className="text-base px-4 py-2 text-foreground">
          {entries.length} graczy
        </Badge>
      </div>

      {/* ── Twoja pozycja ── */}
      {myPlacement > 0 && user && (
        <Card className="rounded-2xl border-primary/25 bg-primary/5">
          <CardContent className="flex items-center justify-between gap-4 p-6">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">
                Twoja pozycja
              </p>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-display text-5xl text-primary">#{myPlacement}</span>
                <span className="text-lg text-foreground">{user.username}</span>
              </div>
            </div>
            <Button
              variant="outline"
              className="h-11 rounded-xl border-primary/30 bg-primary/10 text-base text-primary hover:bg-primary/20"
              onClick={() => setPageOverride(Math.ceil(myPlacement / PAGE_SIZE))}
            >
              Pokaż mnie
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Tabela ── */}
      <Card className="rounded-2xl overflow-hidden">
        <Table className="text-base">
          <TableHeader>
            <TableRow>
              <TableHead className="h-14 pl-6 w-20 text-base font-semibold">#</TableHead>
              <TableHead className="h-14 text-base font-semibold">Gracz</TableHead>
              <TableHead className="h-14 text-base font-semibold text-center">
                <div className="flex items-center gap-1.5 justify-center">
                  <Swords className="h-4 w-4" />
                  Mecze
                </div>
              </TableHead>
              <TableHead className="h-14 text-base font-semibold text-center">
                <div className="flex items-center gap-1.5 justify-center">
                  <Crown className="h-4 w-4" />
                  Wygrane
                </div>
              </TableHead>
              <TableHead className="h-14 text-base font-semibold text-center">
                <div className="flex items-center gap-1.5 justify-center">
                  <Target className="h-4 w-4" />
                  Win Rate
                </div>
              </TableHead>
              <TableHead className="h-14 text-base font-semibold text-center">Avg Place</TableHead>
              <TableHead className="h-14 pr-6 text-base font-semibold text-right">
                <div className="flex items-center gap-1.5 justify-end">
                  <Trophy className="h-4 w-4 text-accent" />
                  ELO
                </div>
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
                  onClick={() => router.push(`/profile/${entry.id}`)}
                  className={`cursor-pointer ${
                    isMe
                      ? "bg-primary/5 hover:bg-primary/10"
                      : "hover:bg-muted/50"
                  }`}
                >
                  {/* Placement */}
                  <TableCell className="pl-6 py-5">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl font-display text-lg font-bold ${
                      isTop3
                        ? "bg-accent/15 text-accent"
                        : "bg-secondary text-muted-foreground"
                    }`}>
                      {isTop3 ? <Medal className="h-5 w-5" /> : placement}
                    </div>
                  </TableCell>

                  {/* Player name */}
                  <TableCell className="py-5">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/profile/${entry.id}`}
                        className="text-lg font-semibold text-foreground hover:text-primary transition-colors"
                      >
                        {entry.username}
                      </Link>
                      {isMe && (
                        <Badge className="border-0 bg-primary/15 text-sm text-primary hover:bg-primary/15">
                          Ty
                        </Badge>
                      )}
                    </div>
                  </TableCell>

                  {/* Matches */}
                  <TableCell className="py-5 text-center">
                    <span className="text-lg tabular-nums text-foreground">{entry.matches_played}</span>
                  </TableCell>

                  {/* Wins */}
                  <TableCell className="py-5 text-center">
                    <span className="text-lg tabular-nums text-foreground">{entry.wins}</span>
                  </TableCell>

                  {/* Win Rate */}
                  <TableCell className="py-5 text-center">
                    <span className={`text-lg tabular-nums font-semibold ${
                      entry.win_rate >= 0.6
                        ? "text-green-400"
                        : entry.win_rate >= 0.4
                          ? "text-foreground"
                          : "text-muted-foreground"
                    }`}>
                      {Math.round(entry.win_rate * 100)}%
                    </span>
                  </TableCell>

                  {/* Avg Placement */}
                  <TableCell className="py-5 text-center">
                    <span className="text-lg tabular-nums text-muted-foreground">
                      {entry.average_placement.toFixed(1)}
                    </span>
                  </TableCell>

                  {/* ELO */}
                  <TableCell className="py-5 pr-6 text-right">
                    <span className="font-display text-2xl tabular-nums text-accent">
                      {entry.elo_rating}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* ── Paginacja ── */}
      <Card className="rounded-2xl">
        <CardContent className="flex items-center justify-between p-5">
          <span className="text-base text-muted-foreground">
            Strona <span className="font-semibold text-foreground">{safePage}</span> z {totalPages}
          </span>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="h-11 gap-2 rounded-xl text-base"
              disabled={safePage <= 1}
              onClick={() => setPageOverride(Math.max(1, safePage - 1))}
            >
              <ChevronLeft className="h-5 w-5" />
              Poprzednia
            </Button>
            <Button
              variant="outline"
              className="h-11 gap-2 rounded-xl text-base"
              disabled={safePage >= totalPages}
              onClick={() => setPageOverride(Math.min(totalPages, safePage + 1))}
            >
              Następna
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
