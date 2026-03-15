"use client";

import { memo, useState, useMemo, useRef } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { GameRegion } from "@/hooks/useGameSocket";
import type { UnitType } from "@/lib/api";
import { getActionAsset, getPlayerUnitAsset } from "@/lib/gameAssets";

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
  unitsConfig?: UnitType[];
  myCosmetics?: Record<string, unknown>;
  onSelectedUnitTypeChange: (unitType: string) => void;
  onConfirm: (payload: { allocations: { regionId: string; units: number }[]; unitType: string }) => void;
  onRemoveTarget: (regionId: string) => void;
  onCancel: () => void;
}

export default memo(function ActionBar({
  sourceRegion,
  sourceName,
  targets,
  selectedUnitType,
  selectedUnitScale = 1,
  unitsConfig,
  myCosmetics,
  onSelectedUnitTypeChange,
  onConfirm,
  onRemoveTarget,
  onCancel,
}: ActionBarProps) {
  const unitConfigMap = useMemo(
    () => new Map((unitsConfig ?? []).map((u) => [u.slug, u])),
    [unitsConfig]
  );
  const unitTypes = useMemo(
    () => Object.entries(sourceRegion.units ?? {}).filter(([, count]) => count > 0),
    [sourceRegion.units]
  );
  const availableUnitsByType = sourceRegion.units ?? {};
  const liveMaxUnits = availableUnitsByType[selectedUnitType] ?? 0;
  const hasAttack = targets.some((target) => target.isAttack);
  const accentClass = hasAttack ? "border-destructive/30" : "border-primary/30";

  // Freeze slider max so game ticks don't shift the thumb while user is interacting.
  // Only update when user switches unit type, or live count drops below current frozen max.
  // Using refs avoids setState-in-render double renders — mutations here are synchronous
  // and don't schedule an extra re-render.
  const maxUnitsRef = useRef(liveMaxUnits);
  const prevUnitTypeRef = useRef(selectedUnitType);

  if (prevUnitTypeRef.current !== selectedUnitType) {
    prevUnitTypeRef.current = selectedUnitType;
    maxUnitsRef.current = liveMaxUnits;
  } else if (liveMaxUnits < maxUnitsRef.current) {
    maxUnitsRef.current = liveMaxUnits;
  }
  const maxUnits = maxUnitsRef.current;

  // Derived default for slider: half of maxUnits, reset whenever max or unit type changes.
  // totalUnits stays as state because the user mutates it via the range input.
  // Previous-value tracking uses refs to avoid setState-in-render.
  const defaultTotalUnits = Math.max(1, Math.floor(maxUnits / 2) || 1);
  const [totalUnits, setTotalUnits] = useState(defaultTotalUnits);
  const prevMaxForSliderRef = useRef(maxUnits);
  const prevUnitForSliderRef = useRef(selectedUnitType);

  if (prevUnitForSliderRef.current !== selectedUnitType || prevMaxForSliderRef.current !== maxUnits) {
    prevUnitForSliderRef.current = selectedUnitType;
    prevMaxForSliderRef.current = maxUnits;
    setTotalUnits(defaultTotalUnits);
  }

  const minUnits = targets.length > 0 ? Math.min(targets.length, maxUnits) : 1;
  const safeTotalUnits = Math.max(Math.min(totalUnits, maxUnits), minUnits);
  const perTarget = targets.length > 0 ? Math.max(1, Math.floor(safeTotalUnits / targets.length)) : 0;
  const allocations = targets.map((target, index) => ({
    regionId: target.regionId,
    units: index === 0 ? safeTotalUnits - perTarget * (targets.length - 1) : perTarget,
  }));

  if (maxUnits < 1) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 px-2 pb-2 sm:left-1/2 sm:right-auto sm:w-[min(480px,calc(100vw-1rem))] sm:-translate-x-1/2 sm:px-0 sm:pb-3">
      <div className={`overflow-hidden rounded-xl border bg-card sm:bg-card/90 shadow-lg sm:shadow-[0_-10px_32px_rgba(0,0,0,0.28)] sm:backdrop-blur-xl ${accentClass}`}>
        <div className="sm:hidden p-1.5 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {sourceName}
              </div>
            </div>
            <button
              onClick={onCancel}
              aria-label="Anuluj"
              className="shrink-0 rounded-full border border-border bg-muted/30 p-1.5 text-muted-foreground"
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

          <div className="flex gap-1.5 overflow-x-auto">
            {unitTypes.map(([unitType, count]) => {
              const active = unitType === selectedUnitType;
              const unitCfg = unitConfigMap.get(unitType);
              return (
                <button
                  key={unitType}
                  onClick={() => onSelectedUnitTypeChange(unitType)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-1.5 py-1 text-left ${
                    active
                      ? "border-primary/30 bg-primary/15 text-primary"
                      : "border-border bg-muted/30 text-foreground/80"
                  }`}
                >
                  <Image
                    src={getPlayerUnitAsset(unitType, myCosmetics, unitCfg?.asset_url)}
                    alt=""
                    width={16}
                    height={16}
                    className="h-4 w-4 object-contain"
                  />
                  <span className="text-[11px] font-medium">{getUnitLabel(unitType)}</span>
                  <span className={`text-[10px] ${active ? "text-primary/80" : "text-muted-foreground"}`}>{count}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-2 py-1.5">
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Wysylasz</span>
            <input
              type="range"
              min={minUnits}
              max={maxUnits}
              value={safeTotalUnits}
              onChange={(e) => setTotalUnits(Number(e.target.value))}
              className={`min-w-0 flex-1 ${hasAttack ? "accent-red-500" : "accent-cyan-400"}`}
            />
            <span className="font-display text-xs text-foreground">{safeTotalUnits}/{maxUnits}</span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto">
            {targets.length > 0 ? (
              targets.map((target, index) => (
                <button
                  key={target.regionId}
                  onClick={() => onRemoveTarget(target.regionId)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                    target.isAttack
                      ? "border-red-400/10 bg-red-950/25 text-red-100"
                      : "border-cyan-400/10 bg-cyan-950/25 text-cyan-100"
                  }`}
                >
                  <span className="max-w-[90px] truncate">{target.name}</span>
                  <span className="text-muted-foreground">{allocations[index].units * selectedUnitScale}</span>
                </button>
              ))
            ) : (
              <div className="text-[11px] text-muted-foreground">Wybierz cele na mapie</div>
            )}
          </div>

          <Button
            onClick={() => onConfirm({ allocations, unitType: selectedUnitType })}
            disabled={targets.length === 0}
            className={`h-8 w-full ${
              hasAttack ? "bg-red-600 text-white hover:bg-red-500" : "bg-primary text-primary-foreground hover:bg-cyan-400"
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
        </div>

        <div className="hidden sm:block p-2">
          <div className="mb-2 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Region zrodlowy
            </div>
            <div className="truncate font-display text-sm text-foreground">
              {sourceName}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex min-w-0 flex-wrap gap-2">
              {unitTypes.map(([unitType, count]) => {
                const active = unitType === selectedUnitType;
                const unitCfg = unitConfigMap.get(unitType);
                return (
                  <button
                    key={unitType}
                    onClick={() => onSelectedUnitTypeChange(unitType)}
                    className={`inline-flex min-w-[100px] max-w-full items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition-colors ${
                      active
                        ? "border-primary/30 bg-primary/15 text-primary shadow-[0_0_0_1px_rgba(34,211,238,0.12)]"
                        : "border-border bg-muted/30 text-foreground/80 hover:bg-muted/50"
                    }`}
                  >
                    <Image
                      src={getPlayerUnitAsset(unitType, myCosmetics, unitCfg?.asset_url)}
                      alt=""
                      width={18}
                      height={18}
                      className="h-[18px] w-[18px] object-contain"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-medium leading-none">
                        {getUnitLabel(unitType)}
                      </span>
                      <span className={`mt-1 block text-[10px] leading-none ${active ? "text-primary/80" : "text-muted-foreground"}`}>
                        {count}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <span>Wysylasz</span>
                <span className="font-display text-xs text-foreground">{safeTotalUnits} / {maxUnits}</span>
              </div>
              <input
                type="range"
                min={minUnits}
                max={maxUnits}
                value={safeTotalUnits}
                onChange={(e) => setTotalUnits(Number(e.target.value))}
                disabled={targets.length === 0}
                className={`w-full ${hasAttack ? "accent-red-500" : "accent-cyan-400"}`}
              />
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
                        <span className="text-muted-foreground">{allocations[index].units * selectedUnitScale}</span>
                      </button>
                    ))
                  ) : (
                    <div className="text-[11px] text-muted-foreground">
                      Wybierz cel na mapie
                    </div>
                  )}
                </div>
              </div>

              <Button
                onClick={() => onConfirm({ allocations, unitType: selectedUnitType })}
                disabled={targets.length === 0}
                className={`h-8 shrink-0 px-3 text-[11px] uppercase tracking-[0.16em] ${
                  hasAttack ? "bg-red-600 text-white hover:bg-red-500" : "bg-primary text-primary-foreground hover:bg-cyan-400"
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
                aria-label="Anuluj"
                className="shrink-0 rounded-full border border-border bg-muted/30 p-2 text-muted-foreground"
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
  );
});
