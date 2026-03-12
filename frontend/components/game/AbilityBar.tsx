"use client";

import { useCallback, useMemo } from "react";
import Image from "next/image";
import type { AbilityType } from "@/lib/api";

interface AbilityBarProps {
  abilities: AbilityType[];
  myCurrency: number;
  abilityCooldowns: Record<string, number>;
  currentTick: number;
  selectedAbility: string | null;
  onSelectAbility: (slug: string | null) => void;
}

export default function AbilityBar({
  abilities,
  myCurrency,
  abilityCooldowns,
  currentTick,
  selectedAbility,
  onSelectAbility,
}: AbilityBarProps) {
  const sorted = useMemo(
    () => [...abilities].sort((a, b) => a.order - b.order),
    [abilities]
  );

  const handleClick = useCallback(
    (slug: string) => {
      onSelectAbility(selectedAbility === slug ? null : slug);
    },
    [selectedAbility, onSelectAbility]
  );

  if (sorted.length === 0) return null;

  return (
    <>
      {/* Desktop: vertical bar on left side */}
      <div className="pointer-events-auto absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-3 rounded-2xl border border-white/15 bg-slate-950/90 px-2.5 py-4 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:flex">
        {sorted.map((ability) => (
          <AbilityButton
            key={ability.slug}
            ability={ability}
            abilityCooldowns={abilityCooldowns}
            currentTick={currentTick}
            myCurrency={myCurrency}
            isSelected={selectedAbility === ability.slug}
            onClick={handleClick}
            size="lg"
          />
        ))}
      </div>

      {/* Mobile: vertical bar on left side, compact */}
      <div className="pointer-events-auto absolute left-2 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-1.5 rounded-xl border border-white/15 bg-slate-950/90 px-1.5 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:hidden">
        {sorted.map((ability) => (
          <AbilityButton
            key={ability.slug}
            ability={ability}
            abilityCooldowns={abilityCooldowns}
            currentTick={currentTick}
            myCurrency={myCurrency}
            isSelected={selectedAbility === ability.slug}
            onClick={handleClick}
            size="sm"
          />
        ))}
      </div>
    </>
  );
}

function AbilityButton({
  ability,
  abilityCooldowns,
  currentTick,
  myCurrency,
  isSelected,
  onClick,
  size,
}: {
  ability: AbilityType;
  abilityCooldowns: Record<string, number>;
  currentTick: number;
  myCurrency: number;
  isSelected: boolean;
  onClick: (slug: string) => void;
  size: "sm" | "lg";
}) {
  const cooldownReady = abilityCooldowns[ability.slug] ?? 0;
  const isOnCooldown = currentTick < cooldownReady;
  const cooldownRemaining = isOnCooldown ? cooldownReady - currentTick : 0;
  const totalCooldown = ability.cooldown_ticks;
  const cooldownProgress = isOnCooldown && totalCooldown > 0
    ? cooldownRemaining / totalCooldown
    : 0;
  const canAfford = myCurrency >= ability.currency_cost;
  const isDisabled = isOnCooldown || !canAfford;

  const btnSize = size === "lg" ? "h-16 w-16 rounded-xl" : "h-11 w-11 rounded-lg";
  const imgSize = size === "lg" ? "h-10 w-10" : "h-7 w-7";

  return (
    <div className="relative">
      <button
        onClick={() => onClick(ability.slug)}
        disabled={isDisabled}
        title={`${ability.name} (${ability.currency_cost}$)${isOnCooldown ? ` - ${cooldownRemaining}s` : ""}`}
        className={`relative flex items-center justify-center border-2 transition-all ${btnSize} ${
          isSelected
            ? "border-amber-400 bg-amber-500/25 shadow-[0_0_12px_rgba(251,191,36,0.3)]"
            : isDisabled
              ? "border-white/5 bg-white/[0.03] opacity-45 grayscale-[40%]"
              : "border-white/15 bg-white/[0.07] hover:bg-white/[0.15] hover:border-white/25 hover:shadow-[0_0_8px_rgba(255,255,255,0.1)]"
        }`}
      >
        <Image
          src={`/assets/abilities/${ability.asset_key}.webp`}
          alt={ability.name}
          width={40}
          height={40}
          className={`${imgSize} object-contain`}
        />

        {/* Radial cooldown sweep overlay */}
        {isOnCooldown && (
          <div className={`absolute inset-0 flex items-center justify-center ${size === "lg" ? "rounded-xl" : "rounded-lg"}`}>
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="48" fill="rgba(0,0,0,0.6)" stroke="none" />
              {cooldownProgress > 0 && (
                <path
                  d={describeArc(50, 50, 48, 360 * (1 - cooldownProgress), 360)}
                  fill="rgba(0,0,0,0.75)"
                />
              )}
            </svg>
            <span className={`relative z-10 font-extrabold tabular-nums text-amber-300 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] ${
              size === "lg" ? "text-base" : "text-xs"
            }`}>
              {cooldownRemaining}s
            </span>
          </div>
        )}
      </button>

      {/* Cost badge — below button, always visible */}
      <div className={`mt-0.5 text-center font-bold tabular-nums ${
        canAfford ? "text-amber-300" : "text-red-400"
      } ${size === "lg" ? "text-[11px]" : "text-[9px]"}`}>
        {ability.currency_cost}$
      </div>
    </div>
  );
}

/** SVG arc path for radial cooldown sweep */
function describeArc(
  cx: number, cy: number, r: number,
  startAngle: number, endAngle: number
): string {
  if (endAngle - startAngle >= 360) {
    return `M ${cx - r},${cy} A ${r},${r} 0 1,1 ${cx + r},${cy} A ${r},${r} 0 1,1 ${cx - r},${cy} Z`;
  }
  const startRad = ((startAngle - 90) * Math.PI) / 180;
  const endRad = ((endAngle - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${largeArc},1 ${x2},${y2} Z`;
}
