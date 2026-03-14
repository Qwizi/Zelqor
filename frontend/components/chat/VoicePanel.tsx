"use client";

import { Mic, MicOff, PhoneOff, Phone } from "lucide-react";
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

  if (!connected) {
    return (
      <button
        onClick={onJoin}
        className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/88 px-3 py-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl transition-colors hover:bg-white/[0.06]"
      >
        <Phone className="h-3 w-3 text-emerald-400" />
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
          Dolacz do rozmowy
        </span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-2xl border border-white/10 bg-slate-950/88 px-3 py-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl">
      {/* Mic toggle */}
      <button
        onClick={onToggleMic}
        className={`rounded-full p-1.5 transition-colors ${
          micEnabled
            ? isSpeaking
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-white/[0.06] text-zinc-300 hover:bg-white/[0.12]"
            : "bg-red-500/20 text-red-300 hover:bg-red-500/30"
        }`}
        title={micEnabled ? "Wycisz mikrofon" : "Wlacz mikrofon"}
      >
        {micEnabled ? (
          <Mic className="h-3.5 w-3.5" />
        ) : (
          <MicOff className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Separator */}
      <div className="h-4 w-px bg-white/10" />

      {/* Speaking peers */}
      <div className="flex items-center gap-1.5">
        {peers.length === 0 && (
          <span className="text-[10px] text-slate-500">Brak graczy</span>
        )}
        {peers.map((peer) => {
          const player = players[peer.identity];
          return (
            <div
              key={peer.identity}
              className="flex items-center gap-1"
              title={peer.name}
            >
              <div
                className={`h-2 w-2 rounded-full transition-all ${
                  peer.isMuted
                    ? "bg-slate-600"
                    : peer.isSpeaking
                      ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]"
                      : "bg-slate-400"
                }`}
              />
              <span
                className="text-[10px] text-slate-400"
                style={player ? { color: player.color } : undefined}
              >
                {player?.username ?? peer.name}
              </span>
            </div>
          );
        })}
      </div>

      {/* Separator */}
      <div className="h-4 w-px bg-white/10" />

      {/* Leave button */}
      <button
        onClick={onLeave}
        className="rounded-full p-1.5 text-red-400 transition-colors hover:bg-red-500/20"
        title="Opusc rozmowe"
      >
        <PhoneOff className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
