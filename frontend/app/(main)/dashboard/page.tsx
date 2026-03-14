"use client";

import { useAuth } from "@/hooks/useAuth";
import { useMatchmaking } from "@/hooks/useMatchmaking";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getMyMatches,
  getConfig,
  getMyDecks,
  startTutorial,
  type Match,
  type GameModeListItem,
  type DeckOut,
} from "@/lib/api";
import {
  Swords,
  Users,
  Zap,
  Settings2,
  Shield,
  Search,
  Crown,
  ChevronRight,
  GraduationCap,
  Layers,
  Loader2,
  Bot,
  X,
  Backpack,
  Store,
  Hammer,
  Trophy,
} from "lucide-react";

const MODE_ICONS: Record<string, typeof Users> = {
  "standard-1v1": Swords,
  "standard-3p": Users,
  "standard-4p": Users,
  "blitz-1v1": Zap,
  custom: Settings2,
};

export default function DashboardPage() {
  const { user, loading: authLoading, refreshUser, token } = useAuth();
  const {
    inQueue, playersInQueue, matchId, activeMatchId,
    fillBots, setFillBots, joinQueue, leaveQueue,
  } = useMatchmaking();
  const router = useRouter();

  const [recentMatches, setRecentMatches] = useState<Match[]>([]);
  const [gameModes, setGameModes] = useState<GameModeListItem[]>([]);
  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [decks, setDecks] = useState<DeckOut[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [queueSeconds, setQueueSeconds] = useState(0);
  const [tutorialLoading, setTutorialLoading] = useState(false);

  const activeMatch = recentMatches.find(
    (m) =>
      (m.status === "selecting" || m.status === "in_progress") &&
      m.players.some((p) => p.user_id === user?.id && p.is_alive)
  ) ?? null;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!token) return;
    const load = () => {
      refreshUser().catch(() => {});
      getMyMatches(token, 5).then((r) => setRecentMatches(r.items)).catch(() => {});
    };
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [token, refreshUser]);

  useEffect(() => {
    getConfig().then((cfg) => {
      setGameModes(cfg.game_modes);
      const def = cfg.game_modes.find((m) => m.is_default);
      if (def) setSelectedMode((p) => p ?? def.slug);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!token) return;
    getMyDecks(token).then((r) => {
      setDecks(r.items);
      const def = r.items.find((d) => d.is_default);
      if (def) setSelectedDeckId((p) => p ?? def.id);
    }).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!inQueue) return;
    const t0 = Date.now();
    const id = setInterval(() => setQueueSeconds(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => { clearInterval(id); setQueueSeconds(0); };
  }, [inQueue]);

  useEffect(() => { if (matchId) router.push(`/game/${matchId}`); }, [matchId, router]);
  useEffect(() => { if (activeMatchId) router.push(`/game/${activeMatchId}`); }, [activeMatchId, router]);

  const handleStartTutorial = async () => {
    if (!token || tutorialLoading) return;
    setTutorialLoading(true);
    try {
      const r = await startTutorial(token);
      router.push(`/game/${r.match_id}`);
    } catch { setTutorialLoading(false); }
  };

  if (authLoading || !user) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
      </div>
    );
  }

  const currentMode = gameModes.find((m) => m.slug === selectedMode);
  const selectedDeck = decks.find((d) => d.id === selectedDeckId);
  const wins = recentMatches.filter((m) => m.status === "finished" && m.winner_id === user.id).length;
  const finished = recentMatches.filter((m) => m.status === "finished").length;
  const winRate = finished > 0 ? Math.round((wins / finished) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Strona główna</p>
        <h1 className="font-display text-3xl text-zinc-50">Graj</h1>
      </div>

      {/* ═══ STATYSTYKI — kompaktowy pasek ═══ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-400" />
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">ELO</span>
          </div>
          <div className="mt-1 font-display text-2xl tabular-nums text-amber-200">{user.elo_rating}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-emerald-400" />
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Win Rate</span>
          </div>
          <div className="mt-1 font-display text-2xl tabular-nums text-zinc-50">{winRate}%</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-cyan-400" />
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Mecze</span>
          </div>
          <div className="mt-1 font-display text-2xl tabular-nums text-zinc-50">{finished}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-cyan-300" />
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Wygrane</span>
          </div>
          <div className="mt-1 font-display text-2xl tabular-nums text-emerald-300">{wins}</div>
        </div>
      </div>

      {/* ═══ SZUKAJ GRY ═══ */}
      <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        {activeMatch ? (
          /* Aktywny mecz — osobny stan */
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="h-3 w-3 animate-pulse rounded-full bg-emerald-400" />
            <h2 className="font-display text-2xl text-zinc-50">Mecz w toku</h2>
            <Button
              size="lg"
              className="h-12 gap-2 rounded-xl border border-cyan-300/40 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] px-8 font-display text-base uppercase tracking-wider text-slate-950 hover:opacity-90 transition-all"
              onClick={() => router.push(`/game/${activeMatch.id}`)}
            >
              <Shield className="h-5 w-5" />
              Wróć do gry
            </Button>
          </div>
        ) : (
          /* Konfigurator + szukanie — jeden widok, disabled gdy w kolejce */
          <div className="space-y-5">
            {/* Tryb gry */}
            <div className={inQueue ? "pointer-events-none opacity-40" : ""}>
              <p className="mb-2 text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Tryb gry</p>
              <div className="flex flex-wrap gap-2">
                {gameModes.map((mode) => {
                  const sel = selectedMode === mode.slug;
                  const Icon = MODE_ICONS[mode.slug] ?? Swords;
                  return (
                    <button
                      key={mode.id}
                      onClick={() => setSelectedMode(mode.slug)}
                      disabled={inQueue}
                      className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
                        sel
                          ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.1)]"
                          : "border-white/10 text-slate-400 hover:border-white/25 hover:bg-white/[0.08] hover:text-zinc-100"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {mode.name}
                      <span className="text-[11px] text-slate-400">
                        {mode.min_players === mode.max_players ? `${mode.max_players}P` : `${mode.min_players}-${mode.max_players}P`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Talia + opcje */}
            <div className={`flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${inQueue ? "pointer-events-none opacity-40" : ""}`}>
              <div className="flex flex-col gap-3">
                <div>
                  <p className="mb-1.5 text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Talia</p>
                  {decks.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {decks.map((deck) => (
                        <button
                          key={deck.id}
                          onClick={() => setSelectedDeckId(deck.id)}
                          disabled={inQueue}
                          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                            selectedDeckId === deck.id
                              ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-200"
                              : "border-white/10 text-slate-400 hover:border-white/25 hover:bg-white/[0.08] hover:text-zinc-100"
                          }`}
                        >
                          <Layers className="h-3 w-3" />
                          {deck.name}
                          {deck.is_default && <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">dom.</span>}
                        </button>
                      ))}
                      <Link href="/decks" className="flex items-center gap-1 rounded-lg border border-dashed border-white/10 px-3 py-1.5 text-xs text-slate-500 hover:border-white/25 hover:text-slate-300 transition-all">
                        Edytuj
                      </Link>
                    </div>
                  ) : (
                    <Link href="/decks" className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-white/15 px-3 py-1.5 text-xs text-slate-400 hover:border-white/30 hover:text-slate-200 transition-all">
                      <Layers className="h-3 w-3" />
                      Stwórz talię
                    </Link>
                  )}
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors">
                  <input type="checkbox" checked={fillBots} onChange={(e) => setFillBots(e.target.checked)} disabled={inQueue} className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 accent-cyan-400" />
                  <Bot className="h-3 w-3" />
                  Wypełnij botami
                </label>
              </div>

              {/* ── Przycisk szukaj / anuluj (ten sam slot) ── */}
              <div className="flex flex-col items-start gap-2 sm:items-end pointer-events-auto opacity-100">
                {inQueue ? (
                  <>
                    {/* Timer + loader */}
                    <div className="flex items-center gap-3 mb-1">
                      <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
                      <div className="text-right">
                        <p className="font-display text-lg tabular-nums text-zinc-50">
                          {Math.floor(queueSeconds / 60)}:{String(queueSeconds % 60).padStart(2, "0")}
                        </p>
                        <p className="text-[11px] text-slate-300">
                          {playersInQueue} w kolejce · {currentMode?.name ?? "Tryb domyślny"}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="lg"
                      className="h-12 gap-2 rounded-xl border border-red-400 bg-red-500 px-10 font-display text-base uppercase tracking-wider text-white shadow-[0_0_20px_rgba(239,68,68,0.3)] hover:bg-red-600 hover:shadow-[0_0_28px_rgba(239,68,68,0.4)] transition-all"
                      onClick={leaveQueue}
                    >
                      <X className="h-5 w-5" />
                      Anuluj szukanie
                    </Button>
                  </>
                ) : (
                  <Button
                    size="lg"
                    className="h-12 gap-2 rounded-xl border border-cyan-300/40 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] px-10 font-display text-base uppercase tracking-wider text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.15)] hover:opacity-90 hover:shadow-[0_0_28px_rgba(34,211,238,0.25)] transition-all"
                    onClick={() => joinQueue(selectedMode ?? undefined)}
                    disabled={!selectedMode}
                  >
                    <Search className="h-5 w-5" />
                    Szukaj gry
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ═══ PODGLĄD TALII — karty ═══ */}
      {selectedDeck && selectedDeck.items.length > 0 && !inQueue && !activeMatch && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-cyan-400" />
              <span className="text-sm font-medium text-zinc-200">{selectedDeck.name}</span>
              {selectedDeck.is_default && <Badge className="border-0 bg-amber-500/20 text-[10px] text-amber-300 hover:bg-amber-500/20">Domyślna</Badge>}
            </div>
            <Link href="/decks" className="text-[11px] text-cyan-400 hover:text-cyan-300 transition-colors">
              Edytuj talię <ChevronRight className="inline h-3 w-3" />
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {selectedDeck.items.map((di, i) => {
              const rarity = di.item.rarity ?? "common";
              const rarityBorder: Record<string, string> = {
                common: "border-slate-500/30",
                uncommon: "border-green-500/30",
                rare: "border-blue-500/40",
                epic: "border-purple-500/40",
                legendary: "border-amber-500/50",
              };
              const rarityGlow: Record<string, string> = {
                common: "",
                uncommon: "",
                rare: "shadow-blue-500/10",
                epic: "shadow-purple-500/15",
                legendary: "shadow-amber-500/20",
              };
              const rarityBg: Record<string, string> = {
                common: "from-slate-500/5 to-slate-800/10",
                uncommon: "from-green-500/5 to-green-900/10",
                rare: "from-blue-500/8 to-blue-900/15",
                epic: "from-purple-500/8 to-purple-900/15",
                legendary: "from-amber-500/10 to-amber-900/20",
              };
              const lvlColor = di.item.level >= 3 ? "text-amber-300 bg-amber-500/20" : di.item.level === 2 ? "text-cyan-300 bg-cyan-500/20" : "text-slate-400 bg-white/[0.06]";

              return (
                <div
                  key={i}
                  className={`group relative flex w-24 shrink-0 flex-col items-center rounded-xl border bg-gradient-to-b p-3 transition-all hover:-translate-y-1 hover:shadow-lg ${rarityBorder[rarity] ?? rarityBorder.common} ${rarityBg[rarity] ?? rarityBg.common} ${rarityGlow[rarity] ?? ""}`}
                >
                  {/* Lvl badge */}
                  <div className={`absolute -top-1.5 -right-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-bold ${lvlColor}`}>
                    {di.item.level}
                  </div>
                  {/* Icon */}
                  <div className="flex h-12 w-12 items-center justify-center text-3xl">
                    {di.item.icon || "📦"}
                  </div>
                  {/* Name */}
                  <p className="mt-2 w-full truncate text-center text-[10px] font-medium leading-tight text-zinc-300">
                    {di.item.name.replace(/^(Pakiet|Blueprint|Bonus): ?/, "")}
                  </p>
                  {/* Quantity */}
                  {di.quantity > 1 && (
                    <span className="mt-1 text-[10px] text-slate-400">×{di.quantity}</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══ SAMOUCZEK ═══ */}
      {!user.tutorial_completed && !activeMatch && !inQueue && (
        <button
          onClick={handleStartTutorial}
          disabled={tutorialLoading}
          className="flex w-full items-center gap-4 rounded-2xl border border-amber-300/20 bg-amber-500/[0.05] p-4 text-left transition-all hover:border-amber-300/35 hover:bg-amber-500/[0.10]"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/15">
            <GraduationCap className="h-5 w-5 text-amber-200" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-zinc-100">Samouczek</p>
            <p className="text-xs text-slate-400">Naucz się podstaw w krótkiej rozgrywce treningowej</p>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-400" />
        </button>
      )}

      {/* ═══ SZYBKIE SKRÓTY ═══ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { href: "/inventory", icon: Backpack, label: "Ekwipunek", desc: "Twoje przedmioty", color: "text-cyan-400" },
          { href: "/marketplace", icon: Store, label: "Rynek", desc: "Kupuj i sprzedawaj", color: "text-emerald-400" },
          { href: "/crafting", icon: Hammer, label: "Kuźnia", desc: "Twórz przedmioty", color: "text-amber-400" },
          { href: "/decks", icon: Layers, label: "Talia", desc: "Zarządzaj talią", color: "text-violet-400" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group rounded-2xl border border-white/10 bg-slate-950/55 p-4 backdrop-blur-xl transition-all hover:border-white/25 hover:bg-white/[0.08]"
          >
            <item.icon className={`h-5 w-5 ${item.color}`} />
            <p className="mt-2 text-sm font-medium text-zinc-200 group-hover:text-zinc-50 transition-colors">{item.label}</p>
            <p className="text-[11px] text-slate-400">{item.desc}</p>
          </Link>
        ))}
      </div>

      {/* ═══ OSTATNIE MECZE ═══ */}
      {recentMatches.length > 0 && (
        <section>
          <p className="mb-3 text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Ostatnie mecze</p>
          <div className="space-y-1.5">
            {recentMatches.slice(0, 5).map((match) => {
              const isActive = match.status === "in_progress" || match.status === "selecting";
              const isWinner = match.winner_id === user.id;
              const myPlayer = match.players.find((p) => p.user_id === user.id);
              const isLoss = match.status === "finished" && !isWinner && myPlayer && !myPlayer.is_alive;
              const date = new Date(match.finished_at ?? match.started_at ?? match.created_at);

              return (
                <Link
                  key={match.id}
                  href={isActive ? `/game/${match.id}` : `/match/${match.id}`}
                  className={`group flex items-center gap-3 rounded-xl border px-4 py-2.5 transition-all ${
                    isActive
                      ? "border-cyan-400/20 bg-cyan-400/5 hover:border-cyan-400/40 hover:bg-cyan-400/10"
                      : "border-white/10 hover:border-white/20 hover:bg-white/[0.06]"
                  }`}
                >
                  <div className="w-20 shrink-0">
                    {isActive ? (
                      <Badge className="border-0 bg-emerald-500/20 text-[10px] text-emerald-300 hover:bg-emerald-500/20">Live</Badge>
                    ) : isWinner ? (
                      <Badge className="border-0 bg-amber-400/15 text-[10px] text-amber-200 hover:bg-amber-400/15"><Crown className="mr-0.5 h-2.5 w-2.5" />Wygrana</Badge>
                    ) : isLoss ? (
                      <Badge className="border-0 bg-red-400/15 text-[10px] text-red-300 hover:bg-red-400/15">Przegrana</Badge>
                    ) : (
                      <span className="text-[10px] text-slate-400">{match.status === "cancelled" ? "Anulowany" : match.status}</span>
                    )}
                  </div>
                  <div className="flex gap-0.5">
                    {match.players.map((p) => (
                      <div key={p.id} className="h-4 w-4 rounded-sm" style={{ backgroundColor: p.color, opacity: !p.is_alive && match.status === "finished" ? 0.3 : 1 }} title={p.username} />
                    ))}
                  </div>
                  <span className="flex-1 text-xs text-slate-400">{match.players.length}P</span>
                  <span className="text-[11px] tabular-nums text-slate-400">{date.toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-500 group-hover:text-slate-300 transition-colors" />
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
