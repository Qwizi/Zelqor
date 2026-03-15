"use client";

import { useAuth } from "@/hooks/useAuth";
import { useMatchmaking } from "@/hooks/useMatchmaking";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getMyMatches,
  getConfig,
  getMyDecks,
  startTutorial,
  type Match,
  type GameModeListItem,
  type DeckOut,
} from "@/lib/api";
import { loadAssetOverrides } from "@/lib/assetOverrides";
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
    fillBots, setFillBots, instantBot, setInstantBot, joinQueue, leaveQueue,
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
    Promise.all([getConfig(), loadAssetOverrides()])
      .then(([cfg]) => {
        setGameModes(cfg.game_modes);
        const def = cfg.game_modes.find((m) => m.is_default);
        if (def) setSelectedMode((p) => p ?? def.slug);
      })
      .catch(() => {});
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

  // ── GSAP entrance animations (must be before conditional returns) ──
  const containerRef = useRef<HTMLDivElement>(null);
  const currentMode = gameModes.find((m) => m.slug === selectedMode);
  const selectedDeck = decks.find((d) => d.id === selectedDeckId);
  const wins = recentMatches.filter((m) => m.status === "finished" && m.winner_id === user?.id).length;
  const finished = recentMatches.filter((m) => m.status === "finished").length;
  const winRate = finished > 0 ? Math.round((wins / finished) * 100) : 0;

  // mountId changes only on component mount (page navigation), not on polling
  const [mountId] = useState(() => Math.random());

  useGSAP(() => {
    if (!containerRef.current || !user) return;

    // Staggered entrance for stat cards
    gsap.fromTo("[data-animate='stat']",
      { y: 24, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.5, stagger: 0.1, ease: "power2.out" }
    );

    // Counter animation for stat numbers
    containerRef.current.querySelectorAll("[data-counter]").forEach((el) => {
      const target = parseInt(el.getAttribute("data-counter") || "0", 10);
      const obj = { val: 0 };
      gsap.to(obj, {
        val: target,
        duration: 1.2,
        ease: "power2.out",
        onUpdate: () => {
          el.textContent = Math.round(obj.val).toString() + (el.getAttribute("data-suffix") || "");
        },
      });
    });

    // Shortcut cards entrance
    gsap.fromTo("[data-animate='shortcut']",
      { y: 16, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.4, stagger: 0.08, delay: 0.3, ease: "power2.out" }
    );

    // Main cards slide up
    gsap.fromTo("[data-animate='main-card']",
      { y: 30, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.6, delay: 0.2, ease: "power2.out" }
    );

    // Table rows stagger
    gsap.fromTo("[data-animate='table-row']",
      { x: -16, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.3, stagger: 0.06, delay: 0.5, ease: "power2.out" }
    );
  }, { scope: containerRef, dependencies: [mountId, !!user] });

  if (authLoading || !user) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="space-y-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">Strona główna</p>
        <h1 className="font-display text-4xl sm:text-5xl text-foreground">Graj</h1>
      </div>

      {/* ═══ STATYSTYKI ═══ */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card data-animate="stat" className="rounded-2xl">
          <CardContent className="flex flex-col gap-2 p-5">
            <div className="flex items-center gap-2.5">
              <Trophy className="h-5 w-5 text-accent" />
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">ELO</span>
            </div>
            <div data-counter={user.elo_rating} className="font-display text-4xl tabular-nums text-accent">0</div>
          </CardContent>
        </Card>
        <Card data-animate="stat" className="rounded-2xl">
          <CardContent className="flex flex-col gap-2 p-5">
            <div className="flex items-center gap-2.5">
              <Crown className="h-5 w-5 text-primary" />
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">Win Rate</span>
            </div>
            <div data-counter={winRate} data-suffix="%" className="font-display text-4xl tabular-nums text-foreground">0%</div>
          </CardContent>
        </Card>
        <Card data-animate="stat" className="rounded-2xl">
          <CardContent className="flex flex-col gap-2 p-5">
            <div className="flex items-center gap-2.5">
              <Swords className="h-5 w-5 text-primary" />
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">Mecze</span>
            </div>
            <div data-counter={finished} className="font-display text-4xl tabular-nums text-foreground">0</div>
          </CardContent>
        </Card>
        <Card data-animate="stat" className="rounded-2xl">
          <CardContent className="flex flex-col gap-2 p-5">
            <div className="flex items-center gap-2.5">
              <Shield className="h-5 w-5 text-primary" />
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">Wygrane</span>
            </div>
            <div data-counter={wins} className="font-display text-4xl tabular-nums text-foreground">0</div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ SZYBKIE SKRÓTY ═══ */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { href: "/inventory", icon: Backpack, label: "Ekwipunek", desc: "Twoje przedmioty", color: "text-primary" },
          { href: "/decks", icon: Layers, label: "Talia", desc: "Zarządzaj talią", color: "text-primary" },
          { href: "/marketplace", icon: Store, label: "Rynek", desc: "Kupuj i sprzedawaj", color: "text-primary" },
          { href: "/crafting", icon: Hammer, label: "Kuźnia", desc: "Twórz przedmioty", color: "text-accent" },
          
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            data-animate="shortcut"
            className="cursor-target group rounded-2xl border border-border bg-card p-6 transition-all hover:border-border/50 hover:bg-muted"
          >
            <item.icon className={`h-8 w-8 ${item.color}`} />
            <p className="mt-4 text-lg font-bold text-card-foreground group-hover:text-foreground transition-colors">{item.label}</p>
            <p className="mt-1 text-base text-muted-foreground">{item.desc}</p>
          </Link>
        ))}
      </div>

      {/* ═══ AKTYWNY MECZ ═══ */}
      {activeMatch && (
        <Card className="rounded-2xl border-primary/30">
          <CardContent className="flex flex-col items-center gap-6 p-8 text-center">
            <div className="h-4 w-4 animate-pulse rounded-full bg-primary" />
            <h2 className="font-display text-3xl text-foreground">Mecz w toku</h2>
            <Button
              size="lg"
              className="h-14 gap-3 rounded-2xl bg-primary px-10 font-display text-lg uppercase tracking-wider text-primary-foreground hover:bg-primary/90 transition-all"
              onClick={() => router.push(`/game/${activeMatch.id}`)}
            >
              <Shield className="h-6 w-6" />
              Wróć do gry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ═══ TRYB GRY ═══ */}
      {!activeMatch && (
        <Card data-animate="main-card" className={`rounded-2xl ${inQueue ? "opacity-50 pointer-events-none" : ""}`}>
          <CardContent className="p-6">
            <p className="mb-4 text-sm uppercase tracking-[0.2em] text-muted-foreground font-medium">Tryb gry</p>
            <div className="flex flex-wrap gap-3">
              {gameModes.map((mode) => {
                const sel = selectedMode === mode.slug;
                const Icon = MODE_ICONS[mode.slug] ?? Swords;
                return (
                  <button
                    key={mode.id}
                    onClick={() => setSelectedMode(mode.slug)}
                    disabled={inQueue}
                    className={`cursor-target flex items-center gap-3 rounded-2xl border-2 px-6 py-4 text-lg font-semibold transition-all ${
                      sel
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/30 hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-6 w-6" />
                    {mode.name}
                    <Badge variant="outline" className="text-xs">{mode.min_players === mode.max_players ? `${mode.max_players}P` : `${mode.min_players}-${mode.max_players}P`}</Badge>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ TALIA + PODGLĄD + BOTY + SZUKAJ ═══ */}
      {!activeMatch && (
        <Card data-animate="main-card" className="rounded-2xl">
          <CardContent className="p-6 space-y-6">
            {/* Wybór talii */}
            <div className={inQueue ? "opacity-40 pointer-events-none" : ""}>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground font-medium">Talia</p>
                <Link href="/decks" className="text-sm text-primary hover:text-primary/80 transition-colors">
                  Zarządzaj <ChevronRight className="inline h-4 w-4" />
                </Link>
              </div>
              {decks.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {decks.map((deck) => (
                    <button
                      key={deck.id}
                      onClick={() => setSelectedDeckId(deck.id)}
                      disabled={inQueue}
                      className={`cursor-target flex items-center gap-3 rounded-2xl border-2 px-6 py-4 text-base font-semibold transition-all ${
                        selectedDeckId === deck.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/30 hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <Layers className="h-5 w-5" />
                      {deck.name}
                      {deck.is_default && (
                        <Badge className="bg-accent/20 text-accent border-accent/30 text-xs">Domyślna</Badge>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <Link href="/decks" className="inline-flex items-center gap-2 rounded-2xl border-2 border-dashed border-border px-6 py-4 text-base text-muted-foreground hover:border-primary/30 hover:text-foreground transition-all">
                  <Layers className="h-5 w-5" />
                  Stwórz talię
                </Link>
              )}
            </div>

            {/* Podgląd wybranej talii */}
            {selectedDeck && selectedDeck.items.length > 0 && (
              <>
                <Separator />
                <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
                  {selectedDeck.items.map((di, i) => {
                    const rarity = di.item.rarity ?? "common";
                    const rarityBorder: Record<string, string> = {
                      common: "border-slate-500/30",
                      uncommon: "border-green-500/30",
                      rare: "border-blue-500/30",
                      epic: "border-purple-500/30",
                      legendary: "border-amber-500/30",
                    };
                    const lvlColor = (di.item.level ?? 1) >= 3 ? "text-accent" : (di.item.level ?? 1) === 2 ? "text-primary" : "text-muted-foreground";
                    return (
                      <div
                        key={`${di.item.slug}-${i}`}
                        className={`relative flex shrink-0 flex-col items-center rounded-xl border ${rarityBorder[rarity] ?? "border-border"} bg-secondary/50 px-3 py-3 w-20`}
                      >
                        <div className={`absolute -top-1.5 -right-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-bold ${lvlColor}`}>
                          {di.item.level}
                        </div>
                        <div className="flex h-10 w-10 items-center justify-center text-2xl">
                          {di.item.icon || "📦"}
                        </div>
                        <p className="mt-1.5 w-full truncate text-center text-[10px] font-medium leading-tight text-card-foreground">
                          {di.item.name.replace(/^(Pakiet|Blueprint|Bonus): ?/, "")}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <Separator />

            {/* Przeciwnicy */}
            <div className={inQueue ? "opacity-40 pointer-events-none" : ""}>
              <p className="mb-4 text-sm uppercase tracking-[0.2em] text-muted-foreground font-medium">Przeciwnicy</p>
              <div className="grid grid-cols-3 gap-3">
                {([
                  { value: 0, label: "Bez botów", desc: "Czekaj na graczy", icon: Users },
                  { value: 1, label: "Dołącz boty", desc: "Boty po 30s", icon: Bot },
                  { value: 2, label: "Instant bot", desc: "Graj od razu", icon: Bot },
                ] as const).map(({ value, label, desc, icon: BotIcon }) => {
                  const botMode = instantBot ? 2 : fillBots ? 1 : 0;
                  const active = botMode === value;
                  return (
                    <button
                      key={value}
                      disabled={inQueue}
                      onClick={() => {
                        setFillBots(value >= 1);
                        setInstantBot(value === 2);
                      }}
                      className={`cursor-target flex flex-col items-center gap-2 rounded-2xl border-2 p-5 text-center transition-all ${
                        active
                          ? value === 2
                            ? "border-accent bg-accent/10 text-accent"
                            : value === 1
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-foreground/40 bg-secondary text-foreground"
                          : "border-border/60 bg-secondary/30 text-muted-foreground hover:border-foreground/20 hover:bg-secondary hover:text-foreground"
                      } ${inQueue ? "cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <BotIcon className="h-7 w-7" />
                      <p className="text-base font-semibold">{label}</p>
                      <p className={`text-xs ${active ? "opacity-70" : "text-muted-foreground"}`}>{desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <Separator />

            {/* Szukaj / Anuluj */}
            <div className="space-y-3">
              {inQueue && (
                <div className="flex items-center justify-center gap-4 text-lg text-foreground py-2">
                  <span className="font-bold text-xl">{playersInQueue} w kolejce</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-medium">{currentMode?.name ?? "Tryb domyślny"}</span>
                  {fillBots && queueSeconds < 30 && (
                    <span className="text-accent font-bold text-xl">Boty za {30 - queueSeconds}s</span>
                  )}
                  {fillBots && queueSeconds >= 30 && (
                    <span className="text-primary font-bold text-xl animate-pulse">Boty dołączają...</span>
                  )}
                </div>
              )}
              {inQueue ? (
                <Button
                  size="lg"
                  className="cursor-target h-16 w-full gap-4 rounded-2xl bg-destructive font-display text-xl uppercase tracking-wider text-white hover:bg-destructive/90"
                  onClick={leaveQueue}
                >
                  <Loader2 className="h-7 w-7 animate-spin" />
                  <span className="tabular-nums text-2xl">{Math.floor(queueSeconds / 60)}:{String(queueSeconds % 60).padStart(2, "0")}</span>
                  · Anuluj
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="cursor-target h-16 w-full gap-3 rounded-2xl bg-primary font-display text-xl uppercase tracking-wider text-primary-foreground hover:bg-primary/90"
                  onClick={() => joinQueue(selectedMode ?? undefined)}
                  disabled={!selectedMode}
                >
                  <Search className="h-7 w-7" />
                  Szukaj gry
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ SAMOUCZEK ═══ */}
      {!user.tutorial_completed && !activeMatch && !inQueue && (
        <button
          onClick={handleStartTutorial}
          disabled={tutorialLoading}
          className="flex w-full items-center gap-5 rounded-2xl border border-accent/20 bg-accent/5 p-5 text-left transition-all hover:border-accent/35 hover:bg-accent/10"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/15">
            <GraduationCap className="h-6 w-6 text-accent" />
          </div>
          <div className="flex-1">
            <p className="text-base font-medium text-foreground">Samouczek</p>
            <p className="text-sm text-muted-foreground">Naucz się podstaw w krótkiej rozgrywce treningowej</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>
      )}

      {/* ═══ OSTATNIE MECZE ═══ */}
      {recentMatches.length > 0 && (
        <Card className="rounded-2xl overflow-hidden">
          <div className="px-6 pt-5 pb-2">
            <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground font-medium">Ostatnie mecze</p>
          </div>
          <Table className="text-base">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-14 pl-6 text-base font-semibold">Status</TableHead>
                  <TableHead className="h-14 text-base font-semibold">Gracze</TableHead>
                  <TableHead className="h-14 text-base font-semibold">Tryb</TableHead>
                  <TableHead className="h-14 text-base font-semibold">Czas</TableHead>
                  <TableHead className="h-14 text-base font-semibold text-right pr-6">Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
            {recentMatches.slice(0, 8).map((match) => {
              const isActive = match.status === "in_progress" || match.status === "selecting";
              const isWinner = match.winner_id === user.id;
              const myPlayer = match.players.find((p) => p.user_id === user.id);
              const isLoss = match.status === "finished" && !isWinner && myPlayer && !myPlayer.is_alive;
              const date = new Date(match.finished_at ?? match.started_at ?? match.created_at);
              const startDate = match.started_at ? new Date(match.started_at) : null;
              const endDate = match.finished_at ? new Date(match.finished_at) : null;
              const durationMin = startDate && endDate ? Math.round((endDate.getTime() - startDate.getTime()) / 60000) : null;

              return (
                <TableRow
                  key={match.id}
                  data-animate="table-row"
                  className="cursor-target cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(isActive ? `/game/${match.id}` : `/match/${match.id}`)}
                >
                  <TableCell className="pl-6 py-5">
                    {isActive ? (
                      <Badge className="border-0 bg-primary/20 text-base px-3 py-1 text-primary hover:bg-primary/20">
                        <div className="h-2 w-2 rounded-full bg-primary animate-pulse mr-2" />Live
                      </Badge>
                    ) : isWinner ? (
                      <Badge className="border-0 bg-accent/15 text-base px-3 py-1 text-accent hover:bg-accent/15">
                        <Crown className="mr-1.5 h-4 w-4" />Wygrana
                      </Badge>
                    ) : isLoss ? (
                      <Badge variant="destructive" className="border-0 bg-destructive/15 text-base px-3 py-1 text-destructive hover:bg-destructive/15">Przegrana</Badge>
                    ) : (
                      <Badge variant="outline" className="text-base px-3 py-1 text-muted-foreground">
                        {match.status === "cancelled" ? "Anulowany" : match.status === "finished" ? "Zakończony" : match.status}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="py-5">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        {match.players.map((p) => (
                          <div key={p.id} className="h-6 w-6 rounded" style={{ backgroundColor: p.color, opacity: !p.is_alive && match.status === "finished" ? 0.3 : 1 }} title={p.username} />
                        ))}
                      </div>
                      <span className="text-muted-foreground">{match.players.length} graczy</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-5 text-muted-foreground">
                    {match.max_players <= 2 ? "1v1" : `${match.max_players}P`}
                  </TableCell>
                  <TableCell className="py-5 tabular-nums text-muted-foreground">
                    {durationMin != null ? `${durationMin} min` : isActive ? "W toku" : "—"}
                  </TableCell>
                  <TableCell className="py-5 pr-6 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="tabular-nums text-foreground">{date.toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
              </TableBody>
            </Table>
        </Card>
      )}
    </div>
  );
}
