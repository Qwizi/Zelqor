"use client";

import { useState } from "react";
import { Swords, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GameRegion } from "@/hooks/useGameSocket";

export interface TargetEntry {
  regionId: string;
  region: GameRegion;
  name: string;
  isAttack: boolean;
}

interface ActionBarProps {
  sourceRegion: GameRegion;
  sourceName: string;
  targets: TargetEntry[];
  onConfirm: (allocations: { regionId: string; units: number }[]) => void;
  onRemoveTarget: (regionId: string) => void;
  onCancel: () => void;
}

export default function ActionBar({
  sourceRegion,
  sourceName,
  targets,
  onConfirm,
  onRemoveTarget,
  onCancel,
}: ActionBarProps) {
  const [maxUnits] = useState(sourceRegion.unit_count);
  const [totalUnits, setTotalUnits] = useState(
    Math.max(1, Math.floor(maxUnits / 2))
  );

  if (maxUnits < 1 || targets.length === 0) return null;

  const hasAttack = targets.some((t) => t.isAttack);
  const accentAttack = "border-red-800/60 bg-red-950/90";
  const accentMove = "border-blue-800/60 bg-blue-950/90";

  // Equal split — remainder goes to first target
  const perTarget = Math.max(1, Math.floor(totalUnits / targets.length));
  const allocations = targets.map((t, i) => ({
    regionId: t.regionId,
    units: i === 0 ? totalUnits - perTarget * (targets.length - 1) : perTarget,
  }));

  return (
    <div className="absolute bottom-8 left-1/2 z-30 -translate-x-1/2 animate-in slide-in-from-bottom-4 fade-in duration-200">
      <div
        className={`min-w-[420px] max-w-[520px] rounded-xl border p-5 shadow-2xl backdrop-blur-md ${
          hasAttack ? accentAttack : accentMove
        }`}
      >
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-bold text-white">{sourceName}</span>
            <span className="text-xs text-zinc-400">
              ({sourceRegion.unit_count}🪖)
            </span>
          </div>
          <button
            onClick={onCancel}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Target list */}
        <div className="mb-3 space-y-1.5">
          {targets.map((t, i) => (
            <div
              key={t.regionId}
              className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-sm ${
                t.isAttack ? "bg-red-900/40" : "bg-blue-900/40"
              }`}
            >
              {t.isAttack ? (
                <Swords className="h-3.5 w-3.5 shrink-0 text-red-400" />
              ) : (
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-blue-400" />
              )}
              <span className="flex-1 font-medium text-white">{t.name}</span>
              <span className="font-mono text-xs text-zinc-400">
                {allocations[i].units}🪖
              </span>
              <button
                onClick={() => onRemoveTarget(t.regionId)}
                className="ml-1 rounded p-0.5 text-zinc-500 hover:text-zinc-200"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Total unit slider */}
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-zinc-400">
              Łącznie{targets.length > 1 ? ` (${targets.length} cele)` : ""}
            </span>
            <span className="font-mono text-lg font-bold text-white">
              {totalUnits}
            </span>
          </div>
          <input
            type="range"
            min={targets.length}
            max={maxUnits}
            value={totalUnits}
            onChange={(e) => setTotalUnits(Number(e.target.value))}
            className={`w-full ${hasAttack ? "accent-red-500" : "accent-blue-500"}`}
          />
          <div className="mt-0.5 flex justify-between text-xs text-zinc-500">
            <span>{targets.length}</span>
            <span>{maxUnits}</span>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={() => onConfirm(allocations)}
            className={`flex-1 font-semibold ${
              hasAttack
                ? "bg-red-600 text-white hover:bg-red-500"
                : "bg-blue-600 text-white hover:bg-blue-500"
            }`}
          >
            {hasAttack ? (
              <>
                <Swords className="mr-2 h-4 w-4" /> Wyślij wojska
              </>
            ) : (
              <>
                <ArrowRight className="mr-2 h-4 w-4" /> Przenieś
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={onCancel}
            className="border-zinc-700 text-zinc-300"
          >
            Anuluj
          </Button>
        </div>
      </div>
    </div>
  );
}
