"use client";

import { useAuth } from "@/hooks/useAuth";
import { useMatchmaking } from "@/hooks/useMatchmaking";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getMyMatches, type Match } from "@/lib/api";
import {
  Swords,
  User,
  Trophy,
  LogOut,
  Loader2,
  Search,
} from "lucide-react";

export default function DashboardPage() {
  const { user, loading: authLoading, logout, token } = useAuth();
  const { inQueue, playersInQueue, matchId, joinQueue, leaveQueue } =
    useMatchmaking();
  const router = useRouter();
  const [recentMatches, setRecentMatches] = useState<Match[]>([]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (token) {
      getMyMatches(token)
        .then(setRecentMatches)
        .catch(() => {});
    }
  }, [token]);

  // Redirect to game when match found
  useEffect(() => {
    if (matchId) {
      router.push(`/game/${matchId}`);
    }
  }, [matchId, router]);

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,#1a2740_0%,#09111d_48%,#04070d_100%)] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[url('/assets/ui/hex_bg_tile.webp')] bg-[size:240px] opacity-[0.05]" />
      <div className="pointer-events-none absolute right-0 top-0 h-[420px] w-[420px] opacity-50">
        <Image
          src="/assets/match_making/g707.webp"
          alt=""
          fill
          className="object-contain object-top-right"
        />
      </div>
      <div className="pointer-events-none absolute left-0 top-24 h-[320px] w-[320px] opacity-35">
        <Image
          src="/assets/match_making/g16.webp"
          alt=""
          fill
          className="object-contain object-left"
        />
      </div>

      {/* Top bar */}
      <header className="relative border-b border-white/10 bg-slate-950/45 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-2">
              <Image
                src="/assets/common/world.webp"
                alt="MapLord"
                width={26}
                height={26}
                className="h-[26px] w-[26px] object-contain"
              />
            </div>
            <div>
              <p className="font-display text-xs uppercase tracking-[0.32em] text-cyan-200/70">
                Command Hub
              </p>
              <h1 className="font-display text-2xl text-zinc-50">MapLord</h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2">
              <User className="h-4 w-4" />
              <span className="font-medium">{user.username}</span>
              <Badge className="border-0 bg-cyan-400/15 text-cyan-200 hover:bg-cyan-400/15">
                {user.elo_rating} ELO
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="rounded-full border border-white/10 bg-white/[0.03] px-4 text-slate-200 hover:bg-white/[0.08]"
            >
              <LogOut className="mr-1 h-4 w-4" />
              Wyloguj
            </Button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-5xl space-y-6 px-6 py-8">
        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/55 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.4)] backdrop-blur-xl">
            <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-80">
              <Image
                src="/assets/match_making/path17.webp"
                alt=""
                fill
                className="object-contain object-right"
              />
            </div>
            <div className="relative max-w-xl">
              <p className="font-display text-xs uppercase tracking-[0.34em] text-cyan-200/70">
                Matchmaking
              </p>
              <h2 className="mt-3 font-display text-4xl leading-none text-zinc-50">
                Szybki powrot do bitwy o mape.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-300/85">
                Dashboard nie musi byc lista kart. To powinien byc lobby screen,
                ktory od razu prowadzi do kolejki, pokazuje aktywnosc gracza i
                przygotowuje pod dalsze ekrany gry.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                    Kolejka
                  </div>
                  <div className="mt-2 font-display text-2xl text-amber-200">
                    {inQueue ? "Live" : "Idle"}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                    Gracze
                  </div>
                  <div className="mt-2 font-display text-2xl text-cyan-200">
                    {playersInQueue}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                    Historia
                  </div>
                  <div className="mt-2 font-display text-2xl text-zinc-50">
                    {recentMatches.length}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-slate-950/55 p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center gap-3">
              <Image
                src="/assets/notifications/friends_match_invitation.webp"
                alt=""
                width={42}
                height={42}
                className="h-10 w-10 rounded-xl object-cover"
              />
              <div>
                <p className="font-display text-xs uppercase tracking-[0.28em] text-amber-200/70">
                  Queue Signal
                </p>
                <h3 className="font-display text-2xl text-zinc-50">
                  Status sesji
                </h3>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <span className="text-sm text-slate-400">Konto</span>
                <span className="font-medium text-zinc-100">{user.email}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <span className="text-sm text-slate-400">Aktywny matchmaking</span>
                <span className="font-display text-lg text-cyan-200">
                  {inQueue ? "Tak" : "Nie"}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <span className="text-sm text-slate-400">Mecze zapisane</span>
                <span className="font-display text-lg text-amber-200">
                  {recentMatches.length}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Find game */}
        <Card className="overflow-hidden rounded-[28px] border-white/10 bg-slate-950/55 shadow-[0_25px_80px_rgba(0,0,0,0.35)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-red-400" />
              Szukaj gry
            </CardTitle>
            <CardDescription>
              Dołącz do kolejki i walcz o dominację na mapie
            </CardDescription>
          </CardHeader>
          <CardContent>
            {inQueue ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Image
                    src="/assets/match_making/circle291.webp"
                    alt=""
                    width={42}
                    height={42}
                    className="h-10 w-10 animate-spin object-contain"
                  />
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-yellow-400" />
                    <span>Szukam przeciwnika...</span>
                    <Badge className="border-0 bg-white/10 text-slate-200 hover:bg-white/10">
                      {playersInQueue} w kolejce
                    </Badge>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={leaveQueue}
                  className="rounded-full"
                >
                  Anuluj
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm leading-6 text-slate-400">
                  Kolejka ma byc glowne CTA dashboardu, nie maly guzik schowany
                  w jednej z kart.
                </div>
                <Button
                  size="lg"
                  className="h-11 gap-2 rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] px-6 font-display uppercase tracking-[0.2em] text-slate-950"
                  onClick={joinQueue}
                >
                  <Search className="h-5 w-5" />
                  Szukaj gry
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Profile */}
          <Card className="rounded-[24px] border-white/10 bg-slate-950/55">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-blue-400" />
                Profil
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-zinc-400">Nazwa</span>
                <span>{user.username}</span>
              </div>
              <Separator className="bg-zinc-800" />
              <div className="flex justify-between">
                <span className="text-zinc-400">Email</span>
                <span>{user.email}</span>
              </div>
              <Separator className="bg-zinc-800" />
              <div className="flex justify-between">
                <span className="text-zinc-400">ELO</span>
                <span className="font-bold text-yellow-400">
                  {user.elo_rating}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Recent matches */}
          <Card className="rounded-[24px] border-white/10 bg-slate-950/55">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-yellow-400" />
                Ostatnie mecze
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentMatches.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Brak rozegranych meczy
                </p>
              ) : (
                <div className="space-y-2">
                  {recentMatches.slice(0, 5).map((match) => (
                    <div
                      key={match.id}
                      className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"
                    >
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            match.status === "finished"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {match.status}
                        </Badge>
                        <span className="text-sm text-zinc-400">
                          {match.players.length} graczy
                        </span>
                      </div>
                      {match.status === "in_progress" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            router.push(`/game/${match.id}`)
                          }
                        >
                          Wróć do gry
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
