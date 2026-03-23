// ── Planned moves queue management ───────────────────────────────────────────
// Extracted from game page — handles execute, clear, undo, auto-expire.

import { useState, useCallback, useEffect } from "react";
import type { PlannedMove } from "@/lib/gameTypes";
import { PLAN_EXPIRY_S, AP_COSTS } from "@/lib/gameTypes";
import { toast } from "sonner";

interface GameStateRef {
  current: {
    regions?: Record<string, {
      owner_id?: string | null;
      units?: Record<string, number>;
      action_cooldowns?: Record<string, number>;
    }>;
    players: Record<string, { action_points?: number }>;
    meta?: { current_tick?: string };
  } | null;
}

export function usePlannedMoves(
  myUserId: string,
  gameStateRef: GameStateRef,
  attack: (sourceId: string, targetId: string, units: number, unitType: string) => void,
  move: (sourceId: string, targetId: string, units: number, unitType: string) => void,
  bombard: (sourceId: string, targetIds: string[], units: number) => void,
  onClear: () => void, // callback to reset selection state in parent
) {
  const [plannedMoves, setPlannedMoves] = useState<PlannedMove[]>([]);
  const [planningMode, setPlanningMode] = useState(false);

  const executePlannedMoves = useCallback(() => {
    const now = Date.now();
    let executed = 0;
    let skipped = 0;
    const currentRegions = gameStateRef.current?.regions ?? {};
    const currentTick = parseInt(gameStateRef.current?.meta?.current_tick || "0", 10);

    const committed = new Map<string, number>();
    const rawAP = gameStateRef.current?.players[myUserId]?.action_points;
    let apRemaining = rawAP ?? 999;

    for (const pm of plannedMoves) {
      if (now - pm.createdAt > PLAN_EXPIRY_S * 1000) { skipped++; continue; }

      const source = currentRegions[pm.sourceId];
      if (!source || source.owner_id !== myUserId) { skipped++; continue; }

      const key = `${pm.sourceId}:${pm.unitType}`;
      const alreadySent = committed.get(key) ?? 0;
      const available = (source.units?.[pm.unitType] ?? 0) - alreadySent;

      if (available <= 0) { skipped++; continue; }

      const isAttackAction = pm.actionType === "attack" || pm.actionType === "bombard";
      const apCost = isAttackAction ? AP_COSTS.attack : AP_COSTS.move;
      if (apRemaining < apCost) { skipped++; continue; }

      if (isAttackAction && (source.action_cooldowns?.attack ?? 0) > currentTick) { skipped++; continue; }
      if (!isAttackAction && pm.actionType === "move" && (source.action_cooldowns?.move ?? 0) > currentTick) { skipped++; continue; }

      const units = Math.min(pm.unitCount, available);
      committed.set(key, alreadySent + units);
      apRemaining -= apCost;

      if (pm.actionType === "bombard") {
        bombard(pm.sourceId, [pm.targetId], units);
      } else if (pm.actionType === "attack") {
        attack(pm.sourceId, pm.targetId, units, pm.unitType);
      } else {
        move(pm.sourceId, pm.targetId, units, pm.unitType);
      }
      executed++;
    }
    setPlannedMoves([]);
    setPlanningMode(false);
    onClear();
    if (executed > 0) {
      const msg = skipped > 0
        ? `Wykonano ${executed} ruchow (${skipped} pominieto — brak jednostek)`
        : `Wykonano ${executed} ruchow!`;
      toast.success(msg, { id: "plan-exec", duration: 3000 });
    } else if (skipped > 0) {
      toast.warning("Nie wykonano zadnych ruchow — brak jednostek lub prowincje utracone", { id: "plan-exec", duration: 3000 });
    }
  }, [plannedMoves, attack, move, bombard, myUserId, onClear]);

  const clearPlannedMoves = useCallback(() => {
    if (plannedMoves.length > 0 || planningMode) {
      toast.info("Plan anulowany", { id: "plan-cancel", duration: 1500 });
    }
    setPlannedMoves([]);
    setPlanningMode(false);
    onClear();
  }, [plannedMoves, planningMode, onClear]);

  const undoLastPlannedMove = useCallback(() => {
    if (plannedMoves.length === 0) return;
    setPlannedMoves(prev => prev.slice(0, -1));
    toast.info(`Cofnieto ruch (${plannedMoves.length - 1} pozostalo)`, { id: "plan-undo", duration: 1500 });
  }, [plannedMoves]);

  // Auto-expire old planned moves every second
  useEffect(() => {
    if (plannedMoves.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setPlannedMoves(prev => {
        const filtered = prev.filter(pm => now - pm.createdAt <= PLAN_EXPIRY_S * 1000);
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [plannedMoves.length]);

  return {
    plannedMoves,
    setPlannedMoves,
    planningMode,
    setPlanningMode,
    executePlannedMoves,
    clearPlannedMoves,
    undoLastPlannedMove,
  };
}
