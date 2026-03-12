"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { GameRegion } from "@/hooks/useGameSocket";
import { getActionAsset, getUnitAsset } from "@/lib/gameAssets";

function getUnitLabel(unitType: string) {
  switch (unitType) {
    case "infantry":
      return "Piechota";
    case "tank":
      return "Czolgi";
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
  const liveMax = availableUnitsByType[selectedUnitType] ?? 0;
  const hasAttack = targets.some((target) => target.isAttack);
  const accentClass = hasAttack ? "border-red-800/60" : "border-cyan-900/60";

  // Freeze maxUnits so tick updates don't move the slider while user is interacting.
  // Only update when: unit type changes, or live count grows (new units arrived).
  const [frozenMax, setFrozenMax] = useState(liveMax);
  const prevUnitTypeRef = useRef(selectedUnitType);
  useEffect(() => {
    if (selectedUnitType !== prevUnitTypeRef.current) {
      // Unit type switched — reset to live value
      setFrozenMax(liveMax);
      prevUnitTypeRef.current = selectedUnitType;
    } else if (liveMax > frozenMax) {
      // Units grew (generation) — raise ceiling silently without moving slider
      setFrozenMax(liveMax);
    }
    // If liveMax < frozenMax (units spent elsewhere), keep frozen to avoid slider jump.
    // safeTotalUnits clamp handles the edge case.
  }, [liveMax, selectedUnitType, frozenMax]);

  const maxUnits = Math.max(1, frozenMax);
  const [totalUnits, setTotalUnits] = useState(Math.max(1, Math.floor(maxUnits / 2) || 1));
  const [mobileStep, setMobileStep] = useState<"setup" | "targets">("setup");
  const minUnits = targets.length > 0 ? Math.min(targets.length, maxUnits) : 1;
  const safeTotalUnits = Math.max(Math.min(totalUnits, maxUnits), minUnits);
  const perTarget = targets.length > 0 ? Math.max(1, Math.floor(safeTotalUnits / targets.length)) : 0;
  const allocations = targets.map((target, index) => ({
    regionId: target.regionId,
    units: index === 0 ? safeTotalUnits - perTarget * (targets.length - 1) : perTarget,
  }));

  if (maxUnits < 1) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 px-2 pb-2 sm:left-1/2 sm:right-auto sm:w-[min(600px,calc(100vw-1rem))] sm:-translate-x-1/2 sm:px-0 sm:pb-3">
      <div className={`overflow-hidden rounded-[22px] border bg-slate-950/94 shadow-[0_-10px_32px_rgba(0,0,0,0.28)] backdrop-blur-xl ${accentClass}`}>
        <div className="sm:hidden p-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                {sourceName}
              </div>
              <div className="text-[11px] text-zinc-400">
                {mobileStep === "setup" ? "Jednostka i sila" : "Wybierz cele na mapie"}
              </div>
            </div>
            <button
              onClick={onCancel}
              className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] p-1.5 text-zinc-400"
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

          {mobileStep === "setup" ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                {unitTypes.map(([unitType, count]) => {
                  const active = unitType === selectedUnitType;
                  return (
                    <button
                      key={unitType}
                      onClick={() => onSelectedUnitTypeChange(unitType)}
                      className={`inline-flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left ${
                        active
                          ? "border-cyan-300/30 bg-cyan-400/15 text-cyan-100"
                          : "border-white/10 bg-white/[0.04] text-zinc-300"
                      }`}
                    >
                      <Image
                        src={getUnitAsset(unitType)}
                        alt=""
                        width={18}
                        height={18}
                        className="h-[18px] w-[18px] object-contain"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium leading-none">
                          {getUnitLabel(unitType)}
                        </span>
                        <span className={`mt-0.5 block text-[10px] ${active ? "text-cyan-200/80" : "text-zinc-500"}`}>
                          {count}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                  <span>{hasAttack ? "Atak" : "Przenies"}: {safeTotalUnits} / {maxUnits}</span>
                  <span className="text-amber-200/70">Moc {safeTotalUnits * selectedUnitScale}</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={minUnits}
                    max={maxUnits}
                    value={safeTotalUnits}
                    onChange={(e) => setTotalUnits(Number(e.target.value))}
                    className={`min-w-0 flex-1 ${hasAttack ? "accent-red-500" : "accent-cyan-400"}`}
                  />
                  <div className="w-10 text-right font-display text-lg text-zinc-50">
                    {safeTotalUnits}
                  </div>
                </div>
                <div className="mt-1 text-[10px] text-zinc-600">
                  Zostaje w regionie: {maxUnits - safeTotalUnits}
                </div>
              </div>

              <Button
                onClick={() => setMobileStep("targets")}
                className="h-9 w-full bg-cyan-500 text-slate-950 hover:bg-cyan-400"
              >
                Wybierz cele
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="grid grid-cols-3 gap-2">
                <QuickPill label="Typ" valueLabel={getUnitLabel(selectedUnitType)} />
                <QuickPill label="Cele" value={targets.length} />
                <QuickPill label="Moc" value={safeTotalUnits * selectedUnitScale} />
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    Cele
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    {targets.length === 0 ? "Wybierz na mapie" : "Dotknij, aby usunac"}
                  </div>
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                  {targets.length > 0 ? (
                    targets.map((target, index) => (
                      <button
                        key={target.regionId}
                        onClick={() => onRemoveTarget(target.regionId)}
                        className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-left text-[11px] ${
                          target.isAttack
                            ? "border-red-400/10 bg-red-950/25 text-red-100"
                            : "border-cyan-400/10 bg-cyan-950/25 text-cyan-100"
                        }`}
                      >
                        <span className="max-w-[110px] truncate">{target.name}</span>
                        <span className="text-zinc-400">{allocations[index].units * selectedUnitScale}</span>
                      </button>
                    ))
                  ) : (
                    <div className="text-[11px] text-zinc-500">
                      Panel zostaje niski, a mapa jest glownym UI wyboru celu.
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => setMobileStep("setup")}
                  className="h-9 border-zinc-700 text-zinc-300"
                >
                  Wstecz
                </Button>
                <Button
                  onClick={() => onConfirm({ allocations, unitType: selectedUnitType })}
                  disabled={targets.length === 0}
                  className={`h-9 ${
                    hasAttack ? "bg-red-600 text-white hover:bg-red-500" : "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                  }`}
                >
                  {hasAttack ? "Atak" : "Ruch"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="hidden sm:block p-2.5 sm:px-3 sm:py-2.5">
          <div className="mb-2 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
              Region zrodlowy
            </div>
            <div className="truncate font-display text-sm text-zinc-100">
              {sourceName}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:gap-3">
            <div className="flex min-w-0 flex-wrap gap-2">
              {unitTypes.map(([unitType, count]) => {
                const active = unitType === selectedUnitType;
                return (
                  <button
                    key={unitType}
                    onClick={() => onSelectedUnitTypeChange(unitType)}
                    className={`inline-flex min-w-[132px] max-w-full items-center gap-2 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "border-cyan-300/30 bg-cyan-400/15 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.12)]"
                        : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]"
                    }`}
                  >
                    <Image
                      src={getUnitAsset(unitType)}
                      alt=""
                      width={18}
                      height={18}
                      className="h-[18px] w-[18px] object-contain"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-medium leading-none">
                        {getUnitLabel(unitType)}
                      </span>
                      <span className={`mt-1 block text-[10px] leading-none ${active ? "text-cyan-200/80" : "text-zinc-500"}`}>
                        {count} nosnikow
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="grid flex-1 grid-cols-4 gap-2 sm:min-w-[340px] sm:max-w-[400px]">
                <QuickPill label="Cele" value={targets.length} />
                <QuickPill label="Wysylam" value={safeTotalUnits} />
                <QuickPill label="Moc" value={safeTotalUnits * selectedUnitScale} />
                <QuickPill label="Zostaje" value={maxUnits - safeTotalUnits} />
              </div>

              <div className="flex flex-col gap-2 sm:min-w-[320px] sm:flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 whitespace-nowrap">{minUnits}</span>
                  <input
                    type="range"
                    min={minUnits}
                    max={maxUnits}
                    value={safeTotalUnits}
                    onChange={(e) => setTotalUnits(Number(e.target.value))}
                    disabled={targets.length === 0}
                    className={`min-w-0 flex-1 ${hasAttack ? "accent-red-500" : "accent-cyan-400"}`}
                  />
                  <span className="text-[10px] text-zinc-500 whitespace-nowrap">{maxUnits}</span>
                  <div className="w-10 text-right font-display text-sm text-zinc-50">
                    {safeTotalUnits}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 overflow-x-auto">
                    <div className="flex gap-1.5">
                      {targets.length > 0 ? (
                        targets.map((target, index) => (
                          <button
                            key={target.regionId}
                            onClick={() => onRemoveTarget(target.regionId)}
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] ${
                              target.isAttack
                                ? "border-red-400/10 bg-red-950/25 text-red-100"
                                : "border-cyan-400/10 bg-cyan-950/25 text-cyan-100"
                            }`}
                          >
                            <span className="max-w-[96px] truncate">{target.name}</span>
                            <span className="text-zinc-500">{allocations[index].units * selectedUnitScale}</span>
                          </button>
                        ))
                      ) : (
                        <div className="text-[11px] text-zinc-500">
                          Wybierz cel na mapie
                        </div>
                      )}
                    </div>
                  </div>

                  <Button
                    onClick={() => onConfirm({ allocations, unitType: selectedUnitType })}
                    disabled={targets.length === 0}
                    className={`h-9 shrink-0 px-3 text-[11px] uppercase tracking-[0.16em] ${
                      hasAttack ? "bg-red-600 text-white hover:bg-red-500" : "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                    }`}
                  >
                    <Image
                      src={getActionAsset(hasAttack ? "attack" : "move", selectedUnitType)}
                      alt=""
                      width={14}
                      height={14}
                      className="mr-1.5 h-3.5 w-3.5 object-contain"
                    />
                    {hasAttack ? "Atak" : "Ruch"}
                  </Button>

                  <button
                    onClick={onCancel}
                    className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] p-2 text-zinc-400"
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickPill({
  label,
  value,
  valueLabel,
}: {
  label: string;
  value?: number;
  valueLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="font-display text-sm text-zinc-50">{valueLabel ?? value ?? 0}</div>
    </div>
  );
}
