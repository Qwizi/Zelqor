"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Trophy, Medal, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getLeaderboard, type LeaderboardEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <Image
          src="/assets/match_making/circle291.webp"
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 animate-spin object-contain"
        />
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const defaultPage = myPlacement > 0 ? Math.ceil(myPlacement / PAGE_SIZE) : 1;
  const safePage = Math.min(pageOverride ?? defaultPage, totalPages);
  const paginatedEntries = entries.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Ranking</p>
            <h1 className="font-display text-3xl text-zinc-50">Tabela liderów</h1>
            <p className="mt-1 text-sm text-slate-400">
              Ranking uwzględnia ELO, wygrane, win rate i średni placement.
            </p>
          </div>
          <Badge className="border-white/10 bg-white/[0.04] px-3 py-2 text-slate-200 hover:bg-white/[0.04]">
            {entries.length} graczy
          </Badge>
        </div>

        {myPlacement > 0 && user && (
          <div className="rounded-2xl border border-cyan-300/25 bg-cyan-400/10 px-4 py-3 backdrop-blur-xl">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">
              Twoja pozycja
            </div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <div>
                <div className="font-display text-2xl text-zinc-50">#{myPlacement}</div>
                <div className="text-sm text-slate-300">{user.username}</div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPageOverride(Math.ceil(myPlacement / PAGE_SIZE))}
                className="rounded-full border-cyan-300/25 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15"
              >
                Pokaż mnie
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-3">
          {paginatedEntries.map((entry, index) => {
            const isMe = entry.id === user?.id;
            const placement = (safePage - 1) * PAGE_SIZE + index + 1;
            return (
              <div
                key={entry.id}
                className={`grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border p-4 backdrop-blur-xl transition-colors ${
                  isMe
                    ? "border-cyan-300/25 bg-cyan-400/10 hover:border-cyan-300/40 hover:bg-cyan-400/15"
                    : "border-white/10 bg-slate-950/60 hover:border-white/20 hover:bg-white/[0.06]"
                }`}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] font-display text-lg text-zinc-50">
                  {placement <= 3 ? <Medal className="h-5 w-5 text-amber-300" /> : placement}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/profile/${entry.id}`}
                      className="truncate font-medium text-zinc-50 hover:text-cyan-300 transition-colors"
                    >
                      {entry.username}
                    </Link>
                    {isMe && (
                      <Badge className="border-0 bg-cyan-400/15 text-cyan-200 hover:bg-cyan-400/15">
                        Ty
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
                    <span>{entry.matches_played} meczów</span>
                    <span>{entry.wins} wygranych</span>
                    <span>{Math.round(entry.win_rate * 100)}% win rate</span>
                    <span>avg place {entry.average_placement.toFixed(2)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 text-amber-200">
                    <Trophy className="h-4 w-4" />
                    <span className="font-display text-2xl">{entry.elo_rating}</span>
                  </div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">
                    ELO
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 backdrop-blur-xl">
          <div className="text-sm text-slate-300">
            Strona {safePage} z {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => setPageOverride(Math.max(1, safePage - 1))}
              className="rounded-full border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.10] hover:text-zinc-100"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Poprzednia
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() => setPageOverride(Math.min(totalPages, safePage + 1))}
              className="rounded-full border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.10] hover:text-zinc-100"
            >
              Następna
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
    </div>
  );
}
