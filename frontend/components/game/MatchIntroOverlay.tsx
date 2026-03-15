"use client";

import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Loader2, Swords } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlayerInfo {
  user_id: string;
  username: string;
  color: string;
  is_bot?: boolean;
}

export interface MatchIntroOverlayProps {
  players: Record<string, PlayerInfo>;
  myUserId: string;
  mapReady: boolean;
  onComplete: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_DISPLAY_MS = 3000;

// ─── Player Card ──────────────────────────────────────────────────────────────

function PlayerCard({
  player,
  isMe,
  side,
}: {
  player: PlayerInfo;
  isMe: boolean;
  side?: "left" | "right" | "center";
}) {
  const initial = player.username.charAt(0).toUpperCase();

  const alignClass =
    side === "left"
      ? "items-end text-right"
      : side === "right"
        ? "items-start text-left"
        : "items-center text-center";

  return (
    <div className={`flex flex-col gap-3 ${alignClass}`}>
      {/* Avatar circle */}
      <div
        className="relative flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold text-white shadow-lg sm:h-24 sm:w-24 sm:text-3xl"
        style={{
          backgroundColor: player.color,
          boxShadow: `0 0 0 3px ${player.color}40, 0 0 32px ${player.color}50`,
        }}
      >
        {/* Animated ring */}
        <span
          className="pointer-events-none absolute inset-0 animate-ping rounded-full opacity-20"
          style={{ backgroundColor: player.color }}
        />
        <span className="relative z-10">{initial}</span>
      </div>

      {/* Name + badges */}
      <div className={`flex flex-col gap-1 ${alignClass}`}>
        <span className="font-display text-lg font-bold uppercase tracking-wide text-zinc-50 sm:text-xl">
          {player.username}
          {isMe && (
            <span className="ml-2 text-sm font-normal normal-case tracking-normal text-cyan-400">
              (Ty)
            </span>
          )}
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          {player.is_bot && (
            <span className="rounded-full border border-zinc-600/50 bg-zinc-800/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              BOT
            </span>
          )}
          {/* Color swatch label */}
          <span className="flex items-center gap-1 text-xs text-zinc-500">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: player.color }}
            />
            {player.color}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── 1v1 VS layout ────────────────────────────────────────────────────────────

function DuelLayout({
  playerLeft,
  playerRight,
  myUserId,
}: {
  playerLeft: PlayerInfo;
  playerRight: PlayerInfo;
  myUserId: string;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-4 sm:gap-8">
      {/* Left player */}
      <div
        className="player-card-left flex-1"
        style={{ minWidth: 0 }}
      >
        <PlayerCard
          player={playerLeft}
          isMe={playerLeft.user_id === myUserId}
          side="left"
        />
      </div>

      {/* VS center */}
      <div className="vs-center flex shrink-0 flex-col items-center gap-2">
        <Swords className="h-6 w-6 text-amber-400/60" />
        <span
          className="font-display text-5xl font-black uppercase tracking-[0.1em] text-amber-400 sm:text-6xl"
          style={{
            textShadow:
              "0 0 20px rgba(251,191,36,0.7), 0 0 60px rgba(251,191,36,0.3)",
          }}
        >
          VS
        </span>
        <Swords className="h-6 w-6 rotate-180 text-amber-400/60" />
      </div>

      {/* Right player */}
      <div
        className="player-card-right flex-1"
        style={{ minWidth: 0 }}
      >
        <PlayerCard
          player={playerRight}
          isMe={playerRight.user_id === myUserId}
          side="right"
        />
      </div>
    </div>
  );
}

// ─── FFA Grid layout ──────────────────────────────────────────────────────────

function FFALayout({
  players,
  myUserId,
}: {
  players: PlayerInfo[];
  myUserId: string;
}) {
  return (
    <div className="flex flex-col items-center gap-6">
      <p className="font-display text-sm uppercase tracking-[0.25em] text-zinc-400">
        Wszyscy Przeciw Wszystkim
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {players.map((player, i) => (
          <div
            key={player.user_id}
            className="ffa-player-card rounded-2xl border border-white/10 bg-card p-3 shadow-lg sm:bg-slate-900/60 sm:p-4 sm:shadow-[0_8px_24px_rgba(0,0,0,0.4)] sm:backdrop-blur-xl"
            style={{
              boxShadow: `0 0 0 1px ${player.color}30, 0 8px 24px rgba(0,0,0,0.4)`,
              animationDelay: `${i * 80}ms`,
            }}
          >
            <PlayerCard
              player={player}
              isMe={player.user_id === myUserId}
              side="center"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MatchIntroOverlay({
  players,
  myUserId,
  mapReady,
  onComplete,
}: MatchIntroOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountTimeRef = useRef<number>(Date.now());
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const playerList = Object.values(players);
  const isDuel = playerList.length === 2;

  // Guarantee we always pick two distinct sides for 1v1: "me" on the left.
  const playerLeft = isDuel
    ? (playerList.find((p) => p.user_id === myUserId) ?? playerList[0])
    : playerList[0];
  const playerRight = isDuel
    ? (playerList.find((p) => p.user_id !== myUserId) ?? playerList[1])
    : playerList[1];

  // ── Minimum display timer ──────────────────────────────────────────────────

  useEffect(() => {
    const remaining = MIN_DISPLAY_MS - (Date.now() - mountTimeRef.current);
    const delay = Math.max(0, remaining);
    const timer = setTimeout(() => setMinTimeElapsed(true), delay);
    return () => clearTimeout(timer);
  }, []);

  // ── Dismiss logic ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapReady || !minTimeElapsed || dismissed) return;
    setDismissed(true);

    const el = containerRef.current;
    if (!el) {
      onComplete();
      return;
    }

    gsap.to(el, {
      opacity: 0,
      duration: 0.6,
      ease: "power2.inOut",
      onComplete,
    });
  }, [mapReady, minTimeElapsed, dismissed, onComplete]);

  // ── Entrance animations ────────────────────────────────────────────────────

  useGSAP(
    () => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      // Fade in the full backdrop
      tl.fromTo(
        containerRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.4 }
      );

      // Title slides down
      tl.fromTo(
        ".intro-title",
        { y: -30, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.5 },
        "-=0.1"
      );

      if (isDuel) {
        // Players slide in from sides
        tl.fromTo(
          ".player-card-left",
          { x: -80, opacity: 0 },
          { x: 0, opacity: 1, duration: 0.55 },
          "-=0.25"
        );
        tl.fromTo(
          ".player-card-right",
          { x: 80, opacity: 0 },
          { x: 0, opacity: 1, duration: 0.55 },
          "<"
        );

        // VS pulses in
        tl.fromTo(
          ".vs-center",
          { scale: 0.5, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(1.7)" },
          "-=0.3"
        );

        // VS continuous pulse
        tl.to(
          ".vs-center span",
          {
            textShadow:
              "0 0 40px rgba(251,191,36,1), 0 0 80px rgba(251,191,36,0.5)",
            repeat: -1,
            yoyo: true,
            duration: 1.2,
            ease: "sine.inOut",
          },
          "+=0.1"
        );
      } else {
        // FFA: stagger cards in
        tl.fromTo(
          ".ffa-player-card",
          { y: 30, opacity: 0, scale: 0.9 },
          {
            y: 0,
            opacity: 1,
            scale: 1,
            duration: 0.45,
            stagger: 0.08,
          },
          "-=0.2"
        );
      }

      // Loading bar slides in
      tl.fromTo(
        ".intro-loading",
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4 },
        "-=0.15"
      );
    },
    { scope: containerRef }
  );

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 sm:bg-black/90 sm:backdrop-blur-md"
      style={{ opacity: 0 }}
      aria-modal="true"
      aria-label="Przygotowanie do bitwy"
    >
      {/* Hex background tile */}
      <div className="pointer-events-none absolute inset-0 bg-[url('/assets/ui/hex_bg_tile.webp')] bg-[size:240px] opacity-[0.04]" />

      {/* Radial glow behind main card */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_50%,rgba(34,211,238,0.06),transparent_70%)]" />

      {/* Card container */}
      <div className="relative z-10 flex w-full max-w-3xl flex-col items-center gap-8 px-4 py-8 sm:px-6">

        {/* Title */}
        <div className="intro-title flex flex-col items-center gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-zinc-500">
            MapLord
          </p>
          <h1
            className="font-display text-2xl font-black uppercase tracking-widest text-zinc-50 sm:text-3xl"
            style={{
              textShadow: "0 0 40px rgba(34,211,238,0.25)",
            }}
          >
            Przygotowanie do Bitwy
          </h1>
          {/* Cyan glow line */}
          <div className="h-px w-24 rounded-full bg-cyan-400/70 shadow-[0_0_12px_rgba(34,211,238,0.6)]" />
        </div>

        {/* Players section */}
        <div className="w-full rounded-2xl border border-white/10 bg-card p-4 shadow-lg sm:bg-slate-950/88 sm:p-6 sm:shadow-[0_32px_80px_rgba(0,0,0,0.6)] sm:backdrop-blur-xl sm:p-8">
          {isDuel ? (
            <DuelLayout
              playerLeft={playerLeft}
              playerRight={playerRight}
              myUserId={myUserId}
            />
          ) : (
            <FFALayout players={playerList} myUserId={myUserId} />
          )}
        </div>

        {/* Loading indicator */}
        <div className="intro-loading flex flex-col items-center gap-2">
          {mapReady && minTimeElapsed ? (
            <span className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              Gotowe!
            </span>
          ) : (
            <span className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
              Ładowanie mapy...
            </span>
          )}

          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="inline-block h-1 w-1 rounded-full bg-cyan-400/40"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
