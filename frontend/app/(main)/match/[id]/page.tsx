"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { getMatch, getMatchResult, type Match, type MatchResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Clock,
  Crown,
  MapPin,
  Shield,
  Skull,
  Swords,
  Users,
  Hammer,
  TrendingUp,
  TrendingDown,
  PlayCircle,
} from "lucide-react";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  finished: { label: "Zakonczony", color: "text-slate-400" },
  in_progress: { label: "W trakcie", color: "text-emerald-300" },
  selecting: { label: "Wybor stolic", color: "text-amber-200" },
  cancelled: { label: "Anulowany", color: "text-red-400" },
  waiting: { label: "Oczekiwanie", color: "text-slate-400" },
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();
  const [match, setMatch] = useState<Match | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !token) {
      router.replace("/login");
      return;
    }

    Promise.all([
      getMatch(token, id),
      getMatchResult(token, id).catch(() => null),
    ]).then(([matchData, resultData]) => {
      setMatch(matchData);
      setResult(resultData);
      setLoading(false);
    });
  }, [authLoading, user, token, id, router]);

  if (loading || !match) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
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

  const status = STATUS_LABELS[match.status] ?? { label: match.status, color: "text-slate-400" };
  const isActive = match.status === "in_progress" || match.status === "selecting";
  const winner = match.players.find((p) => p.user_id === match.winner_id);

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
          <h1 className="font-display text-3xl text-zinc-50">Szczegoly meczu</h1>
          <p className="mt-1 text-sm text-slate-500">
            ID: {match.id.slice(0, 8)}...
          </p>
        </div>
        <div className="flex items-center gap-2">
          {match.status === "finished" && (
            <Link
              href={`/replay/${match.id}`}
              className="inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-400/10 px-5 py-2 font-display text-sm uppercase tracking-[0.2em] text-amber-200 transition-colors hover:bg-amber-400/15"
            >
              <PlayCircle className="h-4 w-4" />
              Replay
            </Link>
          )}
          {isActive && (
            <Button
              className="gap-2 rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] px-5 font-display uppercase tracking-[0.2em] text-slate-950 hover:opacity-90"
              onClick={() => router.push(`/game/${match.id}`)}
            >
              <Shield className="h-4 w-4" />
              Wroc do gry
            </Button>
          )}
        </div>
      </div>

      {/* Match info */}
      <section className="rounded-[24px] border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-slate-500">
              <Swords className="h-3.5 w-3.5" />
              Status
            </div>
            <div className={`mt-1 font-display text-xl ${status.color}`}>
              {status.label}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-slate-500">
              <Users className="h-3.5 w-3.5" />
              Gracze
            </div>
            <div className="mt-1 font-display text-xl text-zinc-50">
              {match.players.length} / {match.max_players}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-slate-500">
              <Clock className="h-3.5 w-3.5" />
              {match.finished_at ? "Czas trwania" : "Utworzono"}
            </div>
            <div className="mt-1 font-display text-xl text-zinc-50">
              {result
                ? formatDuration(result.duration_seconds)
                : formatDate(match.created_at)}
            </div>
          </div>
          {winner && (
            <div className="rounded-xl border border-amber-300/20 bg-amber-400/5 px-4 py-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-amber-300/70">
                <Crown className="h-3.5 w-3.5" />
                Zwyciezca
              </div>
              <div className="mt-1 font-display text-xl text-amber-200">
                {winner.username}
              </div>
            </div>
          )}
        </div>
        {(match.started_at || match.finished_at) && (
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
            {match.started_at && <span>Start: {formatDate(match.started_at)}</span>}
            {match.finished_at && <span>Koniec: {formatDate(match.finished_at)}</span>}
            {result && <span>Ticki: {result.total_ticks}</span>}
          </div>
        )}
      </section>

      {/* Players */}
      <section className="rounded-[24px] border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <Users className="h-5 w-5 text-cyan-300" />
          </div>
          <h3 className="font-display text-xl text-zinc-50">Gracze</h3>
        </div>

        <div className="space-y-2">
          {match.players.map((player) => {
            const isMe = player.user_id === user?.id;
            const isWinner = player.user_id === match.winner_id;
            const playerResult = result?.player_results.find(
              (pr) => pr.user_id === player.user_id
            );

            return (
              <div
                key={player.id}
                className={`grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-2xl border p-4 ${
                  isWinner
                    ? "border-amber-300/25 bg-amber-400/5"
                    : isMe
                      ? "border-cyan-300/20 bg-cyan-400/5"
                      : "border-white/10 bg-white/[0.03]"
                }`}
              >
                {/* Color + name */}
                <div className="flex items-center gap-3">
                  <div
                    className="h-8 w-8 rounded-lg border border-white/15"
                    style={{ backgroundColor: player.color }}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-50">
                        {player.username}
                      </span>
                      {isMe && (
                        <Badge className="border-0 bg-cyan-400/15 text-[10px] text-cyan-200 hover:bg-cyan-400/15">
                          Ty
                        </Badge>
                      )}
                      {isWinner && (
                        <Crown className="h-4 w-4 text-amber-300" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      {player.is_alive ? (
                        <span className="text-emerald-400">Zywy</span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-400">
                          <Skull className="h-3 w-3" />
                          Wyeliminowany
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Stats (if result exists) */}
                {playerResult ? (
                  <div className="flex flex-wrap justify-end gap-x-5 gap-y-1 text-sm">
                    <div className="text-center">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">Miejsce</div>
                      <div className="font-display text-lg text-zinc-50">#{playerResult.placement}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">Regiony</div>
                      <div className="font-display text-lg text-cyan-200">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {playerResult.regions_conquered}
                        </span>
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">Jednostki</div>
                      <div className="font-display text-lg text-zinc-50">
                        {playerResult.units_produced}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">Straty</div>
                      <div className="font-display text-lg text-red-400">
                        {playerResult.units_lost}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">Budynki</div>
                      <div className="font-display text-lg text-amber-200">
                        <span className="inline-flex items-center gap-1">
                          <Hammer className="h-3 w-3" />
                          {playerResult.buildings_built}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div />
                )}

                {/* ELO change */}
                {playerResult ? (
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">ELO</div>
                    <div
                      className={`flex items-center gap-1 font-display text-lg ${
                        playerResult.elo_change > 0
                          ? "text-emerald-300"
                          : playerResult.elo_change < 0
                            ? "text-red-400"
                            : "text-slate-400"
                      }`}
                    >
                      {playerResult.elo_change > 0 ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : playerResult.elo_change < 0 ? (
                        <TrendingDown className="h-4 w-4" />
                      ) : null}
                      {playerResult.elo_change > 0 ? "+" : ""}
                      {playerResult.elo_change}
                    </div>
                  </div>
                ) : (
                  <div />
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
