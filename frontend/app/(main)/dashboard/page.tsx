"use client";

import { useAuth } from "@/hooks/useAuth";
import { useMatchmaking } from "@/hooks/useMatchmaking";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getMyMatches, getConfig, startTutorial, type Match, type GameModeListItem } from "@/lib/api";
import Link from "next/link";
import {
  Swords,
  User,
  Trophy,
  Search,
  Users,
  Zap,
  Settings2,
  Shield,
  Target,
  Crown,
  ChevronRight,
  GraduationCap,
} from "lucide-react";

const MODE_ICONS: Record<string, typeof Users> = {
  "standard-1v1": Swords,
  "standard-3p": Users,
  "standard-4p": Users,
  "blitz-1v1": Zap,
  "custom": Settings2,
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  finished: { label: "Zakonczony", color: "text-slate-400" },
  in_progress: { label: "W trakcie", color: "text-emerald-300" },
  selecting: { label: "Wybor stolic", color: "text-amber-200" },
  cancelled: { label: "Anulowany", color: "text-red-400" },
};

export default function DashboardPage() {
  const { user, loading: authLoading, refreshUser, token } = useAuth();
  const { inQueue, playersInQueue, matchId, activeMatchId, fillBots, setFillBots, joinQueue, leaveQueue } =
    useMatchmaking();
  const router = useRouter();
  const [recentMatches, setRecentMatches] = useState<Match[]>([]);
  const [gameModes, setGameModes] = useState<GameModeListItem[]>([]);
  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [queueSeconds, setQueueSeconds] = useState(0);
  const [tutorialLoading, setTutorialLoading] = useState(false);
  const activeMatch = recentMatches.find(
    (match) =>
      (match.status === "selecting" || match.status === "in_progress") &&
      match.players.some((player) => player.user_id === user?.id && player.is_alive)
  ) ?? null;

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (token) {
      const loadDashboardState = () => {
        refreshUser().catch(() => {});
        getMyMatches(token)
          .then(setRecentMatches)
          .catch(() => {});
      };

      loadDashboardState();
      const interval = window.setInterval(loadDashboardState, 10000);
      return () => window.clearInterval(interval);
    }
  }, [token, refreshUser]);

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        setGameModes(cfg.game_modes);
        const defaultMode = cfg.game_modes.find((m) => m.is_default);
        if (defaultMode) {
          setSelectedMode((prev) => prev ?? defaultMode.slug);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!inQueue) return;
    const start = Date.now();
    const interval = window.setInterval(
      () => setQueueSeconds(Math.floor((Date.now() - start) / 1000)),
      500
    );
    return () => {
      window.clearInterval(interval);
      setQueueSeconds(0);
    };
  }, [inQueue]);

  useEffect(() => {
    if (matchId) {
      router.push(`/game/${matchId}`);
    }
  }, [matchId, router]);

  useEffect(() => {
    if (activeMatchId) {
      router.push(`/game/${activeMatchId}`);
    }
  }, [activeMatchId, router]);

  const handleStartTutorial = async () => {
    if (!token || tutorialLoading) return;
    setTutorialLoading(true);
    try {
      const result = await startTutorial(token);
      router.push(`/game/${result.match_id}`);
    } catch (err) {
      console.error("Failed to start tutorial:", err);
      setTutorialLoading(false);
    }
  };

  if (authLoading || !user) {
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

  const currentMode = gameModes.find((m) => m.slug === selectedMode);
  const wins = recentMatches.filter((m) => m.status === "finished" && m.winner_id === user.id).length;

  return (
    <div className="space-y-6">
      {/* ── Player overview ──────────────────────────────────── */}
      <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
          <div className="pointer-events-none absolute -right-4 -top-4 h-32 w-32 opacity-15">
            <Image src="/assets/match_making/g707.webp" alt="" fill className="object-contain" />
          </div>
          <div className="relative flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.12),rgba(251,191,36,0.06))]">
              <User className="h-7 w-7 text-cyan-200" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-xs uppercase tracking-[0.3em] text-cyan-200/70">
                Dowodca
              </p>
              <h2 className="mt-1 truncate font-display text-3xl text-zinc-50">
                {user.username}
              </h2>
              <p className="mt-1 truncate text-sm text-slate-400">{user.email}</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-center">
              <div className="font-display text-2xl text-amber-200">{user.elo_rating}</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">ELO</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-center">
              <div className="font-display text-2xl text-cyan-200">{recentMatches.length}</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Mecze</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-center">
              <div className="font-display text-2xl text-emerald-300">{wins}</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Wygrane</div>
            </div>
          </div>
        </div>

        {/* Queue status */}
        <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/3 opacity-40">
            <Image src="/assets/match_making/path17.webp" alt="" fill className="object-contain object-right" />
          </div>
          <div className="relative">
            <p className="font-display text-xs uppercase tracking-[0.3em] text-amber-200/70">
              Matchmaking
            </p>
            <h2 className="mt-1 font-display text-3xl text-zinc-50">
              {activeMatch ? "Aktywny mecz" : inQueue ? "Szukanie meczu..." : "Gotowy do gry"}
            </h2>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                  {inQueue ? "Czas" : "Status"}
                </div>
                <div className="mt-1 font-display text-xl text-amber-200">
                  {activeMatch ? "Live" : inQueue ? `${Math.floor(queueSeconds / 60)}:${String(queueSeconds % 60).padStart(2, "0")}` : "Idle"}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">W kolejce</div>
                <div className="mt-1 font-display text-xl text-cyan-200">{playersInQueue}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Tryb</div>
                <div className="mt-1 truncate font-display text-base text-zinc-50">
                  {currentMode?.name ?? "—"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Tutorial card ─────────────────────────────────── */}
      {user && !user.tutorial_completed && !activeMatch && !inQueue && (
        <section className="rounded-[24px] border border-amber-300/20 bg-gradient-to-br from-amber-500/[0.06] to-cyan-500/[0.04] p-6 backdrop-blur-xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-400/10">
                <GraduationCap className="h-6 w-6 text-amber-200" />
              </div>
              <div>
                <h3 className="font-display text-xl text-zinc-50">Samouczek</h3>
                <p className="text-sm text-slate-400">
                  Nowy w grze? Przejdz krotki samouczek i naucz sie podstaw strategii!
                </p>
              </div>
            </div>
            <Button
              size="lg"
              className="h-11 gap-2 rounded-full border border-amber-300/30 bg-[linear-gradient(135deg,#fbbf24,#f59e0b)] px-6 font-display uppercase tracking-[0.2em] text-slate-950 hover:opacity-90"
              onClick={handleStartTutorial}
              disabled={tutorialLoading}
            >
              {tutorialLoading ? (
                <>Ladowanie...</>
              ) : (
                <>
                  <GraduationCap className="h-4 w-4" />
                  Rozpocznij samouczek
                </>
              )}
            </Button>
          </div>
        </section>
      )}

      {/* ── Game mode selector ───────────────────────────────── */}
      {gameModes.length > 0 && !activeMatch && !inQueue && (
        <section className="rounded-[24px] border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
              <Target className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <h3 className="font-display text-xl text-zinc-50">Wybierz tryb gry</h3>
              <p className="text-sm text-slate-400">Kazdy tryb ma inne zasady i tempo rozgrywki</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {gameModes.map((mode) => {
              const isSelected = selectedMode === mode.slug;
              const Icon = MODE_ICONS[mode.slug] ?? Swords;
              return (
                <button
                  key={mode.id}
                  onClick={() => setSelectedMode(mode.slug)}
                  className={`group relative flex flex-col items-start gap-2 rounded-2xl border px-5 py-4 text-left transition-all ${
                    isSelected
                      ? "border-cyan-400/40 bg-cyan-500/10 shadow-[0_0_24px_rgba(34,211,238,0.08)]"
                      : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Icon className={`h-5 w-5 ${isSelected ? "text-cyan-300" : "text-slate-500"}`} />
                      <span className={`font-display text-base ${isSelected ? "text-zinc-50" : "text-zinc-300"}`}>
                        {mode.name}
                      </span>
                    </div>
                    {mode.is_default && (
                      <Badge className="border-0 bg-amber-500/20 text-[10px] text-amber-200 hover:bg-amber-500/20">
                        Domyslny
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs leading-5 text-slate-500">{mode.description}</p>
                  <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-slate-500">
                    <Users className="h-3 w-3" />
                    {mode.min_players === mode.max_players
                      ? `${mode.max_players} graczy`
                      : `${mode.min_players}-${mode.max_players} graczy`}
                  </div>
                  {isSelected && (
                    <div className="absolute -right-px -top-px h-3 w-3 rounded-bl-lg rounded-tr-2xl bg-cyan-400" />
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Action bar: find game / active match / queue ──── */}
      <section className="rounded-[24px] border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <Swords className={`h-5 w-5 ${activeMatch ? "text-emerald-300" : inQueue ? "text-amber-200" : "text-red-400"}`} />
          </div>
          <div>
            <h3 className="font-display text-xl text-zinc-50">
              {activeMatch ? "Aktywny mecz" : inQueue ? "Szukanie meczu" : "Szukaj gry"}
            </h3>
            <p className="text-sm text-slate-400">
              {activeMatch
                ? "Najpierw dokoncz aktualna rozgrywke"
                : inQueue
                  ? `Tryb: ${currentMode?.name ?? "domyslny"}`
                  : "Dolacz do kolejki i walcz o dominacje na mapie"}
            </p>
          </div>
        </div>

        {activeMatch ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
              <span className="text-sm text-slate-300">
                Mecz w statusie <span className="font-medium text-zinc-100">{STATUS_LABELS[activeMatch.status]?.label ?? activeMatch.status}</span>
              </span>
            </div>
            <Button
              size="lg"
              className="h-11 gap-2 rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] px-6 font-display uppercase tracking-[0.2em] text-slate-950 hover:opacity-90"
              onClick={() => router.push(`/game/${activeMatch.id}`)}
            >
              <Shield className="h-4 w-4" />
              Wroc do gry
            </Button>
          </div>
        ) : inQueue ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Image
                src="/assets/match_making/circle291.webp"
                alt=""
                width={36}
                height={36}
                className="h-9 w-9 animate-spin object-contain"
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-200">Szukam przeciwnika...</span>
                <Badge className="border-0 bg-white/10 text-slate-200 hover:bg-white/10">
                  {playersInQueue} w kolejce
                </Badge>
                {fillBots && (
                  <span className="text-xs text-slate-500">
                    Boty dolacza po 30s
                  </span>
                )}
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={leaveQueue}
              className="rounded-full px-5"
            >
              Anuluj
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={fillBots}
                  onChange={(e) => setFillBots(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-white/10 accent-cyan-400"
                />
                Wypelnij botami jezeli brak graczy
              </label>
              {fillBots && (
                <p className="ml-6 mt-1 text-xs text-slate-500">
                  Boty dolacza automatycznie po 30 sekundach w kolejce
                </p>
              )}
            </div>
            <Button
              size="lg"
              className="h-11 gap-2 rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] px-6 font-display uppercase tracking-[0.2em] text-slate-950 hover:opacity-90"
              onClick={() => joinQueue(selectedMode ?? undefined)}
              disabled={!selectedMode}
            >
              <Search className="h-4 w-4" />
              Szukaj gry
            </Button>
          </div>
        )}
      </section>

      {/* ── Recent matches ───────────────────────────────────── */}
      <section className="rounded-[24px] border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <Trophy className="h-5 w-5 text-amber-300" />
          </div>
          <div>
            <h3 className="font-display text-xl text-zinc-50">Ostatnie mecze</h3>
            <p className="text-sm text-slate-400">
              {recentMatches.length > 0
                ? `${recentMatches.length} ${recentMatches.length === 1 ? "mecz" : recentMatches.length < 5 ? "mecze" : "meczy"} w historii`
                : "Brak rozegranych meczy"}
            </p>
          </div>
        </div>

        {recentMatches.length === 0 ? (
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-5 py-8 text-center">
            <Swords className="mx-auto h-8 w-8 text-slate-600" />
            <p className="mt-3 text-sm text-slate-500">
              Dolacz do kolejki i rozegraj swoj pierwszy mecz
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentMatches.slice(0, 5).map((match) => {
              const status = STATUS_LABELS[match.status] ?? { label: match.status, color: "text-slate-400" };
              const isActive = match.status === "in_progress" || match.status === "selecting";
              const winner = match.players.find((p) => p.user_id === match.winner_id);
              const myPlayer = match.players.find((p) => p.user_id === user.id);
              const isWinner = match.winner_id === user.id;
              const dateStr = match.finished_at ?? match.started_at ?? match.created_at;
              const date = new Date(dateStr);

              return (
                <Link
                  key={match.id}
                  href={isActive ? `/game/${match.id}` : `/match/${match.id}`}
                  className={`group grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-2xl border px-4 py-3 transition-colors ${
                    isActive
                      ? "border-cyan-300/20 bg-cyan-400/5 hover:bg-cyan-400/8"
                      : isWinner
                        ? "border-amber-300/15 bg-amber-400/[0.03] hover:bg-amber-400/[0.06]"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {isActive ? (
                      <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                    ) : isWinner ? (
                      <Crown className="h-4 w-4 text-amber-300" />
                    ) : (
                      <Swords className="h-4 w-4 text-slate-500" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${status.color}`}>
                          {status.label}
                        </span>
                        {isWinner && (
                          <Badge className="border-0 bg-amber-400/15 text-[10px] text-amber-200 hover:bg-amber-400/15">
                            Wygrana
                          </Badge>
                        )}
                        {match.status === "finished" && !isWinner && myPlayer && !myPlayer.is_alive && (
                          <Badge className="border-0 bg-red-400/15 text-[10px] text-red-300 hover:bg-red-400/15">
                            Przegrana
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
                        <span>{match.players.length} graczy</span>
                        {winner && <span>Zwyciezca: {winner.username}</span>}
                        <span>{date.toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}</span>
                      </div>
                    </div>
                  </div>

                  {/* Player colors */}
                  <div className="flex justify-end gap-1">
                    {match.players.map((p) => (
                      <div
                        key={p.id}
                        className={`h-5 w-5 rounded-md border ${
                          p.user_id === user.id ? "border-white/30" : "border-white/10"
                        } ${!p.is_alive && match.status === "finished" ? "opacity-40" : ""}`}
                        style={{ backgroundColor: p.color }}
                        title={p.username}
                      />
                    ))}
                  </div>

                  <ChevronRight className="h-4 w-4 text-slate-600 transition-colors group-hover:text-slate-300" />
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
