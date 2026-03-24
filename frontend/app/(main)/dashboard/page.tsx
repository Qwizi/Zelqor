"use client";

import { useGSAP } from "@gsap/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConfig, useFriends, useMyDecks, useMyMatches, useReceivedRequests } from "@/hooks/queries";
import { useAuth } from "@/hooks/useAuth";
import { useChat } from "@/hooks/useChat";
import { useMatchmaking } from "@/hooks/useMatchmaking";
import {
  type DeckOut,
  type FriendshipOut,
  type FriendUser,
  type GameModeListItem,
  inviteFriendToGame,
  type Match,
  startTutorial,
} from "@/lib/api";

function activityDot(status: string): string {
  switch (status) {
    case "in_game":
      return "bg-accent";
    case "in_queue":
      return "bg-yellow-500";
    case "online":
      return "bg-green-500";
    default:
      return "bg-muted-foreground/30";
  }
}

function activityLabel(
  status: string,
  details?: { game_mode?: string; players_count?: number; started_at?: string },
): string {
  const mode = details?.game_mode;
  switch (status) {
    case "in_game": {
      const parts = ["W grze"];
      if (mode) parts.push(mode);
      if (details?.players_count) parts.push(`${details.players_count}P`);
      return parts.join(" · ");
    }
    case "in_queue":
      return mode ? `Szuka · ${mode}` : "W kolejce";
    case "online":
      return "Online";
    default:
      return "Offline";
  }
}

import {
  Backpack,
  Bell,
  Bot,
  ChevronRight,
  Crown,
  Eye,
  GraduationCap,
  Hammer,
  Layers,
  Loader2,
  MessageSquare,
  Search,
  Settings2,
  Shield,
  Store,
  Swords,
  Trophy,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardSkeleton } from "@/components/skeletons/DashboardSkeleton";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { countUp } from "@/lib/animations";
import { loadAssetOverrides } from "@/lib/assetOverrides";
import { cn } from "@/lib/utils";

const MODE_ICONS: Record<string, typeof Users> = {
  "standard-1v1": Swords,
  "standard-3p": Users,
  "standard-4p": Users,
  "blitz-1v1": Zap,
  custom: Settings2,
};

export default function DashboardPage() {
  const { user, loading: authLoading, token } = useAuth();
  const {
    inQueue,
    playersInQueue,
    matchId,
    activeMatchId,
    queueSeconds,
    fillBots,
    setFillBots,
    instantBot,
    setInstantBot,
    joinQueue,
    leaveQueue,
    lobbyId,
  } = useMatchmaking();
  const router = useRouter();
  const { showPrompt, subscribe, dismiss } = usePushNotifications(true);
  const { openDMTab } = useChat();

  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [tutorialLoading, setTutorialLoading] = useState(false);

  const { data: configData } = useConfig();
  const { data: matchesData } = useMyMatches(5, undefined, { refetchInterval: 10_000 });
  const { data: decksData } = useMyDecks();
  const { data: friendsData } = useFriends(100, undefined, { refetchInterval: 15_000 });
  const { data: receivedData } = useReceivedRequests(1, undefined, { refetchInterval: 15_000 });

  const gameModes = useMemo<GameModeListItem[]>(
    () => (configData?.game_modes ?? []).filter((m) => m.slug !== "clan-war"),
    [configData],
  );
  const recentMatches = useMemo<Match[]>(() => matchesData?.items ?? [], [matchesData]);
  const decks = useMemo<DeckOut[]>(() => decksData?.items ?? [], [decksData]);
  const friends = useMemo<FriendshipOut[]>(() => {
    const items = friendsData?.items ?? [];
    return [...items].sort((a, b) => {
      const order: Record<string, number> = { in_game: 0, in_queue: 1, online: 2, offline: 3 };
      const friendA = a.from_user.id === user?.id ? a.to_user : a.from_user;
      const friendB = b.from_user.id === user?.id ? b.to_user : b.from_user;
      return (order[friendA.activity_status] ?? 3) - (order[friendB.activity_status] ?? 3);
    });
  }, [friendsData, user?.id]);
  const pendingCount = receivedData?.count ?? 0;

  const activeMatch =
    recentMatches.find(
      (m) =>
        (m.status === "selecting" || m.status === "in_progress") &&
        m.players.some((p) => p.user_id === user?.id && p.is_alive),
    ) ?? null;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    loadAssetOverrides().catch(() => {});
  }, []);

  useEffect(() => {
    if (gameModes.length > 0) {
      setSelectedMode((prev) => prev ?? gameModes.find((m) => m.is_default)?.slug ?? null);
    }
  }, [gameModes]);

  useEffect(() => {
    if (decks.length > 0) {
      setSelectedDeckId((prev) => prev ?? decks.find((d) => d.is_default)?.id ?? null);
    }
  }, [decks]);

  useEffect(() => {
    if (matchId) router.push(`/game/${matchId}`);
  }, [matchId, router]);
  useEffect(() => {
    if (activeMatchId) router.push(`/game/${activeMatchId}`);
  }, [activeMatchId, router]);

  const handleStartTutorial = async () => {
    if (!token || tutorialLoading) return;
    setTutorialLoading(true);
    try {
      const r = await startTutorial(token);
      router.push(`/game/${r.match_id}`);
    } catch {
      setTutorialLoading(false);
    }
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const currentMode = gameModes.find((m) => m.slug === selectedMode);
  const selectedDeck = decks.find((d) => d.id === selectedDeckId);
  const wins = user?.wins ?? 0;
  const finished = user?.matches_played ?? 0;
  const winRate = Math.round((user?.win_rate ?? 0) * 100);

  const [mountId] = useState(() => Math.random());

  useGSAP(
    () => {
      if (!containerRef.current || !user) return;

      containerRef.current.querySelectorAll("[data-counter]").forEach((el) => {
        const target = parseInt(el.getAttribute("data-counter") || "0", 10);
        const suffix = el.getAttribute("data-suffix") || "";
        countUp(el as HTMLElement, target, { suffix });
      });
    },
    { scope: containerRef, dependencies: [mountId, !!user, recentMatches.length] },
  );

  if (authLoading || !user) {
    return <DashboardSkeleton />;
  }

  const botMode = instantBot ? 2 : fillBots ? 1 : 0;

  return (
    <div ref={containerRef} className="animate-page-in space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* ═══ PUSH NOTIFICATION PROMPT ═══ */}
      {showPrompt && (
        <div className="mx-4 md:mx-0 flex items-center gap-3 rounded-xl border border-blue-400/20 bg-blue-500/10 px-4 py-3">
          <Bell className="h-5 w-5 shrink-0 text-blue-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Włącz powiadomienia</p>
            <p className="text-xs text-muted-foreground">Dostaniesz info gdy lobby się zapełni</p>
          </div>
          <button
            onClick={() => {
              subscribe();
            }}
            className="shrink-0 rounded-lg bg-blue-500/20 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500/30 transition-colors"
          >
            Włącz
          </button>
          <button onClick={dismiss} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ═══ HEADER ═══ */}
      <div className="px-4 md:px-0">
        <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">
          Strona główna
        </p>
        <h1 className="font-display text-2xl md:text-5xl text-foreground">
          <span className="md:hidden">Hej, {user.username}</span>
          <span className="hidden md:inline">Hej, {user.username}</span>
        </h1>
        <p className="hidden md:block mt-1 text-base text-muted-foreground">
          Gotowy na kolejną bitwę? Wybierz tryb i ruszaj na mapę.
        </p>
      </div>

      {/* ═══ STATS — horizontal scroll on mobile, grid on desktop ═══ */}
      <div className="animate-stagger flex gap-3 overflow-x-auto px-4 pb-1 md:px-0 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
        {[
          {
            icon: Trophy,
            label: "ELO",
            value: user.elo_rating,
            color: "text-accent",
            desktopIcon: "md:text-accent",
            key: "elo",
          },
          {
            icon: Crown,
            label: "Win Rate",
            value: winRate,
            suffix: "%",
            color: "text-foreground",
            desktopIcon: "md:text-primary",
            key: "wr",
          },
          {
            icon: Swords,
            label: "Mecze",
            value: finished,
            color: "text-foreground",
            desktopIcon: "md:text-primary",
            key: "m",
          },
          {
            icon: Shield,
            label: "Wygrane",
            value: wins,
            color: "text-foreground",
            desktopIcon: "md:text-primary",
            key: "w",
          },
        ].map((s) => (
          <div
            key={s.key}
            className="flex shrink-0 items-center gap-3 rounded-2xl bg-card/60 md:bg-card border border-transparent md:border-border px-4 py-3 md:px-4 md:py-3.5 md:flex-col md:items-start md:gap-1.5 min-w-[140px] md:min-w-0 hover-lift"
          >
            <div className="flex items-center gap-2 md:gap-2">
              <s.icon className={`h-4 w-4 text-muted-foreground ${s.desktopIcon}`} />
              <span className="text-[11px] md:text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-medium">
                {s.label}
              </span>
            </div>
            <div
              data-counter={s.value}
              data-suffix={s.suffix ?? ""}
              className={`font-display text-xl md:text-3xl tabular-nums ${s.color} ml-auto md:ml-0`}
            >
              0{s.suffix ?? ""}
            </div>
          </div>
        ))}
      </div>

      {/* ═══ ACTIVE MATCH ═══ */}
      {activeMatch && (
        <div className="px-4 md:px-0">
          <button
            onClick={() => router.push(`/game/${activeMatch.id}`)}
            className="flex w-full items-center gap-4 rounded-2xl bg-primary/10 border border-primary/20 md:border-primary/30 p-4 md:p-6 md:flex-row md:text-left transition-all active:scale-[0.98] hover:bg-primary/15 md:shadow-[0_0_20px_rgba(34,211,238,0.08)] md:hover:shadow-[0_0_30px_rgba(34,211,238,0.15)]"
          >
            <div className="h-3 w-3 md:h-4 md:w-4 animate-pulse rounded-full bg-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-display text-lg md:text-2xl text-foreground block">Mecz w toku</span>
              <span className="hidden md:block text-sm text-muted-foreground mt-0.5">
                {activeMatch.players.length} graczy · kliknij aby wrócić
              </span>
            </div>
            <ChevronRight className="h-5 w-5 text-primary md:hidden shrink-0" />
            <div className="hidden md:flex items-center gap-2 shrink-0 rounded-xl bg-primary/20 px-5 py-2.5 font-display text-base uppercase tracking-wider text-primary">
              <Shield className="h-5 w-5" />
              Wróć do gry
            </div>
          </button>
        </div>
      )}

      {/* ═══ GAME CONFIG — flat on mobile, cards on desktop ═══ */}
      {!activeMatch && (
        <div className="space-y-4 md:space-y-0 md:grid md:grid-cols-3 md:gap-6 md:items-stretch">
          {/* Game config cols (col-span-2 on desktop) */}
          <div className="md:col-span-2 md:space-y-6">
            {/* Mode selector — Card on desktop */}
            <div className={`px-4 md:px-0 ${inQueue ? "opacity-50 pointer-events-none" : ""}`}>
              <Card className="hidden md:block rounded-2xl">
                <CardContent className="p-5">
                  <p className="mb-3 text-sm uppercase tracking-[0.2em] text-muted-foreground font-medium">Tryb gry</p>
                  <div className="flex flex-wrap gap-3">
                    {gameModes.map((mode) => {
                      const sel = selectedMode === mode.slug;
                      const Icon = MODE_ICONS[mode.slug] ?? Swords;
                      return (
                        <button
                          key={mode.id}
                          onClick={() => setSelectedMode(mode.slug)}
                          disabled={inQueue}
                          className={`flex items-center gap-3 rounded-2xl border-2 px-6 py-4 text-lg font-semibold transition-all ${
                            sel
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-primary/30 hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          <Icon className="h-6 w-6" />
                          {mode.name}
                          <Badge variant="outline" className="text-xs">
                            {mode.min_players === mode.max_players
                              ? `${mode.max_players}P`
                              : `${mode.min_players}-${mode.max_players}P`}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
              {/* Mobile: flat pills */}
              <div className="md:hidden">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium mb-2.5">
                  Tryb gry
                </p>
                <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
                  {gameModes.map((mode) => {
                    const sel = selectedMode === mode.slug;
                    const Icon = MODE_ICONS[mode.slug] ?? Swords;
                    return (
                      <button
                        key={mode.id}
                        onClick={() => setSelectedMode(mode.slug)}
                        disabled={inQueue}
                        className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition-all ${
                          sel
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {mode.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Deck + Preview + Bots + CTA — Card on desktop, flat on mobile */}
            <div className="px-4 md:px-0">
              <Card className="hidden md:block rounded-2xl">
                <CardContent className="p-5 space-y-5">
                  {/* Deck selector */}
                  <div className={inQueue ? "opacity-50 pointer-events-none" : ""}>
                    <div className="flex items-center justify-between mb-3">
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
                            className={`flex items-center gap-3 rounded-2xl border-2 px-6 py-4 text-base font-semibold transition-all ${
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
                      <Link
                        href="/decks"
                        className="inline-flex items-center gap-2 rounded-2xl border-2 border-dashed border-border px-6 py-4 text-base text-muted-foreground hover:border-primary/30 hover:text-foreground transition-all"
                      >
                        <Layers className="h-5 w-5" />
                        Stwórz talię
                      </Link>
                    )}
                  </div>

                  {/* Deck preview */}
                  {selectedDeck && selectedDeck.items.length > 0 && (
                    <>
                      <div className="border-t border-border" />
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
                          const lvlColor =
                            (di.item.level ?? 1) >= 3
                              ? "text-accent"
                              : (di.item.level ?? 1) === 2
                                ? "text-primary"
                                : "text-muted-foreground";
                          return (
                            <div
                              key={`${di.item.slug}-${i}`}
                              className={`relative flex shrink-0 flex-col items-center rounded-xl border ${rarityBorder[rarity] ?? "border-border"} bg-secondary/50 px-3 py-3 w-20`}
                            >
                              <div
                                className={`absolute -top-1.5 -right-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-bold ${lvlColor}`}
                              >
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

                  <div className="border-t border-border" />

                  {/* Bots — desktop grid */}
                  <div className={inQueue ? "opacity-50 pointer-events-none" : ""}>
                    <p className="mb-3 text-sm uppercase tracking-[0.2em] text-muted-foreground font-medium">
                      Przeciwnicy
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      {(
                        [
                          { value: 0, label: "Bez botów", desc: "Czekaj na graczy", icon: Users },
                          { value: 1, label: "Dołącz boty", desc: "Boty po 30s", icon: Bot },
                          { value: 2, label: "Instant bot", desc: "Graj od razu", icon: Bot },
                        ] as const
                      ).map(({ value, label, desc, icon: BotIcon }) => {
                        const active = botMode === value;
                        return (
                          <button
                            key={value}
                            disabled={inQueue}
                            onClick={() => {
                              setFillBots(value >= 1);
                              setInstantBot(value === 2);
                            }}
                            className={`flex flex-col items-center gap-1.5 rounded-2xl border-2 px-4 py-3.5 text-center transition-all ${
                              active
                                ? value === 2
                                  ? "border-accent bg-accent/10 text-accent"
                                  : value === 1
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-foreground/40 bg-secondary text-foreground"
                                : "border-border/60 bg-secondary/30 text-muted-foreground hover:border-foreground/20 hover:bg-secondary hover:text-foreground"
                            } ${inQueue ? "cursor-not-allowed" : "cursor-pointer"}`}
                          >
                            <BotIcon className="h-6 w-6" />
                            <p className="text-sm font-semibold">{label}</p>
                            <p className={`text-[11px] ${active ? "opacity-70" : "text-muted-foreground"}`}>{desc}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="border-t border-border" />

                  {/* Search/Cancel — inside card on desktop */}
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
                      <div className="space-y-3">
                        <Button
                          size="lg"
                          className="h-14 w-full gap-3 rounded-2xl bg-destructive font-display text-lg uppercase tracking-wider text-white hover:bg-destructive/90"
                          onClick={leaveQueue}
                        >
                          <Loader2 className="h-6 w-6 animate-spin" />
                          <span className="tabular-nums text-xl">
                            {Math.floor(queueSeconds / 60)}:{String(queueSeconds % 60).padStart(2, "0")}
                          </span>
                          · Anuluj
                        </Button>
                        {lobbyId && (
                          <Link
                            href={`/lobby/${lobbyId}`}
                            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-primary/25 bg-primary/10 font-display text-base uppercase tracking-wider text-primary transition-all hover:bg-primary/20 active:scale-[0.98]"
                          >
                            <Users className="h-5 w-5" />
                            Przejdź do lobby
                          </Link>
                        )}
                      </div>
                    ) : (
                      <Button
                        size="lg"
                        className="h-14 w-full gap-3 rounded-2xl bg-primary font-display text-lg uppercase tracking-wider text-primary-foreground hover:bg-primary/90"
                        onClick={() => joinQueue(selectedMode ?? undefined)}
                        disabled={!selectedMode}
                      >
                        <Search className="h-6 w-6" />
                        Szukaj gry
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Mobile: flat sections */}
              <div className="md:hidden space-y-4">
                {/* Deck */}
                <div className={inQueue ? "opacity-40 pointer-events-none" : ""}>
                  <div className="flex items-center justify-between mb-2.5">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium">Talia</p>
                    <Link href="/decks" className="text-xs text-primary hover:text-primary/80 transition-colors">
                      Zarządzaj <ChevronRight className="inline h-3.5 w-3.5" />
                    </Link>
                  </div>
                  {decks.length > 0 ? (
                    <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
                      {decks.map((deck) => (
                        <button
                          key={deck.id}
                          onClick={() => setSelectedDeckId(deck.id)}
                          disabled={inQueue}
                          className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition-all ${
                            selectedDeckId === deck.id
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                          }`}
                        >
                          <Layers className="h-4 w-4" />
                          {deck.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Link
                      href="/decks"
                      className="inline-flex items-center gap-2 rounded-full border border-dashed border-border px-4 py-2.5 text-sm text-muted-foreground hover:border-primary/30 hover:text-foreground transition-all"
                    >
                      <Layers className="h-4 w-4" />
                      Stwórz talię
                    </Link>
                  )}
                </div>

                {/* Deck preview mobile */}
                {selectedDeck && selectedDeck.items.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
                    {selectedDeck.items.map((di, i) => {
                      const rarity = di.item.rarity ?? "common";
                      const rarityBorder: Record<string, string> = {
                        common: "border-slate-500/30",
                        uncommon: "border-green-500/30",
                        rare: "border-blue-500/30",
                        epic: "border-purple-500/30",
                        legendary: "border-amber-500/30",
                      };
                      const lvlColor =
                        (di.item.level ?? 1) >= 3
                          ? "text-accent"
                          : (di.item.level ?? 1) === 2
                            ? "text-primary"
                            : "text-muted-foreground";
                      return (
                        <div
                          key={`${di.item.slug}-${i}`}
                          className={`relative flex shrink-0 flex-col items-center rounded-xl border ${rarityBorder[rarity] ?? "border-border"} bg-secondary/50 px-2.5 py-2 w-16`}
                        >
                          <div
                            className={`absolute -top-1 -right-1 rounded-md px-1 py-px text-[8px] font-bold ${lvlColor}`}
                          >
                            {di.item.level}
                          </div>
                          <div className="flex h-8 w-8 items-center justify-center text-xl">{di.item.icon || "📦"}</div>
                          <p className="mt-1 w-full truncate text-center text-[9px] font-medium leading-tight text-card-foreground">
                            {di.item.name.replace(/^(Pakiet|Blueprint|Bonus): ?/, "")}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Bots mobile */}
                <div className={inQueue ? "opacity-40 pointer-events-none" : ""}>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium mb-2.5">
                    Przeciwnicy
                  </p>

                  <div className="flex rounded-xl bg-secondary/80 p-1">
                    {(
                      [
                        { value: 0, label: "Gracze", icon: Users },
                        { value: 1, label: "Boty 30s", icon: Bot },
                        { value: 2, label: "Instant", icon: Bot },
                      ] as const
                    ).map(({ value, label, icon: BotIcon }) => {
                      const active = botMode === value;
                      return (
                        <button
                          key={value}
                          disabled={inQueue}
                          onClick={() => {
                            setFillBots(value >= 1);
                            setInstantBot(value === 2);
                          }}
                          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold transition-all ${
                            active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                          }`}
                        >
                          <BotIcon className="h-3.5 w-3.5" />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* end col-span-2 */}

          {/* Friends side panel — desktop only (col-span-1, full height) */}
          <div className="hidden md:flex md:col-span-1 md:flex-col">
            <Card className="rounded-2xl flex-1 flex flex-col overflow-hidden">
              <CardContent className="p-5 flex-1 flex flex-col min-h-0">
                {/* Header — always visible */}
                <div className="flex items-center justify-between mb-4 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground font-medium">Znajomi</p>
                    {pendingCount > 0 && (
                      <span className="inline-flex items-center rounded-full bg-primary/15 px-2.5 py-0.5 text-sm font-semibold text-primary">
                        {pendingCount}
                      </span>
                    )}
                  </div>
                  <Link href="/friends" className="text-sm text-primary hover:text-primary/80 transition-colors">
                    Wszystkie <ChevronRight className="inline h-4 w-4" />
                  </Link>
                </div>

                {/* Body: friends list */}
                {friends.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 py-6">
                    <Users className="h-8 w-8 text-muted-foreground/20" />
                    <p className="text-base text-muted-foreground/40">Brak znajomych</p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col gap-0.5 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-border">
                    {friends.map((friendship) => {
                      const friend: FriendUser =
                        friendship.from_user.id === user.id ? friendship.to_user : friendship.from_user;
                      return (
                        <div
                          key={friendship.id}
                          className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all hover:bg-muted/50 group shrink-0"
                        >
                          <Link href={`/profile/${friend.id}`} className="flex flex-1 min-w-0 items-center gap-3">
                            <div className="relative shrink-0">
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-sm font-bold text-foreground uppercase">
                                {friend.username.charAt(0)}
                              </div>
                              <div
                                className={cn(
                                  "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                                  activityDot(friend.activity_status),
                                )}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-base font-semibold text-foreground truncate block group-hover:text-primary transition-colors">
                                {friend.username}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {activityLabel(friend.activity_status, friend.activity_details)} ·{" "}
                                <span className="text-accent tabular-nums">{friend.elo_rating}</span>
                              </span>
                            </div>
                          </Link>
                          <button
                            title="Napisz wiadomość"
                            onClick={() => openDMTab(friend.id, friend.username)}
                            className="shrink-0 flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-primary/10 transition-all"
                          >
                            <MessageSquare className="h-4 w-4" />
                          </button>
                          {friend.activity_status === "in_game" && friend.activity_details?.match_id && (
                            <Link
                              href={`/spectate/${friend.activity_details.match_id}`}
                              className="shrink-0 flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-accent hover:bg-accent/10 transition-all"
                              title="Oglądaj mecz"
                            >
                              <Eye className="h-4 w-4" />
                            </Link>
                          )}
                          <button
                            title="Zaproś do gry"
                            disabled={inQueue}
                            onClick={async () => {
                              if (!token || !selectedMode) return;
                              toast.info("Tworzenie lobby...", { id: "dashboard-creating-lobby" });
                              try {
                                await inviteFriendToGame(token, friendship.id, selectedMode);
                                joinQueue(selectedMode);
                                toast.success("Zaproszenie wysłane!", { id: "dashboard-invite-sent" });
                              } catch {
                                toast.error("Nie udało się wysłać zaproszenia", { id: "dashboard-invite-error" });
                              }
                            }}
                            className="shrink-0 flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:pointer-events-none transition-all"
                          >
                            <Swords className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <Link
                  href="/friends"
                  className="mt-3 shrink-0 flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-5 py-3 text-sm text-muted-foreground hover:border-primary/30 hover:text-foreground transition-all"
                >
                  <UserPlus className="h-4 w-4" />
                  Dodaj znajomych
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ═══ QUEUE STATUS + CTA — mobile only (desktop CTA is inside the Card above) ═══ */}
      {!activeMatch && (
        <div className="px-4 md:hidden space-y-2">
          {inQueue && (
            <div className="flex items-center justify-center gap-2 text-sm text-foreground py-1">
              <span className="font-bold text-base">{playersInQueue} w kolejce</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-medium text-muted-foreground">{currentMode?.name ?? "Tryb"}</span>
              {fillBots && queueSeconds < 30 && (
                <span className="text-accent font-bold">Boty za {30 - queueSeconds}s</span>
              )}
              {fillBots && queueSeconds >= 30 && (
                <span className="text-primary font-bold animate-pulse">Boty dołączają...</span>
              )}
            </div>
          )}
          {inQueue ? (
            <div className="space-y-2">
              <Button
                size="lg"
                className="h-14 w-full gap-3 rounded-full bg-destructive font-display text-base uppercase tracking-wider text-white hover:bg-destructive/90 active:scale-[0.98] transition-all"
                onClick={leaveQueue}
              >
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="tabular-nums text-lg">
                  {Math.floor(queueSeconds / 60)}:{String(queueSeconds % 60).padStart(2, "0")}
                </span>
                · Anuluj
              </Button>
              {lobbyId && (
                <Link
                  href={`/lobby/${lobbyId}`}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-primary/25 bg-primary/10 font-display text-sm uppercase tracking-wider text-primary transition-all hover:bg-primary/20 active:scale-[0.98]"
                >
                  <Users className="h-4 w-4" />
                  Przejdź do lobby
                </Link>
              )}
            </div>
          ) : (
            <Button
              size="lg"
              className="h-14 w-full gap-2.5 rounded-full bg-primary font-display text-base uppercase tracking-wider text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all"
              onClick={() => joinQueue(selectedMode ?? undefined)}
              disabled={!selectedMode}
            >
              <Search className="h-5 w-5" />
              Szukaj gry
            </Button>
          )}
        </div>
      )}

      {/* ═══ TUTORIAL ═══ */}
      {!user.tutorial_completed && !activeMatch && !inQueue && (
        <div className="px-4 md:px-0">
          <button
            onClick={handleStartTutorial}
            disabled={tutorialLoading}
            className="flex w-full items-center gap-3 md:gap-5 rounded-2xl border border-accent/20 bg-accent/5 p-3 md:p-5 text-left transition-all hover:border-accent/35 hover:bg-accent/10 active:scale-[0.98]"
          >
            <div className="flex h-10 w-10 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-xl bg-accent/15">
              <GraduationCap className="h-5 w-5 md:h-6 md:w-6 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm md:text-base font-medium text-foreground">Samouczek</p>
              <p className="text-xs md:text-sm text-muted-foreground truncate">
                Naucz się podstaw w krótkiej rozgrywce
              </p>
            </div>
            <ChevronRight className="h-4 w-4 md:h-5 md:w-5 text-muted-foreground shrink-0" />
          </button>
        </div>
      )}

      {/* ═══ SHORTCUTS ═══ */}
      <div className="grid grid-cols-4 gap-2 px-4 md:px-0 md:gap-3">
        {[
          { href: "/inventory", icon: Backpack, label: "Ekwipunek", color: "text-primary" },
          { href: "/decks", icon: Layers, label: "Talia", color: "text-primary" },
          { href: "/marketplace", icon: Store, label: "Rynek", color: "text-primary" },
          { href: "/crafting", icon: Hammer, label: "Kuźnia", color: "text-accent" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex flex-col items-center gap-1.5 rounded-2xl bg-card/60 md:bg-card border border-transparent md:border-border p-3 md:flex-row md:items-center md:gap-3 md:px-4 md:py-3.5 transition-all hover:bg-muted hover:border-border/60 active:scale-[0.97]"
          >
            <div className="md:flex md:h-9 md:w-9 md:shrink-0 md:items-center md:justify-center md:rounded-lg md:bg-secondary">
              <item.icon className={`h-6 w-6 md:h-5 md:w-5 ${item.color}`} />
            </div>
            <p className="text-[11px] md:text-base font-bold text-card-foreground text-center md:text-left leading-tight">
              {item.label}
            </p>
            <ChevronRight className="hidden md:block h-4 w-4 text-muted-foreground/40 ml-auto shrink-0 group-hover:text-muted-foreground transition-colors" />
          </Link>
        ))}
      </div>

      {/* ═══ FRIENDS WIDGET — mobile only (desktop is in game config grid) ═══ */}
      <div className="px-4 md:hidden">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium">Znajomi</p>
            {pendingCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">
                {pendingCount}
              </span>
            )}
          </div>
          <Link href="/friends" className="text-xs text-primary hover:text-primary/80 transition-colors">
            Zobacz wszystkich <ChevronRight className="inline h-3.5 w-3.5" />
          </Link>
        </div>
        {friends.length === 0 ? (
          <Link
            href="/friends"
            className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary/30 hover:text-foreground transition-all"
          >
            <Users className="h-4 w-4 shrink-0" />
            Dodaj znajomych aby grać razem!
          </Link>
        ) : (
          <div className="space-y-1">
            {friends.map((friendship) => {
              const friend: FriendUser =
                friendship.from_user.id === user.id ? friendship.to_user : friendship.from_user;
              return (
                <div
                  key={friendship.id}
                  className="flex items-center gap-3 rounded-xl px-1 py-2.5 transition-all hover:bg-muted/50"
                >
                  <Link href={`/profile/${friend.id}`} className="flex flex-1 min-w-0 items-center gap-3">
                    <div className="relative shrink-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-bold text-foreground uppercase">
                        {friend.username.charAt(0)}
                      </div>
                      <div
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                          friend.is_online ? "bg-green-500" : "bg-muted-foreground/30",
                        )}
                      />
                    </div>
                    <span className="flex-1 min-w-0 text-sm font-medium text-foreground truncate">
                      {friend.username}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground shrink-0">{friend.elo_rating} ELO</span>
                  </Link>
                  <button
                    onClick={() => openDMTab(friend.id, friend.username)}
                    title="Napisz wiadomość"
                    className="shrink-0 flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                  {friend.activity_status === "in_game" && friend.activity_details?.match_id && (
                    <Link
                      href={`/spectate/${friend.activity_details.match_id}`}
                      className="shrink-0 flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors"
                      title="Oglądaj mecz"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ RECENT MATCHES — mobile: clean list, desktop: table ═══ */}
      {recentMatches.length > 0 && (
        <div className="px-4 md:px-0">
          <p className="text-[11px] md:text-sm uppercase tracking-[0.18em] md:tracking-[0.2em] text-muted-foreground font-medium mb-2.5 md:mb-0">
            Ostatnie mecze
          </p>

          {/* Mobile list */}
          <div className="animate-list-in md:hidden space-y-1">
            {recentMatches.slice(0, 5).map((match) => {
              const isActive = match.status === "in_progress" || match.status === "selecting";
              const isWinner = match.winner_id === user.id;
              const myPlayer = match.players.find((p) => p.user_id === user.id);
              const isLoss = match.status === "finished" && !isWinner && myPlayer && !myPlayer.is_alive;
              const date = new Date(match.finished_at ?? match.started_at ?? match.created_at);
              const startDate = match.started_at ? new Date(match.started_at) : null;
              const endDate = match.finished_at ? new Date(match.finished_at) : null;
              const durationMin =
                startDate && endDate ? Math.round((endDate.getTime() - startDate.getTime()) / 60000) : null;

              return (
                <button
                  key={match.id}
                  className="flex w-full items-center gap-3 rounded-xl py-3 px-1 text-left transition-all active:bg-muted/50 hover-lift"
                  onClick={() => router.push(isActive ? `/game/${match.id}` : `/match/${match.id}`)}
                >
                  {/* Color dots */}
                  <div className="flex gap-0.5 shrink-0">
                    {match.players.map((p) => (
                      <div
                        key={p.id}
                        className="h-5 w-5 rounded-md"
                        style={{
                          backgroundColor: p.color,
                          opacity: !p.is_alive && match.status === "finished" ? 0.3 : 1,
                        }}
                      />
                    ))}
                  </div>

                  {/* Result badge */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {isActive ? (
                        <span className="flex items-center gap-1 text-sm font-semibold text-primary">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                          Na żywo
                        </span>
                      ) : isWinner ? (
                        <span className="text-sm font-semibold text-accent">Wygrana</span>
                      ) : isLoss ? (
                        <span className="text-sm font-semibold text-destructive">Przegrana</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {match.status === "cancelled" ? "Anulowany" : "Zakończony"}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {match.max_players <= 2 ? "1v1" : `${match.max_players}P`}
                      </span>
                      {durationMin != null && (
                        <span className="text-xs text-muted-foreground tabular-nums">{durationMin}m</span>
                      )}
                    </div>
                  </div>

                  {/* Date + chevron */}
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {date.toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                </button>
              );
            })}
          </div>

          {/* Desktop table */}
          <Card className="hidden md:block rounded-2xl overflow-hidden mt-4">
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
                  const durationMin =
                    startDate && endDate ? Math.round((endDate.getTime() - startDate.getTime()) / 60000) : null;

                  return (
                    <TableRow
                      key={match.id}
                      className="cursor-pointer hover:bg-muted/50 hover-lift"
                      onClick={() => router.push(isActive ? `/game/${match.id}` : `/match/${match.id}`)}
                    >
                      <TableCell className="pl-6 py-5">
                        {isActive ? (
                          <Badge className="border-0 bg-primary/20 text-base px-3 py-1 text-primary hover:bg-primary/20">
                            <div className="h-2 w-2 rounded-full bg-primary animate-pulse mr-2" />
                            Live
                          </Badge>
                        ) : isWinner ? (
                          <Badge className="border-0 bg-accent/15 text-base px-3 py-1 text-accent hover:bg-accent/15">
                            <Crown className="mr-1.5 h-4 w-4" />
                            Wygrana
                          </Badge>
                        ) : isLoss ? (
                          <Badge
                            variant="destructive"
                            className="border-0 bg-destructive/15 text-base px-3 py-1 text-destructive hover:bg-destructive/15"
                          >
                            Przegrana
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-base px-3 py-1 text-muted-foreground">
                            {match.status === "cancelled"
                              ? "Anulowany"
                              : match.status === "finished"
                                ? "Zakończony"
                                : match.status}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="py-5">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            {match.players.map((p) => (
                              <div
                                key={p.id}
                                className="h-6 w-6 rounded"
                                style={{
                                  backgroundColor: p.color,
                                  opacity: !p.is_alive && match.status === "finished" ? 0.3 : 1,
                                }}
                                title={p.username}
                              />
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
                          <span className="tabular-nums text-foreground">
                            {date.toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}
                          </span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
