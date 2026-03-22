"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { createSocket } from "@/lib/ws";
import type { WSMessage } from "@/lib/ws";
import { Eye, ArrowLeft, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SpectatePlayer {
  user_id: string;
  username: string;
  color: string;
  is_alive: boolean;
  energy: number;
  region_count?: number;
}

export default function SpectatePage() {
  const { matchId } = useParams<{ matchId: string }>();
  const { token } = useAuth();
  const router = useRouter();
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [players, setPlayers] = useState<SpectatePlayer[]>([]);
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState<string>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !matchId) return;

    const ws = createSocket(
      `/game/${matchId}/spectate/`,
      token,
      (msg: WSMessage) => {
        if (msg.type === "game_tick" || msg.type === "tick") {
          const state = (msg.state ?? msg) as Record<string, unknown>;
          if (state.players && typeof state.players === "object") {
            const playerList = Object.entries(
              state.players as Record<string, Record<string, unknown>>
            ).map(([uid, p]) => ({
              user_id: uid,
              username: typeof p.username === "string" ? p.username : "?",
              color: typeof p.color === "string" ? p.color : "#888",
              is_alive: p.is_alive !== false,
              energy: typeof p.energy === "number" ? p.energy : 0,
              region_count: typeof p.region_count === "number" ? p.region_count : undefined,
            }));
            setPlayers(playerList);
          }
          if (typeof state.tick === "number") setTick(state.tick);
          if (typeof state.status === "string") setStatus(state.status);
        }
        if (msg.type === "error") {
          setError(typeof msg.message === "string" ? msg.message : "Błąd połączenia");
        }
        if (msg.type === "game_over") {
          setStatus("finished");
        }
      },
      (event: CloseEvent) => {
        setConnected(false);
        if (event.code === 4001 || event.code === 4003) {
          setError("Nie można oglądać tego meczu");
        }
      }
    );

    ws.onopen = () => setConnected(true);
    wsRef.current = ws;

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [token, matchId]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Card className="max-w-md rounded-2xl">
          <CardContent className="p-8 text-center space-y-4">
            <Eye className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="font-display text-2xl text-foreground">{error}</h2>
            <Button onClick={() => router.back()}>Wróć</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="fixed inset-x-0 top-0 z-40 h-12 border-b border-border bg-card/80 backdrop-blur-xl">
        <div className="flex h-full items-center gap-3 px-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2">
            <ArrowLeft size={16} />
            Wróć
          </Button>
          <div className="flex-1" />
          <Badge className="gap-1.5 bg-accent/15 text-accent border-accent/25">
            <Eye size={14} />
            Tryb obserwatora
          </Badge>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {connected ? (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                Tick {tick}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Łączenie...
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="pt-16 px-4 md:px-8 pb-8 max-w-4xl mx-auto space-y-6">
        <div className="text-center space-y-2 pt-6">
          <h1 className="font-display text-3xl md:text-5xl text-foreground">Obserwowanie meczu</h1>
          <p className="text-muted-foreground">Oglądasz mecz na żywo</p>
        </div>

        {/* Players */}
        <Card className="rounded-2xl">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Users size={18} className="text-muted-foreground" />
              <span className="text-sm uppercase tracking-[0.2em] text-muted-foreground font-medium">Gracze</span>
              <Badge variant="outline" className="ml-auto">{status}</Badge>
            </div>
            {players.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-2">
                {[...players]
                  .sort((a, b) => (b.is_alive ? 1 : 0) - (a.is_alive ? 1 : 0))
                  .map((p) => (
                    <div
                      key={p.user_id}
                      className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
                        p.is_alive ? "bg-secondary/50" : "bg-secondary/20 opacity-50"
                      }`}
                    >
                      <div
                        className="h-4 w-4 rounded-md shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="flex-1 text-base font-semibold text-foreground">
                        {p.username}
                      </span>
                      {p.region_count !== undefined && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {p.region_count} reg.
                        </span>
                      )}
                      {!p.is_alive && (
                        <Badge variant="outline" className="text-destructive border-destructive/30">
                          Wyeliminowany
                        </Badge>
                      )}
                      <span className="text-sm tabular-nums text-accent">{p.energy} ⚡</span>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
