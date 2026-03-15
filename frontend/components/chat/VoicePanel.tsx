"use client";

import { Mic, MicOff, PhoneOff, Phone, Users } from "lucide-react";
import type { VoicePeer } from "@/hooks/useVoiceChat";

interface PlayerInfo {
  username: string;
  color: string;
}

interface VoicePanelProps {
  token: string | null;
  url: string | null;
  players: Record<string, PlayerInfo>;
  connected: boolean;
  micEnabled: boolean;
  isSpeaking: boolean;
  peers: VoicePeer[];
  onJoin: () => void;
  onLeave: () => void;
  onToggleMic: () => void;
}

export default function VoicePanel({
  token, url, players,
  connected, micEnabled, isSpeaking, peers,
  onJoin, onLeave, onToggleMic,
}: VoicePanelProps) {
  if (!token || !url) return null;

  const speakingCount = peers.filter((p) => p.isSpeaking).length + (isSpeaking ? 1 : 0);

  // ── Not connected ──
  if (!connected) {
    return (
      <>
        {/* Mobile: pure icon */}
        <button
          onClick={onJoin}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-all active:scale-95 sm:hidden"
          title="Dolacz do rozmowy"
        >
          <Phone className="h-4 w-4 text-emerald-400" />
        </button>

        {/* Desktop: pill with text */}
        <button
          onClick={onJoin}
          className="hidden items-center gap-2 rounded-full border border-border bg-card/85 px-3 py-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl transition-colors hover:bg-muted/30 sm:flex"
        >
          <Phone className="h-3 w-3 text-emerald-400" />
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Dolacz do rozmowy
          </span>
        </button>
      </>
    );
  }

  // ── Connected ──
  return (
    <>
      {/* Mobile: two icon buttons side by side */}
      <div className="flex items-center gap-1.5 sm:hidden">
        <button
          onClick={onToggleMic}
          className={`flex h-10 w-10 items-center justify-center rounded-full border shadow-lg transition-all active:scale-95 ${
            micEnabled
              ? isSpeaking
                ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                : "border-border bg-card text-foreground/80"
              : "border-red-500/30 bg-red-500/15 text-red-300"
          }`}
          title={micEnabled ? "Wycisz" : "Wlacz mikrofon"}
        >
          {micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          {/* Speaking dot */}
          {speakingCount > 0 && micEnabled && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-400" />
          )}
        </button>
        <button
          onClick={onLeave}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10 shadow-lg transition-all active:scale-95"
          title="Rozlacz"
        >
          <PhoneOff className="h-4 w-4 text-red-400" />
        </button>
      </div>

      {/* Desktop: full pill with peers */}
      <div className="hidden items-center gap-1.5 rounded-2xl border border-border bg-card/85 px-3 py-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:flex">
        <button
          onClick={onToggleMic}
          className={`rounded-full p-1.5 transition-colors ${
            micEnabled
              ? isSpeaking
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-muted/30 text-foreground/80 hover:bg-muted/50"
              : "bg-red-500/20 text-red-300 hover:bg-red-500/30"
          }`}
          title={micEnabled ? "Wycisz mikrofon" : "Wlacz mikrofon"}
        >
          {micEnabled ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
        </button>

        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-1.5">
          {peers.length === 0 && (
            <span className="text-[10px] text-muted-foreground">Brak graczy</span>
          )}
          {peers.map((peer) => {
            const player = players[peer.identity];
            return (
              <div key={peer.identity} className="flex items-center gap-1" title={peer.name}>
                <div
                  className={`h-2 w-2 rounded-full transition-all ${
                    peer.isMuted
                      ? "bg-muted-foreground/40"
                      : peer.isSpeaking
                        ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]"
                        : "bg-muted-foreground"
                  }`}
                />
                <span
                  className="text-[10px] text-muted-foreground"
                  style={player ? { color: player.color } : undefined}
                >
                  {player?.username ?? peer.name}
                </span>
              </div>
            );
          })}
        </div>

        <div className="h-4 w-px bg-border" />

        <button
          onClick={onLeave}
          className="rounded-full p-1.5 text-red-400 transition-colors hover:bg-red-500/20"
          title="Opusc rozmowe"
        >
          <PhoneOff className="h-3.5 w-3.5" />
        </button>
      </div>
    </>
  );
}
