"use client";

import { useState } from "react";
import { MessageSquare, ChevronDown, ChevronUp, Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import type { VoicePeer } from "@/hooks/useVoiceChat";
import { MessageList, type ChatMessage } from "@/components/chat/MessageList";
import { ChatInput } from "@/components/chat/ChatInput";

interface DesktopChatVoiceProps {
  myUserId: string;
  chatMessages: ChatMessage[];
  onSendChat: (content: string) => void;
  voiceToken: string | null;
  voiceUrl: string | null;
  voiceConnected: boolean;
  voiceMicEnabled: boolean;
  voiceIsSpeaking: boolean;
  voicePeers: VoicePeer[];
  onVoiceJoin: () => void;
  onVoiceLeave: () => void;
  onVoiceToggleMic: () => void;
}

export default function DesktopChatVoice({
  myUserId,
  chatMessages,
  onSendChat,
  voiceToken,
  voiceUrl,
  voiceConnected,
  voiceMicEnabled,
  voiceIsSpeaking,
  voicePeers,
  onVoiceJoin,
  onVoiceLeave,
  onVoiceToggleMic,
}: DesktopChatVoiceProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const hasVoice = Boolean(voiceToken && voiceUrl);

  return (
    <div className="hidden sm:flex absolute left-3 bottom-4 z-10 flex-col items-start gap-2 max-w-[240px]">
      {/* Voice pill */}
      {hasVoice && (
        <VoicePill
          connected={voiceConnected}
          micEnabled={voiceMicEnabled}
          isSpeaking={voiceIsSpeaking}
          peers={voicePeers}
          onJoin={onVoiceJoin}
          onLeave={onVoiceLeave}
          onToggleMic={onVoiceToggleMic}
        />
      )}

      {/* Chat panel */}
      <div className="w-full rounded-xl border border-border bg-card/80 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl">
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="flex w-full items-center justify-between px-2.5 py-1.5 transition-colors hover:bg-muted/20"
        >
          <div className="flex items-center gap-1.5">
            <MessageSquare className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Czat</span>
            {!chatOpen && chatMessages.length > 0 && (
              <span className="text-[9px] tabular-nums text-muted-foreground">{chatMessages.length}</span>
            )}
          </div>
          {chatOpen ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
        </button>
        {chatOpen && (
          <div className="border-t border-border">
            <div className="h-32">
              <MessageList messages={chatMessages} currentUserId={myUserId} />
            </div>
            <ChatInput onSend={onSendChat} placeholder="Napisz..." />
          </div>
        )}
      </div>
    </div>
  );
}

function VoicePill({
  connected, micEnabled, isSpeaking, peers,
  onJoin, onLeave, onToggleMic,
}: {
  connected: boolean;
  micEnabled: boolean;
  isSpeaking: boolean;
  peers: VoicePeer[];
  onJoin: () => void;
  onLeave: () => void;
  onToggleMic: () => void;
}) {
  if (!connected) {
    return (
      <button
        onClick={onJoin}
        className="flex items-center gap-1.5 rounded-full border border-border bg-card/80 px-2.5 py-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl transition-colors hover:bg-muted/30"
      >
        <Phone className="h-3 w-3 text-emerald-400" />
        <span className="text-[10px] font-medium text-muted-foreground">Dolacz</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-border bg-card/80 px-2 py-1 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl">
      <button
        onClick={onToggleMic}
        className={`rounded-full p-1 transition-colors ${
          micEnabled
            ? isSpeaking ? "text-emerald-300" : "text-foreground/60 hover:text-foreground"
            : "text-red-400"
        }`}
        title={micEnabled ? "Wycisz" : "Wlacz mikrofon"}
      >
        {micEnabled ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
      </button>
      {peers.length > 0 && (
        <span className="text-[10px] tabular-nums text-muted-foreground">{peers.length}</span>
      )}
      <button onClick={onLeave} className="rounded-full p-1 text-red-400 transition-colors hover:bg-red-500/20" title="Rozlacz">
        <PhoneOff className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
