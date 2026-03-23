"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useMatch, useMatchResult } from "@/hooks/queries";
import { createShareLink, type Match, type MatchResult } from "@/lib/api";
import { requireToken } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BannedBadge } from "@/components/ui/banned-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowLeft,
  Award,
  ChevronRight,
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
  Zap,
} from "lucide-react";
import { MatchDetailSkeleton } from "@/components/skeletons/MatchDetailSkeleton";
import { toast } from "sonner";
import dynamic from "next/dynamic";

const MatchCharts = dynamic(() => import("@/components/match/MatchCharts"), { ssr: false });

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
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [shareLoading, setShareLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  const { data: match, isLoading: matchLoading } = useMatch(id);
  const { data: result } = useMatchResult(id);

  const loading = matchLoading || authLoading;

  if (!authLoading && !user) {
    router.replace("/login");
    return null;
  }

  if (loading || !match) {
    return <MatchDetailSkeleton />;
  }

  const handleShare = async () => {
    if (!match) return;
    if (shareUrl) { setShareUrl(null); return; } // toggle
    setShareLoading(true);
    try {
      const link = await createShareLink(requireToken(), "match_result", match.id);
      setShareUrl(`${window.location.origin}/share/${link.token}`);
    } catch {
      toast.error("Nie udało się utworzyć linku.");
    } finally {
      setShareLoading(false);
    }
  };

  const handleCopyShareUrl = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setShareCopied(true);
    toast.success("Skopiowano!");
    setTimeout(() => setShareCopied(false), 2000);
  };

  const status = STATUS_LABELS[match.status] ?? { label: match.status, color: "text-muted-foreground" };
  const isActive = match.status === "in_progress" || match.status === "selecting";
  const winner = match.players.find((p) => p.user_id === match.winner_id);
  const startDate = match.started_at ? new Date(match.started_at) : null;
  const endDate = match.finished_at ? new Date(match.finished_at) : null;
  const durationMin = startDate && endDate ? Math.round((endDate.getTime() - startDate.getTime()) / 60000) : null;

  return (
    <div className="animate-page-in space-y-3 md:space-y-8 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* Header */}
      <div className="px-4 md:px-0">
        <div className="flex items-center gap-2 mb-1 md:mb-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center h-9 w-9 md:h-auto md:w-auto md:gap-2 rounded-full md:rounded-lg text-muted-foreground transition-all hover:text-foreground hover:bg-muted active:scale-[0.95]"
          >
            <ArrowLeft className="h-4 w-4 md:h-5 md:w-5" />
            <span className="hidden md:inline text-base">Panel</span>
          </Link>
          <h1 className="font-display text-lg md:hidden text-foreground">Mecz</h1>
        </div>
        <h1 className="hidden md:block font-display text-5xl text-foreground">Szczegóły meczu</h1>

        {/* Action buttons */}
        <div className="flex gap-2 mt-3 md:mt-4">
          {match.status === "finished" && (
            <>
              <Link
                href={`/replay/${match.id}`}
                className="inline-flex items-center gap-1.5 md:gap-2 rounded-full md:rounded-2xl border border-accent/25 bg-accent/10 px-4 py-2 md:px-6 md:py-3 text-sm md:text-base font-semibold md:font-display uppercase tracking-wider text-accent transition-colors hover:bg-accent/20 active:scale-[0.97]"
              >
                <PlayCircle className="h-4 w-4 md:h-5 md:w-5" />
                Replay
              </Link>
              <button
                onClick={handleShare}
                disabled={shareLoading}
                className={`inline-flex items-center gap-1.5 md:gap-2 rounded-full md:rounded-2xl border px-4 py-2 md:px-6 md:py-3 text-sm md:text-base font-semibold md:font-display uppercase tracking-wider transition-colors disabled:opacity-50 active:scale-[0.97] ${
                  shareUrl ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {shareLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4 md:h-5 md:w-5" />}
                <span className="hidden md:inline">Udostępnij</span>
                <span className="md:hidden">Share</span>
              </button>
            </>
          )}
          {isActive && (
            <button
              className="inline-flex items-center gap-2 rounded-full md:rounded-2xl bg-primary px-5 py-2.5 md:px-8 md:py-3.5 text-sm md:text-lg font-semibold md:font-display uppercase tracking-wider text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition-all"
              onClick={() => router.push(`/game/${match.id}`)}
            >
              <Shield className="h-4 w-4 md:h-6 md:w-6" />
              Wróć do gry
            </button>
          )}
        </div>

        {/* Share panel */}
        {shareUrl && (() => {
          const title = `MapLord — ${winner ? `${winner.username} wygrał!` : "Wyniki meczu"}`;
          const platforms = [
            {
              name: "X (Twitter)",
              href: `https://x.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(shareUrl)}`,
              color: "hover:bg-[#1da1f2]/10 hover:border-[#1da1f2]/30 hover:text-[#1da1f2]",
              icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>,
            },
            {
              name: "Facebook",
              href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(title)}`,
              color: "hover:bg-[#1877f2]/10 hover:border-[#1877f2]/30 hover:text-[#1877f2]",
              icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 1.09.07 1.373.14v3.324c-.149-.016-.41-.023-.733-.023-1.04 0-1.443.394-1.443 1.418v2.7h4.057l-.695 3.666h-3.362v8.127C19.396 23.145 24 18.07 24 12A12 12 0 1 0 9.101 23.691"/></svg>,
            },
            {
              name: "Reddit",
              href: `https://reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(title)}`,
              color: "hover:bg-[#ff4500]/10 hover:border-[#ff4500]/30 hover:text-[#ff4500]",
              icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-.028.028L12 24l8.513-3.487.028.028C22.657 18.314 24 15.314 24 12c0-6.627-5.373-12-12-12zm5.951 13.49c.03.193.046.39.046.59 0 3.013-3.495 5.46-7.8 5.46-4.305 0-7.8-2.447-7.8-5.46 0-.2.016-.397.046-.59A1.745 1.745 0 0 1 1.5 12.26a1.75 1.75 0 0 1 2.97-1.26c1.143-.82 2.728-1.35 4.53-1.42l.856-4.04a.375.375 0 0 1 .444-.295l2.829.6a1.25 1.25 0 1 1-.14.648l-2.54-.54-.76 3.58c1.77.08 3.33.61 4.456 1.42A1.75 1.75 0 0 1 17.95 13.49zM8.5 13.5a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0zm6.25 1.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5zm-1.063 2.14c-.91.567-2.465.567-3.374 0a.375.375 0 1 1 .393-.64c.65.405 1.938.405 2.588 0a.375.375 0 1 1 .393.64z"/></svg>,
            },
          ];
          return (
            <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3 md:p-4 space-y-3">
              {/* URL + copy */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 min-w-0 bg-transparent text-xs md:text-sm text-foreground font-mono truncate outline-none"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  onClick={handleCopyShareUrl}
                  className={`flex items-center gap-1.5 shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-[0.95] ${
                    shareCopied ? "bg-green-500/15 text-green-400" : "bg-primary/15 text-primary hover:bg-primary/25"
                  }`}
                >
                  {shareCopied ? <Check className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
                  {shareCopied ? "Skopiowano" : "Kopiuj link"}
                </button>
              </div>
              {/* Platform buttons */}
              <div className="flex gap-2 md:gap-2.5">
                {platforms.map((p) => (
                  <a
                    key={p.name}
                    href={p.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-2 md:px-4 md:py-2.5 text-xs md:text-sm font-medium text-foreground/70 transition-all active:scale-[0.95] ${p.color}`}
                  >
                    {p.icon}
                    <span className="hidden md:inline">{p.name}</span>
                  </a>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Stats — horizontal scroll on mobile, grid on desktop */}
      <div className="animate-stagger flex gap-2.5 overflow-x-auto px-4 pb-1 md:px-0 md:grid md:grid-cols-2 lg:grid-cols-4 md:gap-4 md:overflow-visible scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="hover-lift flex shrink-0 items-center gap-2.5 rounded-2xl bg-card/60 md:bg-card border border-transparent md:border-border px-3.5 py-3 md:p-5 md:flex-col md:items-start md:gap-2 min-w-[120px] md:min-w-0">
          <Swords className="h-4 w-4 md:h-5 md:w-5 text-primary" />
          <span className="text-[10px] md:text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">Status</span>
          <span className={`font-display text-lg md:text-3xl ml-auto md:ml-0 ${status.color}`}>{status.label}</span>
        </div>
        <div className="hover-lift flex shrink-0 items-center gap-2.5 rounded-2xl bg-card/60 md:bg-card border border-transparent md:border-border px-3.5 py-3 md:p-5 md:flex-col md:items-start md:gap-2 min-w-[100px] md:min-w-0">
          <Users className="h-4 w-4 md:h-5 md:w-5 text-primary" />
          <span className="text-[10px] md:text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">Gracze</span>
          <span className="font-display text-lg md:text-3xl text-foreground ml-auto md:ml-0">{match.players.length}/{match.max_players}</span>
        </div>
        <div className="hover-lift flex shrink-0 items-center gap-2.5 rounded-2xl bg-card/60 md:bg-card border border-transparent md:border-border px-3.5 py-3 md:p-5 md:flex-col md:items-start md:gap-2 min-w-[100px] md:min-w-0">
          <Clock className="h-4 w-4 md:h-5 md:w-5 text-primary" />
          <span className="text-[10px] md:text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">Czas</span>
          <span className="font-display text-lg md:text-3xl text-foreground ml-auto md:ml-0">
            {result ? formatDuration(result.duration_seconds) : durationMin != null ? `${durationMin}m` : "—"}
          </span>
        </div>
        {winner && (
          <div className="hover-lift flex shrink-0 items-center gap-2.5 rounded-2xl bg-accent/5 md:bg-card border border-accent/20 md:border-accent/25 px-3.5 py-3 md:p-5 md:flex-col md:items-start md:gap-2 min-w-[120px] md:min-w-0">
            <Crown className="h-4 w-4 md:h-5 md:w-5 text-accent" />
            <span className="text-[10px] md:text-xs uppercase tracking-[0.15em] text-accent/70 font-medium">Zwycięzca</span>
            <span className="font-display text-lg md:text-3xl text-accent ml-auto md:ml-0">{winner.username}</span>
          </div>
        )}
      </div>

      {/* Timestamps */}
      {(match.started_at || match.finished_at) && (
        <div className="flex flex-wrap gap-3 md:gap-6 text-xs md:text-base text-muted-foreground px-4 md:px-0">
          {match.started_at && <span>Start: <span className="text-foreground">{formatDate(match.started_at)}</span></span>}
          {match.finished_at && <span>Koniec: <span className="text-foreground">{formatDate(match.finished_at)}</span></span>}
          {result && <span>Ticki: <span className="text-foreground">{result.total_ticks}</span></span>}
        </div>
      )}

      {/* MVP + ELO + Stats/min */}
      {result && result.player_results.length > 0 && (() => {
        /* data-animate handled inside */
        const durationMin = result.duration_seconds / 60;
        const mvp = [...result.player_results].sort((a, b) => {
          const scoreA = a.regions_conquered * 3 + a.units_produced + a.buildings_built * 2 - a.units_lost;
          const scoreB = b.regions_conquered * 3 + b.units_produced + b.buildings_built * 2 - b.units_lost;
          return scoreB - scoreA;
        })[0];
        const mvpPlayer = match.players.find((p) => p.user_id === mvp.user_id);

        return (
          <div className="px-4 md:px-0 space-y-3 md:space-y-4">
            {/* MVP banner */}
            <div className="flex items-center gap-3 md:gap-4 rounded-2xl border border-accent/20 bg-accent/5 p-3 md:p-4">
              <div className="flex h-10 w-10 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-xl bg-accent/15">
                <Award className="h-5 w-5 md:h-6 md:w-6 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] md:text-xs uppercase tracking-[0.15em] text-accent/70 font-medium">MVP meczu</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {mvpPlayer && <div className="h-4 w-4 md:h-5 md:w-5 rounded-md border border-border" style={{ backgroundColor: mvpPlayer.color }} />}
                  <span className="font-display text-lg md:text-xl text-foreground">{mvp.username}</span>
                </div>
              </div>
              <div className="flex gap-3 md:gap-4 shrink-0 text-center">
                <div>
                  <div className="font-display text-base md:text-lg text-primary tabular-nums">{mvp.regions_conquered}</div>
                  <div className="text-[9px] md:text-[10px] text-muted-foreground uppercase">Regiony</div>
                </div>
                <div>
                  <div className="font-display text-base md:text-lg text-foreground tabular-nums">{mvp.units_produced}</div>
                  <div className="text-[9px] md:text-[10px] text-muted-foreground uppercase">Jednostki</div>
                </div>
                <div>
                  <div className="font-display text-base md:text-lg text-accent tabular-nums">{mvp.buildings_built}</div>
                  <div className="text-[9px] md:text-[10px] text-muted-foreground uppercase">Budynki</div>
                </div>
              </div>
            </div>

            {/* ELO changes + Stats/min */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              {/* ELO changes */}
              <div className="rounded-2xl border border-border bg-card/50 md:bg-card p-3 md:p-4">
                <p className="text-[10px] md:text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-2 md:mb-3">Zmiana ELO</p>
                <div className="space-y-2">
                  {result.player_results.map((pr) => {
                    const player = match.players.find((p) => p.user_id === pr.user_id);
                    return (
                      <div key={pr.user_id} className="flex items-center gap-2.5">
                        {player && <div className="h-4 w-4 rounded-md border border-border shrink-0" style={{ backgroundColor: player.color }} />}
                        <span className="text-sm text-foreground flex-1 truncate">{pr.username}</span>
                        <span className={`font-display text-base md:text-lg tabular-nums font-semibold flex items-center gap-1 ${
                          pr.elo_change > 0 ? "text-green-400" : pr.elo_change < 0 ? "text-destructive" : "text-muted-foreground"
                        }`}>
                          {pr.elo_change > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : pr.elo_change < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : null}
                          {pr.elo_change > 0 ? "+" : ""}{pr.elo_change}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Stats per minute */}
              {durationMin > 0 && (
                <div className="rounded-2xl border border-border bg-card/50 md:bg-card p-3 md:p-4">
                  <div className="flex items-center gap-1.5 mb-2 md:mb-3">
                    <Zap className="h-3.5 w-3.5 text-primary" />
                    <p className="text-[10px] md:text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">Tempo gry (na minutę)</p>
                  </div>
                  <div className="space-y-2">
                    {result.player_results.map((pr) => {
                      const player = match.players.find((p) => p.user_id === pr.user_id);
                      const regPerMin = (pr.regions_conquered / durationMin).toFixed(1);
                      const unitsPerMin = (pr.units_produced / durationMin).toFixed(1);
                      return (
                        <div key={pr.user_id} className="flex items-center gap-2.5">
                          {player && <div className="h-4 w-4 rounded-md border border-border shrink-0" style={{ backgroundColor: player.color }} />}
                          <span className="text-sm text-foreground truncate flex-1">{pr.username}</span>
                          <div className="flex gap-3 shrink-0 text-xs md:text-sm tabular-nums">
                            <span className="text-primary">{regPerMin} <span className="text-muted-foreground text-[10px]">reg</span></span>
                            <span className="text-foreground">{unitsPerMin} <span className="text-muted-foreground text-[10px]">jedn</span></span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Charts */}
      {result && result.player_results.length > 0 && (
        <div className="px-4 md:px-0">
          <MatchCharts match={match} result={result} />
        </div>
      )}

      {/* Players — mobile: list, desktop: table */}
      <div className="px-4 md:px-0">
        <p className="text-[11px] md:hidden uppercase tracking-[0.18em] text-muted-foreground font-medium mb-2">Gracze</p>

        {/* Mobile: clean player cards */}
        <div className="md:hidden space-y-2">
          {match.players.map((player) => {
            const isMe = player.user_id === user?.id;
            const isWinner = player.user_id === match.winner_id;
            const pr = result?.player_results.find((r) => r.user_id === player.user_id);

            return (
              <button
                key={player.id}
                className={`hover-lift flex w-full items-center gap-3 rounded-xl p-3 text-left transition-all active:scale-[0.98] ${
                  isWinner ? "bg-accent/5 border border-accent/15" : "bg-card/60 border border-transparent"
                }`}
                onClick={() => router.push(`/profile/${player.user_id}`)}
              >
                <div className="h-8 w-8 rounded-lg border border-border shrink-0" style={{ backgroundColor: player.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-foreground truncate">{player.username}</span>
                    {isMe && <span className="text-[10px] font-bold text-primary">Ty</span>}
                    {isWinner && <Crown className="h-3.5 w-3.5 text-accent" />}
                    {player.is_banned && <BannedBadge />}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {!player.is_alive && <span className="text-[10px] text-destructive font-medium">Wyeliminowany</span>}
                    {pr && <span className="text-[10px] text-muted-foreground">Regiony: {pr.regions_conquered}</span>}
                  </div>
                </div>
                {pr && (
                  <span className={`font-display text-base tabular-nums shrink-0 ${
                    pr.elo_change > 0 ? "text-green-400" : pr.elo_change < 0 ? "text-destructive" : "text-muted-foreground"
                  }`}>
                    {pr.elo_change > 0 ? "+" : ""}{pr.elo_change}
                  </span>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
              </button>
            );
          })}
        </div>

        {/* Desktop: full table */}
        <Card className="hidden md:block rounded-2xl overflow-hidden">
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
                    className={`hover-lift cursor-pointer ${
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
                            {player.is_banned && <BannedBadge />}
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
    </div>
  );
}
