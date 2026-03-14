"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Trophy, Swords, Crown, ChevronLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getLeaderboard, type LeaderboardEntry } from "@/lib/api";

function StatCard({
  value,
  label,
  color = "text-zinc-50",
}: {
  value: string | number;
  label: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-center">
      <div className={`font-display text-2xl ${color}`}>{value}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-[0.2em] text-slate-400 font-medium">
        {label}
      </div>
    </div>
  );
}

export default function PublicProfilePage() {
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();
  const params = useParams();
  const userId = params.userId as string;

  const [entry, setEntry] = useState<LeaderboardEntry | null>(null);
  const [placement, setPlacement] = useState<number | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !token) {
      router.replace("/login");
      return;
    }

    // If viewing own profile, redirect to /profile
    if (user.id === userId) {
      router.replace("/profile");
      return;
    }

    getLeaderboard(token, 1000)
      .then((res) => {
        const idx = res.items.findIndex((e) => e.id === userId);
        if (idx === -1) {
          setNotFound(true);
        } else {
          setEntry(res.items[idx]);
          setPlacement(idx + 1);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setDataLoading(false));
  }, [authLoading, user, token, userId, router]);

  if (authLoading || dataLoading) {
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

  if (notFound || !entry) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
            PROFIL
          </p>
          <h1 className="font-display text-3xl text-zinc-50">
            Profil gracza
          </h1>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-12 text-center backdrop-blur-xl">
          <Swords className="mx-auto h-10 w-10 text-slate-500" />
          <p className="mt-4 text-sm text-slate-400">
            Nie znaleziono gracza
          </p>
          <Link
            href="/leaderboard"
            className="mt-4 inline-flex items-center gap-2 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            <ChevronLeft className="h-3 w-3" />
            Wróć do rankingu
          </Link>
        </div>
      </div>
    );
  }

  const winRate = Math.round(entry.win_rate * 100);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
          PROFIL
        </p>
        <h1 className="font-display text-3xl text-zinc-50">
          Profil gracza: {entry.username}
        </h1>
      </div>

      {/* Back link */}
      <Link
        href="/leaderboard"
        className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300 transition-colors"
      >
        <ChevronLeft className="h-3 w-3" />
        Tabela liderów
      </Link>

      {/* Player card */}
      <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          {/* Rank badge */}
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] font-display text-2xl text-zinc-50">
            {placement !== null && placement <= 3 ? (
              <Crown className="h-7 w-7 text-amber-300" />
            ) : (
              <span>#{placement}</span>
            )}
          </div>

          <div>
            <h2 className="font-display text-2xl text-zinc-50">
              {entry.username}
            </h2>
            {placement !== null && (
              <p className="mt-0.5 text-sm text-slate-400">
                Ranking #{placement}
              </p>
            )}
          </div>
        </div>

        {/* Stats grid */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            value={entry.elo_rating}
            label="ELO"
            color="text-amber-200"
          />
          <StatCard
            value={entry.matches_played}
            label="Mecze"
            color="text-cyan-200"
          />
          <StatCard
            value={entry.wins}
            label="Wygrane"
            color="text-emerald-300"
          />
          <StatCard
            value={`${winRate}%`}
            label="Win Rate"
            color="text-violet-300"
          />
        </div>

        {/* Extra stats */}
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-300">
            <span>
              Śr. placement:{" "}
              <span className="text-zinc-200">
                {entry.average_placement.toFixed(2)}
              </span>
            </span>
          </div>
        </div>
      </section>

      {/* Leaderboard CTA */}
      <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Trophy className="h-5 w-5 text-amber-300" />
            <p className="text-sm text-slate-300">
              Sprawdź pełną tabelę liderów
            </p>
          </div>
          <Link
            href="/leaderboard"
            className="rounded-xl border border-cyan-400/20 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/25 transition-colors"
          >
            Ranking
          </Link>
        </div>
      </section>
    </div>
  );
}
