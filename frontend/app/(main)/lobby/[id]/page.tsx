"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMatchmaking, type LobbyPlayer } from "@/hooks/useMatchmaking";
import { useAuth } from "@/hooks/useAuth";
import { useVoiceChat } from "@/hooks/useVoiceChat";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MessageList } from "@/components/chat/MessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import VoicePanel from "@/components/chat/VoicePanel";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Bot,
  Check,
  Clock,
  Crown,
  Loader2,
  MessageSquare,
  Search,
  Swords,
  Users,
  X,
} from "lucide-react";
import { BannedBadge } from "@/components/ui/banned-badge";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

// ---------------------------------------------------------------------------
// Player slot — mobile: compact row, desktop: card-style
// ---------------------------------------------------------------------------

function PlayerSlot({ player, isHost }: { player: LobbyPlayer; isHost: boolean }) {
  return (
    <div
      data-animate="player"
      className={cn(
        "flex items-center gap-3 md:gap-4 rounded-xl md:rounded-2xl border md:border-2 px-3 py-3 md:px-5 md:py-4 transition-all",
        player.is_ready
          ? "border-green-500/40 bg-green-500/5"
          : "border-border bg-card/60 md:bg-card"
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-10 w-10 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-lg md:rounded-xl text-base md:text-lg font-bold uppercase",
          player.is_ready
            ? "bg-green-500/20 text-green-400"
            : "bg-secondary text-muted-foreground"
        )}
      >
        {player.username.charAt(0)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 md:gap-2">
          <span className="text-sm md:text-base font-semibold text-foreground truncate">
            {player.username}
          </span>
          {isHost && <Crown size={12} className="text-accent shrink-0 md:size-[14px]" />}
          {player.is_bot && <Bot size={12} className="text-muted-foreground shrink-0 md:size-[14px]" />}
          {player.is_banned && <BannedBadge />}
        </div>
        <span className={cn("text-xs md:text-sm", player.is_ready ? "text-green-400" : "text-muted-foreground")}>
          {player.is_ready ? "Gotowy" : "Oczekuje..."}
        </span>
      </div>

      {/* Status icon */}
      <div
        className={cn(
          "flex h-7 w-7 md:h-9 md:w-9 shrink-0 items-center justify-center rounded-full",
          player.is_ready
            ? "bg-green-500/20 text-green-400"
            : "bg-secondary text-muted-foreground"
        )}
      >
        {player.is_ready ? <Check size={14} className="md:size-[18px]" /> : <Clock size={14} className="md:size-[18px]" />}
      </div>
    </div>
  );
}

function EmptySlot() {
  return (
    <div
      data-animate="player"
      className="flex items-center gap-3 md:gap-4 rounded-xl md:rounded-2xl border md:border-2 border-dashed border-border/60 px-3 py-3 md:px-5 md:py-4"
    >
      <div className="flex h-10 w-10 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-lg md:rounded-xl bg-secondary/50 text-muted-foreground/40">
        <Search size={16} className="md:size-[20px]" />
      </div>
      <div className="flex-1 flex items-center gap-2">
        <Loader2 size={12} className="animate-spin text-muted-foreground/40" />
        <span className="text-xs md:text-sm text-muted-foreground/60">Szukam gracza...</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LobbyPage() {
  const {
    inQueue,
    lobbyId,
    lobbyPlayers,
    lobbyFull,
    lobbyMaxPlayers,
    allReady,
    queueSeconds,
    setReady,
    leaveQueue,
    matchId,
    lobbyChatMessages,
    sendLobbyChat,
    readyCountdown,
    voiceToken,
    voiceUrl,
  } = useMatchmaking();
  const { user } = useAuth();
  const voice = useVoiceChat();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const effectiveVoiceUrl =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_LIVEKIT_URL) || voiceUrl;

  const handleVoiceJoin = useCallback(async () => {
    if (!effectiveVoiceUrl || !voiceToken) return;
    try { await voice.join(effectiveVoiceUrl, voiceToken); } catch (e) { console.error("Voice join failed:", e); }
  }, [voice, effectiveVoiceUrl, voiceToken]);

  // Leave voice when leaving lobby
  useEffect(() => {
    if (!inQueue && voice.connected) {
      voice.leave();
    }
  }, [inQueue, voice]);

  // Build players map for VoicePanel
  const voicePlayers = useMemo(() => {
    const map: Record<string, { username: string; color: string }> = {};
    lobbyPlayers.forEach((p) => {
      map[p.user_id] = { username: p.username, color: "#94a3b8" };
    });
    return map;
  }, [lobbyPlayers]);

  const myUserId = user?.id ?? "";
  // Track whether we've ever been in queue (to distinguish cancel from initial mount).
  const [wasEverInQueue, setWasEverInQueue] = useState(false);
  // null = not yet checked (SSR/initial), true = session exists, false = no session
  const [initialSession, setInitialSession] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("maplord_queue");
      if (raw) {
        const session = JSON.parse(raw);
        setInitialSession(Date.now() - session.joinedAt < 5 * 60 * 1000);
      } else {
        setInitialSession(false);
      }
    } catch {
      setInitialSession(false);
    }
  }, []);

  useEffect(() => {
    if (inQueue) setWasEverInQueue(true);
  }, [inQueue]);

  useGSAP(() => {
    if (!containerRef.current) return;
    gsap.fromTo("[data-animate='player']", { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.08, ease: "power2.out" });
    gsap.fromTo("[data-animate='action']", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, delay: 0.3, ease: "power2.out" });
  }, { scope: containerRef, dependencies: [lobbyPlayers.length] });

  useEffect(() => {
    if (matchId) router.push(`/game/${matchId}`);
  }, [matchId, router]);

  // Redirect to dashboard when lobby is gone.
  // Skip redirect while session check is pending (null) or session exists.
  useEffect(() => {
    if (initialSession === null) return; // still checking
    if (!inQueue && !lobbyId) {
      if (wasEverInQueue || !initialSession) {
        router.replace("/dashboard");
      }
    }
  }, [inQueue, lobbyId, wasEverInQueue, initialSession, router]);

  // Show loading while session check is pending
  if (initialSession === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!inQueue && !lobbyId && (wasEverInQueue || !initialSession)) return null;

  const mins = Math.floor(queueSeconds / 60);
  const secs = String(queueSeconds % 60).padStart(2, "0");
  const maxPlayers = lobbyMaxPlayers;
  const emptySlots = lobbyFull ? 0 : Math.max(0, maxPlayers - lobbyPlayers.length);
  const hostUserId = lobbyPlayers.length > 0 ? lobbyPlayers[0].user_id : null;
  const readyCount = lobbyPlayers.filter((p) => p.is_ready).length;
  const myReady = lobbyPlayers.some(p => p.user_id === myUserId && p.is_ready);

  return (
    <div ref={containerRef} className="space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">

      {/* ═══ HEADER ═══ */}
      <div className="px-4 md:px-0">
        <div className="flex items-center gap-2 mb-1 md:mb-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center h-9 w-9 md:h-auto md:w-auto md:gap-2 rounded-full md:rounded-lg text-muted-foreground transition-all hover:text-foreground hover:bg-muted active:scale-[0.95]"
          >
            <ArrowLeft className="h-4 w-4 md:h-5 md:w-5" />
            <span className="hidden md:inline text-base">Panel</span>
          </Link>
          <h1 className="font-display text-lg md:hidden text-foreground">Lobby</h1>
        </div>
        <h1 className="hidden md:block font-display text-5xl text-foreground">
          {lobbyFull && !allReady
            ? "Mecz znaleziony!"
            : allReady
              ? "Uruchamianie meczu..."
              : "Szukanie graczy"}
        </h1>
        <p className="hidden md:block mt-1 text-base text-muted-foreground">
          {lobbyFull && !allReady
            ? "Potwierdź gotowość aby rozpocząć mecz"
            : allReady
              ? "Wszyscy gotowi, mecz zaraz się rozpocznie"
              : `Oczekiwanie na graczy · ${lobbyPlayers.length}/${maxPlayers} w lobby`}
        </p>
      </div>

      {/* ═══ STATS — horizontal scroll on mobile, grid on desktop ═══ */}
      <div className="flex gap-3 overflow-x-auto px-4 pb-1 md:px-0 md:grid md:grid-cols-3 md:gap-3 md:overflow-visible scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
        {[
          { icon: Clock, label: "Czas", value: `${mins}:${secs}`, color: "text-primary", key: "time" },
          { icon: Users, label: "Gracze", value: `${lobbyPlayers.length}/${maxPlayers}`, color: "text-foreground", key: "players" },
          { icon: Check, label: "Gotowi", value: `${readyCount}/${lobbyPlayers.length}`, color: readyCount === lobbyPlayers.length && lobbyPlayers.length > 0 ? "text-green-400" : "text-foreground", key: "ready" },
        ].map((s) => (
          <div
            key={s.key}
            className="flex shrink-0 items-center gap-3 rounded-2xl bg-card/60 md:bg-card border border-transparent md:border-border px-4 py-3 md:px-4 md:py-3.5 md:flex-col md:items-start md:gap-1.5 min-w-[120px] md:min-w-0"
          >
            <div className="flex items-center gap-2">
              <s.icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-medium">{s.label}</span>
            </div>
            <div className={`font-display text-xl md:text-3xl tabular-nums ${s.color} ml-auto md:ml-0`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ═══ STATUS BANNER — mobile ═══ */}
      <div className="px-4 md:hidden">
        <div className={cn(
          "flex items-center gap-3 rounded-xl p-3 transition-all",
          lobbyFull && !allReady
            ? "bg-green-500/10 border border-green-500/20"
            : allReady
              ? "bg-green-500/10 border border-green-500/30"
              : "bg-primary/10 border border-primary/20"
        )}>
          <div className={cn(
            "h-3 w-3 rounded-full animate-pulse shrink-0",
            lobbyFull ? "bg-green-500" : "bg-primary"
          )} />
          <span className={cn(
            "text-sm font-semibold",
            lobbyFull ? "text-green-400" : "text-primary"
          )}>
            {lobbyFull && !allReady
              ? "Mecz znaleziony!"
              : allReady
                ? "Start..."
                : "Szukanie graczy..."}
          </span>
          <span className="text-xs text-muted-foreground ml-auto tabular-nums">{mins}:{secs}</span>
        </div>
      </div>

      {/* ═══ PLAYERS — flat on mobile, Card on desktop ═══ */}
      <div className="px-4 md:px-0">
        {/* Desktop */}
        <Card className="hidden md:block rounded-2xl">
          <CardContent className="p-5 space-y-3">
            <p className="mb-1 text-sm uppercase tracking-[0.2em] text-muted-foreground font-medium">Gracze</p>
            {lobbyPlayers.map((player) => (
              <PlayerSlot key={player.user_id} player={player} isHost={player.user_id === hostUserId} />
            ))}
            {!lobbyFull &&
              Array.from({ length: emptySlots }).map((_, i) => (
                <EmptySlot key={`empty-${i}`} />
              ))}
          </CardContent>
        </Card>

        {/* Mobile */}
        <div className="md:hidden space-y-2">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium mb-2">Gracze</p>
          {lobbyPlayers.map((player) => (
            <PlayerSlot key={player.user_id} player={player} isHost={player.user_id === hostUserId} />
          ))}
          {!lobbyFull &&
            Array.from({ length: emptySlots }).map((_, i) => (
              <EmptySlot key={`empty-${i}`} />
            ))}
        </div>
      </div>

      {/* ═══ VOICE + CHAT ═══ */}
      <div className="px-4 md:px-0">
        {/* Desktop */}
        <Card className="hidden md:block rounded-2xl">
          <CardContent className="p-5 space-y-4">
            {/* Voice */}
            <div>
              <p className="mb-3 text-sm uppercase tracking-[0.2em] text-muted-foreground font-medium">Czat głosowy</p>
              <VoicePanel
                token={voiceToken}
                url={effectiveVoiceUrl}
                players={voicePlayers}
                connected={voice.connected}
                micEnabled={voice.micEnabled}
                isSpeaking={voice.isSpeaking}
                peers={voice.peers}
                onJoin={handleVoiceJoin}
                onLeave={voice.leave}
                onToggleMic={voice.toggleMic}
              />
            </div>

            <div className="border-t border-border" />

            {/* Chat */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground font-medium">Czat lobby</p>
              </div>
              <div className="rounded-xl border border-border bg-secondary/30 overflow-hidden">
                <div className="h-48">
                  <MessageList messages={lobbyChatMessages} currentUserId={myUserId} />
                </div>
                <ChatInput onSend={sendLobbyChat} placeholder="Napisz do graczy..." />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Mobile */}
        <div className="md:hidden space-y-3">
          {/* Voice */}
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium mb-2">Czat głosowy</p>
            <VoicePanel
              token={voiceToken}
              url={effectiveVoiceUrl}
              players={voicePlayers}
              connected={voice.connected}
              micEnabled={voice.micEnabled}
              isSpeaking={voice.isSpeaking}
              peers={voice.peers}
              onJoin={handleVoiceJoin}
              onLeave={voice.leave}
              onToggleMic={voice.toggleMic}
            />
          </div>

          {/* Chat */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <MessageSquare className="h-3 w-3 text-muted-foreground" />
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium">Czat lobby</p>
            </div>
            <div className="rounded-xl border border-border bg-card/60 overflow-hidden">
              <div className="h-40">
                <MessageList messages={lobbyChatMessages} currentUserId={myUserId} />
              </div>
              <ChatInput onSend={sendLobbyChat} placeholder="Napisz..." />
            </div>
          </div>
        </div>
      </div>

      {/* ═══ ACTIONS ═══ */}
      <div className="px-4 md:px-0 space-y-3" data-animate="action">

        {/* Desktop — Card wrapper */}
        <Card className="hidden md:block rounded-2xl">
          <CardContent className="p-5 space-y-4">
            {lobbyFull && !allReady && !myReady && (
              <Button
                size="lg"
                onClick={setReady}
                className="h-14 w-full gap-3 rounded-2xl bg-green-500 font-display text-lg uppercase tracking-wider text-white hover:bg-green-400 active:scale-[0.98] transition-all"
              >
                <Check className="h-6 w-6" />
                Gotowy! {readyCountdown !== null && <span className="tabular-nums">({readyCountdown}s)</span>}
              </Button>
            )}

            {lobbyFull && !allReady && myReady && (
              <Button
                size="lg"
                onClick={setReady}
                className="h-14 w-full gap-3 rounded-2xl bg-green-500/10 border-2 border-green-500/30 font-display text-lg uppercase tracking-wider text-green-400 hover:bg-green-500/20 active:scale-[0.98] transition-all"
              >
                <Check className="h-6 w-6" />
                Gotowy {readyCountdown !== null && <span className="tabular-nums">({readyCountdown}s)</span>}
              </Button>
            )}

            {allReady && (
              <div className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-green-500/10 border border-green-500/30 text-green-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="font-display text-lg uppercase tracking-wider">Uruchamianie meczu...</span>
              </div>
            )}

            {!lobbyFull && !allReady && (
              <div className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-primary/10 border border-primary/20 text-primary">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="font-display text-lg uppercase tracking-wider">Szukanie graczy...</span>
              </div>
            )}

            <Button
              size="lg"
              variant="destructive"
              onClick={leaveQueue}
              className="h-12 w-full gap-2 rounded-2xl font-display text-base uppercase tracking-wider"
            >
              <X className="h-5 w-5" />
              Anuluj
            </Button>
          </CardContent>
        </Card>

        {/* Mobile — flat buttons */}
        <div className="md:hidden space-y-2">
          {lobbyFull && !allReady && !myReady && (
            <Button
              size="lg"
              onClick={setReady}
              className="h-14 w-full gap-2.5 rounded-full bg-green-500 font-display text-base uppercase tracking-wider text-white hover:bg-green-400 active:scale-[0.98] transition-all"
            >
              <Check className="h-5 w-5" />
              Gotowy! {readyCountdown !== null && <span className="tabular-nums">({readyCountdown}s)</span>}
            </Button>
          )}

          {lobbyFull && !allReady && myReady && (
            <Button
              size="lg"
              onClick={setReady}
              className="h-14 w-full gap-2.5 rounded-full bg-green-500/10 border border-green-500/30 font-display text-base uppercase tracking-wider text-green-400 hover:bg-green-500/20 active:scale-[0.98] transition-all"
            >
              <Check className="h-5 w-5" />
              Gotowy {readyCountdown !== null && <span className="tabular-nums">({readyCountdown}s)</span>}
            </Button>
          )}

          {allReady && (
            <div className="flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-green-500/10 border border-green-500/30 text-green-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="font-display text-base uppercase tracking-wider">Start...</span>
            </div>
          )}

          {!lobbyFull && !allReady && (
            <div className="flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-primary/10 border border-primary/20 text-primary">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="font-display text-base uppercase tracking-wider">Szukanie...</span>
            </div>
          )}

          <Button
            size="lg"
            variant="destructive"
            onClick={leaveQueue}
            className="h-14 w-full gap-2.5 rounded-full font-display text-base uppercase tracking-wider active:scale-[0.98] transition-all"
          >
            <X className="h-5 w-5" />
            Anuluj
          </Button>
        </div>
      </div>
    </div>
  );
}
