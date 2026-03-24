"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Check,
  Coins,
  ExternalLink,
  Loader2,
  Swords,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import {
  useWar,
  useWarParticipants,
  useMyClan,
  useAcceptWar,
  useDeclineWar,
  useJoinWar,
  useLeaveWar,
  useCancelWar,
} from "@/hooks/queries";
import { APIError } from "@/lib/api";
import type { ClanWarOut, ClanWarParticipantOut } from "@/lib/api";

// ── Constants ──

const WAR_STATUS_LABELS: Record<string, string> = {
  pending: "Oczekująca",
  accepted: "Zaakceptowana",
  in_progress: "W trakcie",
  finished: "Zakończona",
  declined: "Odrzucona",
  cancelled: "Anulowana",
};

const WAR_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  accepted: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  in_progress: "bg-primary/15 text-primary border-primary/20",
  finished: "bg-muted text-muted-foreground border-border",
  declined: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-muted text-muted-foreground border-border",
};

// ── Sub-components ──

function WarStatusBanner({ war }: { war: ClanWarOut }) {
  const label = WAR_STATUS_LABELS[war.status] ?? war.status;
  const color = WAR_STATUS_COLORS[war.status] ?? "bg-muted text-muted-foreground border-border";
  return (
    <div className={`flex items-center justify-center rounded-2xl border px-6 py-4 mx-4 md:mx-0 ${color}`}>
      <span className="font-display text-xl md:text-2xl font-bold tracking-wide">{label}</span>
    </div>
  );
}

function ClanCard({
  clan,
  side,
  eloChange,
  isWinner,
}: {
  clan: ClanWarOut["challenger"] | ClanWarOut["defender"];
  side: "challenger" | "defender";
  eloChange: number;
  isWinner: boolean;
}) {
  const sideLabel = side === "challenger" ? "Atakujący" : "Obrońca";
  return (
    <div
      className={`flex flex-col items-center gap-3 rounded-2xl border p-5 flex-1 ${
        isWinner
          ? "border-yellow-500/40 bg-yellow-500/5"
          : "border-border bg-card/50"
      }`}
    >
      {isWinner && (
        <Trophy className="h-4 w-4 text-yellow-400" />
      )}
      <div
        className="flex h-14 w-14 items-center justify-center rounded-xl font-display text-lg font-bold text-white"
        style={{ backgroundColor: clan.color }}
      >
        {clan.tag}
      </div>
      <div className="text-center">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium mb-0.5">{sideLabel}</p>
        <p className="text-sm font-bold text-foreground">[{clan.tag}] {clan.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">Lv. {clan.level} &middot; {clan.elo_rating} ELO</p>
      </div>
      {eloChange !== 0 && (
        <span className={`text-sm font-bold tabular-nums ${eloChange > 0 ? "text-green-400" : "text-destructive"}`}>
          {eloChange > 0 ? "+" : ""}{eloChange} ELO
        </span>
      )}
    </div>
  );
}

function ParticipantSlot({
  participant,
  isEmpty,
}: {
  participant?: ClanWarParticipantOut;
  isEmpty?: boolean;
}) {
  if (isEmpty || !participant) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-border px-3 py-2.5">
        <div className="h-7 w-7 rounded-lg border border-dashed border-border" />
        <span className="text-xs text-muted-foreground/50">Wolne miejsce</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-secondary/40 px-3 py-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-xs font-bold uppercase text-foreground">
        {participant.user.username.charAt(0)}
      </div>
      <span className="text-sm font-medium text-foreground truncate">{participant.user.username}</span>
      <span className="ml-auto text-xs text-muted-foreground tabular-nums">{participant.user.elo_rating} ELO</span>
    </div>
  );
}

function ParticipantColumn({
  title,
  clanColor,
  participants,
  totalSlots,
}: {
  title: string;
  clanColor: string;
  participants: ClanWarParticipantOut[];
  totalSlots: number;
}) {
  const filledCount = participants.length;
  const emptySlots = Math.max(0, totalSlots - filledCount);
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: clanColor }} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{title}</span>
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{filledCount}/{totalSlots}</span>
      </div>
      <div className="space-y-1.5">
        {participants.map((p) => (
          <ParticipantSlot key={p.id} participant={p} />
        ))}
        {Array.from({ length: emptySlots }).map((_, i) => (
          <ParticipantSlot key={`empty-${i}`} isEmpty />
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──

export default function WarDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const warId = params.warId as string;

  const { data: war, isLoading: warLoading } = useWar(warId);
  const { data: participants = [], isLoading: participantsLoading } = useWarParticipants(warId);
  const { data: myClanData } = useMyClan();

  const acceptMut = useAcceptWar();
  const declineMut = useDeclineWar();
  const joinMut = useJoinWar();
  const leaveMut = useLeaveWar();
  const cancelMut = useCancelWar();

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  if (authLoading || warLoading) {
    return (
      <div className="animate-page-in space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
        <div className="px-4 md:px-0 flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-16 w-full rounded-2xl mx-4 md:mx-0" />
        <div className="flex gap-3 px-4 md:px-0">
          <Skeleton className="h-40 flex-1 rounded-2xl" />
          <Skeleton className="h-10 w-10 rounded-xl self-center shrink-0" />
          <Skeleton className="h-40 flex-1 rounded-2xl" />
        </div>
        <Skeleton className="h-48 w-full rounded-2xl mx-4 md:mx-0" />
      </div>
    );
  }

  if (!war) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-14 text-center mx-4 md:mx-0">
        <Swords size={32} className="text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Wojna nie znaleziona.</p>
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft size={14} className="mr-1.5" />
          Wróć
        </Button>
      </div>
    );
  }

  // Compute user context
  const myMembership = myClanData?.membership;
  const myClanId = myClanData?.clan?.id;
  const myRole = myMembership?.role;
  const isOfficer = myRole === "officer" || myRole === "leader";

  const isChallenger = myClanId === war.challenger.id;
  const isDefender = myClanId === war.defender.id;
  const isMemberOfEitherClan = isChallenger || isDefender;

  const challengerParticipants = participants.filter((p) => p.clan_id === war.challenger.id);
  const defenderParticipants = participants.filter((p) => p.clan_id === war.defender.id);

  const myUserId = user?.id;
  const isParticipant = participants.some((p) => p.user.id === myUserId);

  const mySideParticipants = isChallenger ? challengerParticipants : defenderParticipants;
  const mySideFull = mySideParticipants.length >= war.players_per_side;

  const challengerWon = war.winner_id === war.challenger.id;
  const defenderWon = war.winner_id === war.defender.id;

  // Back link: go to whichever clan the user is in, or challenger's clan
  const backClanId = myClanId ?? war.challenger.id;

  const handleApiError = (err: unknown, fallback: string) => {
    toast.error(err instanceof APIError ? err.message : fallback);
  };

  return (
    <div className="animate-page-in space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 md:px-0">
        <Link
          href={`/clans/${backClanId}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ArrowLeft size={16} />
        </Link>
        <div>
          <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">KLANY</p>
          <h1 className="font-display text-2xl md:text-4xl text-foreground">Wojna Klanowa</h1>
        </div>
      </div>

      {/* ── Status banner ── */}
      <WarStatusBanner war={war} />

      {/* ── Clan matchup ── */}
      <div className="flex items-center gap-3 px-4 md:px-0">
        <ClanCard
          clan={war.challenger}
          side="challenger"
          eloChange={war.challenger_elo_change}
          isWinner={war.status === "finished" && challengerWon}
        />
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary text-sm font-bold text-muted-foreground">
          VS
        </div>
        <ClanCard
          clan={war.defender}
          side="defender"
          eloChange={war.defender_elo_change}
          isWinner={war.status === "finished" && defenderWon}
        />
      </div>

      {/* ── War details ── */}
      <section className="rounded-2xl border border-border bg-card/50 p-4 md:p-6 mx-4 md:mx-0">
        <p className="mb-3 text-[10px] uppercase tracking-[0.24em] text-muted-foreground font-medium">Szczegóły</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {/* Format */}
          <div className="flex items-start gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary">
              <Swords className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Format</p>
              <p className="text-sm font-semibold text-foreground tabular-nums">{war.players_per_side}v{war.players_per_side}</p>
            </div>
          </div>

          {/* Wager */}
          <div className="flex items-start gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary">
              <Coins className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Stawka</p>
              {war.wager_gold > 0 ? (
                <div>
                  <p className="text-sm font-semibold text-accent tabular-nums">{war.wager_gold.toLocaleString()} / strona</p>
                  <p className="text-[10px] text-muted-foreground tabular-nums">Pula: {(war.wager_gold * 2).toLocaleString()} złota</p>
                </div>
              ) : (
                <p className="text-sm font-semibold text-muted-foreground">Brak</p>
              )}
            </div>
          </div>

          {/* Created */}
          <div className="flex items-start gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Ogłoszono</p>
              <p className="text-sm font-semibold text-foreground">
                {new Date(war.created_at).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
          </div>

          {/* Started / Finished */}
          {(war.started_at || war.finished_at) && (
            <div className="flex items-start gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  {war.finished_at ? "Zakończono" : "Rozpoczęto"}
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {new Date((war.finished_at ?? war.started_at)!).toLocaleDateString("pl-PL", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Result (finished) ── */}
      {war.status === "finished" && war.winner_id && (
        <section className="rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-4 md:p-6 mx-4 md:mx-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-yellow-500/30 bg-yellow-500/10">
              <Trophy className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground font-medium">Wynik</p>
              <p className="text-sm font-bold text-foreground">
                Zwycięzca:{" "}
                <span className="text-yellow-400">
                  [{war.winner_id === war.challenger.id ? war.challenger.tag : war.defender.tag}]{" "}
                  {war.winner_id === war.challenger.id ? war.challenger.name : war.defender.name}
                </span>
              </p>
            </div>
            {war.wager_gold > 0 && (
              <div className="ml-auto text-right">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Nagroda</p>
                <p className="text-sm font-bold text-accent tabular-nums">+{(war.wager_gold * 2).toLocaleString()} złota</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Match link ── */}
      {war.match_id && war.status === "in_progress" && (
        <div className="px-4 md:px-0">
          <Link href={`/game/${war.match_id}`}>
            <Button className="gap-2 h-10 md:h-12 md:text-base md:px-8 w-full sm:w-auto">
              <ExternalLink size={16} />
              Przejdź do meczu
            </Button>
          </Link>
        </div>
      )}
      {war.match_id && war.status === "finished" && (
        <div className="px-4 md:px-0">
          <Link href={`/replay/${war.match_id}`}>
            <Button variant="outline" className="gap-2 h-10 md:h-12 md:text-base md:px-8 w-full sm:w-auto">
              <ExternalLink size={16} />
              Zobacz powtórkę
            </Button>
          </Link>
        </div>
      )}

      {/* ── Participants ── */}
      {(war.status === "accepted" || war.status === "in_progress" || war.status === "finished") && (
        <section className="rounded-2xl border border-border bg-card/50 p-4 md:p-6 mx-4 md:mx-0">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-secondary">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground font-medium">Uczestnicy</p>
          </div>
          {participantsLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="flex gap-4 md:gap-6">
              <ParticipantColumn
                title={`[${war.challenger.tag}] ${war.challenger.name}`}
                clanColor={war.challenger.color}
                participants={challengerParticipants}
                totalSlots={war.players_per_side}
              />
              <div className="w-px bg-border shrink-0" />
              <ParticipantColumn
                title={`[${war.defender.tag}] ${war.defender.name}`}
                clanColor={war.defender.color}
                participants={defenderParticipants}
                totalSlots={war.players_per_side}
              />
            </div>
          )}

          {/* Join / Leave buttons */}
          {isMemberOfEitherClan && war.status === "accepted" && (
            <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-3">
              {!isParticipant && !mySideFull && (
                <Button
                  className="gap-2 h-10 md:h-12 md:text-base md:px-8"
                  disabled={joinMut.isPending}
                  onClick={() =>
                    joinMut.mutate(war.id, {
                      onSuccess: () => toast.success("Dołączono do wojny!"),
                      onError: (err) => handleApiError(err, "Nie udało się dołączyć"),
                    })
                  }
                >
                  {joinMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Swords size={16} />}
                  Dołącz do walki
                </Button>
              )}
              {!isParticipant && mySideFull && (
                <p className="text-sm text-muted-foreground self-center">Twoja strona jest już pełna.</p>
              )}
              {isParticipant && (
                <Button
                  variant="outline"
                  className="gap-2 h-10 md:h-12 md:text-base md:px-8 text-destructive hover:text-destructive border-destructive/20 hover:bg-destructive/10"
                  disabled={leaveMut.isPending}
                  onClick={() =>
                    leaveMut.mutate(war.id, {
                      onSuccess: () => toast.success("Opuszczono wojnę"),
                      onError: (err) => handleApiError(err, "Nie udało się opuścić"),
                    })
                  }
                >
                  {leaveMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                  Opuść wojnę
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Action buttons ── */}
      {isMemberOfEitherClan && (
        <div className="px-4 md:px-0 flex flex-wrap gap-3">
          {/* Defender officers: accept / decline pending war */}
          {war.status === "pending" && isDefender && isOfficer && (
            <>
              <Button
                className="gap-2 h-10 md:h-12 md:text-base md:px-8 bg-green-600 hover:bg-green-700 text-white"
                disabled={acceptMut.isPending}
                onClick={() =>
                  acceptMut.mutate(war.id, {
                    onSuccess: () => toast.success("Zaakceptowano wojnę"),
                    onError: (err) => handleApiError(err, "Nie udało się zaakceptować"),
                  })
                }
              >
                {acceptMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Zaakceptuj wojnę
              </Button>
              <Button
                variant="destructive"
                className="gap-2 h-10 md:h-12 md:text-base md:px-8"
                disabled={declineMut.isPending}
                onClick={() =>
                  declineMut.mutate(war.id, {
                    onSuccess: () => toast.success("Odrzucono wojnę"),
                    onError: (err) => handleApiError(err, "Nie udało się odrzucić"),
                  })
                }
              >
                {declineMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                Odrzuć
              </Button>
            </>
          )}

          {/* Officers of either side: cancel pending or accepted war */}
          {(war.status === "pending" || war.status === "accepted") && isMemberOfEitherClan && isOfficer && (
            <Button
              variant="outline"
              className="gap-2 h-10 md:h-12 md:text-base md:px-8 text-muted-foreground hover:text-foreground"
              disabled={cancelMut.isPending}
              onClick={() =>
                cancelMut.mutate(war.id, {
                  onSuccess: () => {
                    toast.success("Anulowano wojnę");
                    router.push(`/clans/${backClanId}`);
                  },
                  onError: (err) => handleApiError(err, "Nie udało się anulować"),
                })
              }
            >
              {cancelMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
              Anuluj wojnę
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
