"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { GameRegion } from "@/hooks/useGameSocket";
import { getActionAsset, getUnitAsset } from "@/lib/gameAssets";

function getUnitLabel(unitType: string) {
  switch (unitType) {
    case "infantry":
      return "Piechota";
    case "tank":
      return "Czołgi";
    case "ship":
      return "Flota";
    case "fighter":
      return "Lotnictwo";
    default:
      return unitType;
  }
}

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
  selectedUnitType: string;
  selectedUnitScale?: number;
  onSelectedUnitTypeChange: (unitType: string) => void;
  onConfirm: (payload: { allocations: { regionId: string; units: number }[]; unitType: string }) => void;
  onRemoveTarget: (regionId: string) => void;
  onCancel: () => void;
}

export default function ActionBar({
  sourceRegion,
  sourceName,
  targets,
  selectedUnitType,
  selectedUnitScale = 1,
  onSelectedUnitTypeChange,
  onConfirm,
  onRemoveTarget,
  onCancel,
}: ActionBarProps) {
  const availableUnitsByType = sourceRegion.units ?? {};
  const unitTypes = Object.entries(availableUnitsByType).filter(([, count]) => count > 0);
  const maxUnits = availableUnitsByType[selectedUnitType] ?? 0;
  const [totalUnits, setTotalUnits] = useState(
    Math.max(1, Math.floor(maxUnits / 2))
  );

  if (maxUnits < 1 || targets.length === 0) return null;
  const safeTotalUnits = Math.max(Math.min(totalUnits, maxUnits), Math.min(targets.length, maxUnits));

  const hasAttack = targets.some((t) => t.isAttack);
  const accentAttack = "border-red-800/60 bg-red-950/90";
  const accentMove = "border-blue-800/60 bg-blue-950/90";
  const sourceActionAsset = getActionAsset(hasAttack ? "attack" : "move", selectedUnitType);

  // Equal split — remainder goes to first target
  const perTarget = Math.max(1, Math.floor(safeTotalUnits / targets.length));
  const allocations = targets.map((t, i) => ({
    regionId: t.regionId,
    units: i === 0 ? safeTotalUnits - perTarget * (targets.length - 1) : perTarget,
  }));
  const totalPower = safeTotalUnits * selectedUnitScale;

  return (
    <div className="absolute bottom-4 left-1/2 z-30 w-[min(640px,calc(100vw-1rem))] -translate-x-1/2 animate-in slide-in-from-bottom-4 fade-in duration-200">
      <div
        className={`overflow-hidden rounded-[28px] border shadow-2xl backdrop-blur-xl ${
          hasAttack ? accentAttack : accentMove
        }`}
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(2,6,23,0.8), rgba(2,6,23,0.9)), url('/assets/ui/hex_bg_tile.webp')",
          backgroundSize: "cover, 180px",
        }}
      >
        <div className="grid gap-3 p-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-sm">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-2">
                  <Image
                    src={sourceActionAsset}
                    alt=""
                    width={20}
                    height={20}
                    className="h-5 w-5 object-contain opacity-90"
                  />
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                    Region źródłowy
                  </div>
                  <span className="font-display text-lg text-white">{sourceName}</span>
                </div>
              </div>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-zinc-300">
                <span className="inline-flex items-center gap-1.5">
                  <Image
                    src={getUnitAsset(selectedUnitType)}
                    alt=""
                    width={16}
                    height={16}
                    className="h-4 w-4 object-contain"
                  />
                  {maxUnits} nośników
                </span>
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                  Tryb
                </div>
                <div className={`mt-1.5 font-display text-xl ${hasAttack ? "text-red-300" : "text-cyan-200"}`}>
                  {hasAttack ? "Atak" : "Ruch"}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                  Cele
                </div>
                <div className="mt-1.5 font-display text-xl text-zinc-50">
                  {targets.length}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                  Jednostka
                </div>
                <div className="mt-1.5 flex items-center gap-2 font-display text-base text-zinc-50">
                  <Image
                    src={getUnitAsset(selectedUnitType)}
                    alt=""
                    width={18}
                    height={18}
                    className="h-[18px] w-[18px] object-contain"
                  />
                  {getUnitLabel(selectedUnitType)} x{selectedUnitScale}
                </div>
              </div>
            </div>

            {unitTypes.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {unitTypes.map(([unitType, count]) => (
                  <button
                    key={unitType}
                    onClick={() => {
                      onSelectedUnitTypeChange(unitType);
                      setTotalUnits(Math.max(1, Math.min(count, Math.floor(count / 2) || 1)));
                    }}
                    className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] ${
                      unitType === selectedUnitType
                        ? "border-cyan-300/30 bg-cyan-400/15 text-cyan-100"
                        : "border-white/10 bg-white/[0.04] text-zinc-300"
                    }`}
                  >
                    <Image
                      src={getUnitAsset(unitType)}
                      alt=""
                      width={14}
                      height={14}
                      className="h-3.5 w-3.5 object-contain"
                    />
                    {getUnitLabel(unitType)} · {count}
                  </button>
                ))}
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Łączna siła wysyłki
                  </div>
                  <div className="mt-1 flex items-center gap-2 font-display text-2xl text-white">
                    <Image
                      src={getUnitAsset(selectedUnitType)}
                      alt=""
                      width={20}
                      height={20}
                      className="h-5 w-5 object-contain"
                    />
                    {totalPower}
                  </div>
                </div>
                <div className="text-right text-xs text-zinc-400">
                  <div>{safeTotalUnits} nośników</div>
                  <div>x{selectedUnitScale} mocy / szt.</div>
                </div>
              </div>
            </div>

            <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
              {targets.map((t, i) => (
                <div
                  key={t.regionId}
                  className={`flex items-center gap-2 rounded-2xl border px-2.5 py-2 text-sm ${
                    t.isAttack
                      ? "border-red-400/10 bg-red-900/30"
                      : "border-cyan-400/10 bg-cyan-900/25"
                  }`}
                >
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2">
                    <Image
                      src={getActionAsset(t.isAttack ? "attack" : "move", selectedUnitType)}
                      alt=""
                      width={16}
                      height={16}
                      className="h-4 w-4 shrink-0 object-contain"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-white">{t.name}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
                      <span>{allocations[i].units} nośn.</span>
                      <span className="text-zinc-600">•</span>
                      <span>siła {allocations[i].units * selectedUnitScale}</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5 text-right">
                    <div className="font-display text-lg leading-none text-white">
                      {allocations[i].units * selectedUnitScale}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                      siła celu
                    </div>
                  </div>
                  <button
                    onClick={() => onRemoveTarget(t.regionId)}
                    className="ml-1 rounded-full border border-white/10 bg-white/[0.04] p-1.5 text-zinc-500 hover:text-zinc-200"
                  >
                    <Image
                      src={getActionAsset("close")}
                      alt=""
                      width={14}
                      height={14}
                      className="h-3.5 w-3.5 object-contain"
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-black/15 p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                  Podział
                </div>
                <div className="mt-1 font-display text-xl text-zinc-50">
                  Rozdzial wojsk
                </div>
              </div>
              <button
                onClick={onCancel}
                className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                <Image
                  src={getActionAsset("close")}
                  alt=""
                  width={16}
                  height={16}
                  className="h-4 w-4 object-contain"
                />
              </button>
            </div>

            <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-zinc-400">
                  Łącznie{targets.length > 1 ? ` (${targets.length} cele)` : ""}
                </span>
                <span className="font-display text-2xl text-white">
                  {safeTotalUnits}
                </span>
              </div>
              <input
                type="range"
                min={targets.length}
                max={maxUnits}
                value={safeTotalUnits}
                onChange={(e) => setTotalUnits(Number(e.target.value))}
                className={`w-full ${hasAttack ? "accent-red-500" : "accent-blue-500"}`}
              />
              <div className="mt-1 flex justify-between text-xs text-zinc-500">
                <span>{targets.length}</span>
                <span>{maxUnits}</span>
              </div>
              <div className="mt-2 text-xs text-zinc-500">
                Regulujesz liczbę nośników. Faktyczna siła ataku/ruchu: {totalPower}
              </div>
            </div>

            <div className="space-y-2.5">
              <Button
                onClick={() => onConfirm({ allocations, unitType: selectedUnitType })}
                className={`h-10 w-full font-display text-xs uppercase tracking-[0.18em] ${
                  hasAttack
                    ? "bg-red-600 text-white hover:bg-red-500"
                    : "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                }`}
              >
                {hasAttack ? (
                  <>
                    <Image
                      src={getActionAsset("attack", selectedUnitType)}
                      alt=""
                      width={16}
                      height={16}
                      className="mr-2 h-4 w-4 object-contain"
                    />
                    Potwierdz atak
                  </>
                ) : (
                  <>
                    <Image
                      src={getActionAsset("move", selectedUnitType)}
                      alt=""
                      width={16}
                      height={16}
                      className="mr-2 h-4 w-4 object-contain"
                    />
                    Potwierdz ruch
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={onCancel}
                className="h-10 w-full border-zinc-700 text-zinc-300"
              >
                Anuluj
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
