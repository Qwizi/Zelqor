"use client";

import { memo, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { GamePlayer } from "@/hooks/useGameSocket";
import type { DiplomacyState, War } from "@/lib/gameTypes";

// ─── Props ────────────────────────────────────────────────────────────────────

interface DiplomacyPanelProps {
  players: Record<string, GamePlayer>;
  currentPlayerId: string;
  diplomacy: DiplomacyState;
  currentTick: number;
  onProposePact: (targetPlayerId: string) => void;
  onRespondPact: (proposalId: string, accept: boolean) => void;
  onProposePeace: (targetPlayerId: string, conditionType: string, provincesToReturn?: string[]) => void;
  onRespondPeace: (proposalId: string, accept: boolean) => void;
  onBreakPact: (pactId: string) => void;
  onDeclareWar: (targetPlayerId: string) => void;
  /** When "dialog-only", only renders the peace proposal dialog (no panel). */
  renderMode?: "dialog-only" | "full";
}

// ─── Peace proposal dialog ────────────────────────────────────────────────────

interface PeaceDialogProps {
  targetPlayer: GamePlayer;
  war: War;
  currentPlayerId: string;
  onPropose: (conditionType: string, provincesToReturn?: string[]) => void;
  onClose: () => void;
}

function PeaceDialog({ targetPlayer, war, currentPlayerId, onPropose, onClose }: PeaceDialogProps) {
  const [conditionType, setConditionType] = useState<"status_quo" | "return_provinces">("status_quo");
  const [selectedProvinces, setSelectedProvinces] = useState<Set<string>>(new Set());

  const conqueredProvinces = useMemo(() => {
    return war.provinces_changed.filter(
      (pc) => pc.from_player_id === targetPlayer.user_id && pc.to_player_id === currentPlayerId,
    );
  }, [war.provinces_changed, targetPlayer.user_id, currentPlayerId]);

  const toggleProvince = (regionId: string) => {
    setSelectedProvinces((prev) => {
      const next = new Set(prev);
      if (next.has(regionId)) next.delete(regionId);
      else next.add(regionId);
      return next;
    });
  };

  const handleSubmit = () => {
    const provinces = conditionType === "return_provinces" ? Array.from(selectedProvinces) : undefined;
    onPropose(conditionType, provinces);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <h3 className="mb-1 font-display text-base font-semibold text-foreground">Zaproponuj pokoj</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Do:{" "}
          <span style={{ color: targetPlayer.color }} className="font-medium">
            {targetPlayer.clan_tag && `[${targetPlayer.clan_tag}] `}
            {targetPlayer.username}
          </span>
        </p>

        <div className="mb-4 space-y-2">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Warunki pokoju</p>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="radio"
              name="condition"
              value="status_quo"
              checked={conditionType === "status_quo"}
              onChange={() => setConditionType("status_quo")}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span className="text-sm text-foreground">Status quo (bez zmian)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="radio"
              name="condition"
              value="return_provinces"
              checked={conditionType === "return_provinces"}
              onChange={() => setConditionType("return_provinces")}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span className="text-sm text-foreground">Oddaj prowincje</span>
          </label>
        </div>

        {conditionType === "return_provinces" && (
          <div className="mb-4">
            {conqueredProvinces.length === 0 ? (
              <p className="text-xs text-muted-foreground">Brak zdobytych prowincji w tej wojnie.</p>
            ) : (
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                <p className="text-xs text-muted-foreground">Wybierz prowincje do zwrotu:</p>
                {conqueredProvinces.map((pc) => (
                  <label key={pc.region_id} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedProvinces.has(pc.region_id)}
                      onChange={() => toggleProvince(pc.region_id)}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    <span className="text-sm text-foreground">{pc.region_id}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} className="flex-1">
            Anuluj
          </Button>
          <Button size="sm" onClick={handleSubmit} className="flex-1">
            Wyslij propozycje
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default memo(function DiplomacyPanel({
  players,
  currentPlayerId,
  diplomacy,
  onProposePeace,
  renderMode = "full",
}: DiplomacyPanelProps) {
  const [peaceTarget, setPeaceTarget] = useState<string | null>(null);

  const getWar = (opponentId: string) =>
    diplomacy.wars.find(
      (w) =>
        (w.player_a === currentPlayerId && w.player_b === opponentId) ||
        (w.player_b === currentPlayerId && w.player_a === opponentId),
    ) ?? null;

  const warForPeaceTarget = peaceTarget ? getWar(peaceTarget) : null;
  const targetPlayerData = peaceTarget ? players[peaceTarget] : null;

  // In dialog-only mode, we only render the peace dialog (triggered externally via onProposePeace).
  // The panel UI is now integrated into GameHUD.
  if (renderMode === "dialog-only") {
    // Peace dialog is only shown if the peace proposal was triggered with "status_quo"
    // from GameHUD. For full peace dialog with province selection, we need a way to trigger it.
    // For now, the dialog-only mode doesn't render anything — peace proposals from GameHUD
    // go directly as status_quo.
    return null;
  }

  return (
    <>
      {peaceTarget && warForPeaceTarget && targetPlayerData && (
        <PeaceDialog
          targetPlayer={targetPlayerData}
          war={warForPeaceTarget}
          currentPlayerId={currentPlayerId}
          onPropose={(conditionType, provincesToReturn) =>
            onProposePeace(peaceTarget, conditionType, provincesToReturn)
          }
          onClose={() => setPeaceTarget(null)}
        />
      )}
    </>
  );
});
