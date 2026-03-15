"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { getMatch, getMatchResult, createShareLink, type Match, type MatchResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowLeft,
  Clock,
  Crown,
  Loader2,
  MapPin,
  Shield,
  Skull,
  Swords,
  Users,
  Hammer,
  TrendingUp,
  TrendingDown,
  PlayCircle,
  Share2,
  Check,
} from "lucide-react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  finished: { label: "Zakończony", color: "text-muted-foreground" },
  in_progress: { label: "W trakcie", color: "text-green-400" },
  selecting: { label: "Wybór stolic", color: "text-accent" },
  cancelled: { label: "Anulowany", color: "text-destructive" },
  waiting: { label: "Oczekiwanie", color: "text-muted-foreground" },
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();
  const [match, setMatch] = useState<Match | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !token) { router.replace("/login"); return; }
    Promise.all([
      getMatch(token, id),
      getMatchResult(token, id).catch(() => null),
    ]).then(([matchData, resultData]) => {
      setMatch(matchData);
      setResult(resultData);
      setLoading(false);
    });
  }, [authLoading, user, token, id, router]);

  if (loading || !match) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleShare = async () => {
    if (!token || !match) return;
    setShareLoading(true);
    try {
      const link = await createShareLink(token, "match_result", match.id);
      await navigator.clipboard.writeText(`${window.location.origin}/share/${link.token}`);
      setShareCopied(true);
      toast.success("Link skopiowany do schowka!");
      setTimeout(() => setShareCopied(false), 3000);
    } catch {
      toast.error("Nie udało się utworzyć linku.");
    } finally {
      setShareLoading(false);
    }
  };

  const status = STATUS_LABELS[match.status] ?? { label: match.status, color: "text-muted-foreground" };
  const isActive = match.status === "in_progress" || match.status === "selecting";
  const winner = match.players.find((p) => p.user_id === match.winner_id);
  const startDate = match.started_at ? new Date(match.started_at) : null;
  const endDate = match.finished_at ? new Date(match.finished_at) : null;
  const durationMin = startDate && endDate ? Math.round((endDate.getTime() - startDate.getTime()) / 60000) : null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
            Panel
          </Link>
          <h1 className="font-display text-4xl sm:text-5xl text-foreground">Szczegóły meczu</h1>
        </div>
        <div className="flex items-center gap-3">
          {match.status === "finished" && (
            <>
              <Link
                href={`/replay/${match.id}`}
                className="inline-flex items-center gap-2 rounded-2xl border border-accent/25 bg-accent/10 px-6 py-3 font-display text-base uppercase tracking-[0.15em] text-accent transition-colors hover:bg-accent/20"
              >
                <PlayCircle className="h-5 w-5" />
                Replay
              </Link>
              <button
                onClick={handleShare}
                disabled={shareLoading}
                className="inline-flex items-center gap-2 rounded-2xl border border-border px-6 py-3 font-display text-base uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {shareCopied ? <Check className="h-5 w-5 text-green-400" /> : <Share2 className="h-5 w-5" />}
                {shareCopied ? "Skopiowano!" : "Udostępnij"}
              </button>
            </>
          )}
          {isActive && (
            <Button
              className="h-14 gap-3 rounded-2xl bg-primary px-8 font-display text-lg uppercase tracking-wider text-primary-foreground hover:bg-primary/90"
              onClick={() => router.push(`/game/${match.id}`)}
            >
              <Shield className="h-6 w-6" />
              Wróć do gry
            </Button>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col gap-2 p-5">
            <div className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-primary" />
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">Status</span>
            </div>
            <div className={`font-display text-3xl ${status.color}`}>{status.label}</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col gap-2 p-5">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">Gracze</span>
            </div>
            <div className="font-display text-3xl text-foreground">{match.players.length} / {match.max_players}</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col gap-2 p-5">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">Czas trwania</span>
            </div>
            <div className="font-display text-3xl text-foreground">
              {result ? formatDuration(result.duration_seconds) : durationMin != null ? `${durationMin}m` : "—"}
            </div>
          </CardContent>
        </Card>
        {winner && (
          <Card className="rounded-2xl border-accent/25">
            <CardContent className="flex flex-col gap-2 p-5">
              <div className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-accent" />
                <span className="text-xs uppercase tracking-[0.2em] text-accent/70 font-medium">Zwycięzca</span>
              </div>
              <div className="font-display text-3xl text-accent">{winner.username}</div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Timestamps */}
      {(match.started_at || match.finished_at) && (
        <div className="flex flex-wrap gap-6 text-base text-muted-foreground">
          {match.started_at && <span>Start: <span className="text-foreground">{formatDate(match.started_at)}</span></span>}
          {match.finished_at && <span>Koniec: <span className="text-foreground">{formatDate(match.finished_at)}</span></span>}
          {result && <span>Ticki: <span className="text-foreground">{result.total_ticks}</span></span>}
        </div>
      )}

      {/* Players table */}
      <Card className="rounded-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-6 pt-5 pb-3">
          <Users className="h-6 w-6 text-primary" />
          <h3 className="font-display text-2xl text-foreground">Gracze</h3>
        </div>
        <Table className="text-base">
          <TableHeader>
            <TableRow>
              <TableHead className="h-14 pl-6 text-base font-semibold">Gracz</TableHead>
              <TableHead className="h-14 text-base font-semibold text-center">Status</TableHead>
              <TableHead className="h-14 text-base font-semibold text-center">Miejsce</TableHead>
              <TableHead className="h-14 text-base font-semibold text-center">
                <span className="flex items-center justify-center gap-1"><MapPin className="h-4 w-4" />Regiony</span>
              </TableHead>
              <TableHead className="h-14 text-base font-semibold text-center">Jednostki</TableHead>
              <TableHead className="h-14 text-base font-semibold text-center">Straty</TableHead>
              <TableHead className="h-14 text-base font-semibold text-center">
                <span className="flex items-center justify-center gap-1"><Hammer className="h-4 w-4" />Budynki</span>
              </TableHead>
              <TableHead className="h-14 pr-6 text-base font-semibold text-right">ELO</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {match.players.map((player) => {
              const isMe = player.user_id === user?.id;
              const isWinner = player.user_id === match.winner_id;
              const pr = result?.player_results.find((r) => r.user_id === player.user_id);

              return (
                <TableRow
                  key={player.id}
                  className={`cursor-pointer ${
                    isWinner ? "bg-accent/5 hover:bg-accent/10" : isMe ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/50"
                  }`}
                  onClick={() => router.push(`/profile/${player.user_id}`)}
                >
                  <TableCell className="pl-6 py-5">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg border border-border" style={{ backgroundColor: player.color }} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-semibold text-foreground">{player.username}</span>
                          {isMe && <Badge className="border-0 bg-primary/15 text-sm text-primary">Ty</Badge>}
                          {isWinner && <Crown className="h-4 w-4 text-accent" />}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-5 text-center">
                    {player.is_alive ? (
                      <Badge className="border-0 bg-green-500/15 text-sm text-green-400">Żywy</Badge>
                    ) : (
                      <Badge className="border-0 bg-destructive/15 text-sm text-destructive">
                        <Skull className="mr-1 h-3.5 w-3.5" />Wyeliminowany
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="py-5 text-center font-display text-2xl text-foreground">
                    {pr ? (
                      match.players.length > 2 ? `#${pr.placement}` : isWinner ? "🏆" : "💀"
                    ) : "—"}
                  </TableCell>
                  <TableCell className="py-5 text-center text-lg tabular-nums text-primary">
                    {pr?.regions_conquered ?? "—"}
                  </TableCell>
                  <TableCell className="py-5 text-center text-lg tabular-nums text-foreground">
                    {pr?.units_produced ?? "—"}
                  </TableCell>
                  <TableCell className="py-5 text-center text-lg tabular-nums text-destructive">
                    {pr?.units_lost ?? "—"}
                  </TableCell>
                  <TableCell className="py-5 text-center text-lg tabular-nums text-accent">
                    {pr?.buildings_built ?? "—"}
                  </TableCell>
                  <TableCell className="py-5 pr-6 text-right">
                    {pr ? (
                      <span className={`flex items-center justify-end gap-1 font-display text-xl ${
                        pr.elo_change > 0 ? "text-green-400" : pr.elo_change < 0 ? "text-destructive" : "text-muted-foreground"
                      }`}>
                        {pr.elo_change > 0 ? <TrendingUp className="h-4 w-4" /> : pr.elo_change < 0 ? <TrendingDown className="h-4 w-4" /> : null}
                        {pr.elo_change > 0 ? "+" : ""}{pr.elo_change}
                      </span>
                    ) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
