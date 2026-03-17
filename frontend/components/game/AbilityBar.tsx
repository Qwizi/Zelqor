"use client";

import { memo, useCallback, useMemo } from "react";
import Image from "next/image";
import type { AbilityType } from "@/lib/api";
import { getAssetUrl } from "@/lib/assetOverrides";

/** Returns true for boost-type abilities identified by slug prefix */
function isBoostSlug(slug: string): boolean {
  return slug.startsWith("boost-");
}

interface AbilityBarProps {
  abilities: AbilityType[];
  myEnergy: number;
  abilityCooldowns: Record<string, number>;
  currentTick: number;
  selectedAbility: string | null;
  onSelectAbility: (slug: string | null) => void;
  /** Called immediately when a boost button is clicked — no region targeting needed */
  onActivateBoost: (slug: string) => void;
  /** If set, only this ability slug is clickable (tutorial mode) */
  allowedAbility?: string | null;
  /** If provided and non-empty, only abilities whose slug is in this map are shown; values are remaining uses */
  abilityScrolls?: Record<string, number>;
  /** Per-ability level from deck; used to show Lvl badge on each button */
  abilityLevels?: Record<string, number>;
  /** Current player's cosmetics for overriding ability icons */
  myCosmetics?: Record<string, unknown>;
}

export default memo(function AbilityBar({
  abilities,
  myEnergy,
  abilityCooldowns,
  currentTick,
  selectedAbility,
  onSelectAbility,
  onActivateBoost,
  allowedAbility,
  abilityScrolls,
  abilityLevels,
  myCosmetics,
}: AbilityBarProps) {
  const { sortedAbilities, sortedBoosts } = useMemo(() => {
    const s = abilityScrolls;
    const base = [...abilities].sort((a, b) => a.order - b.order);
    if (!s) return { sortedAbilities: [], sortedBoosts: [] };
    const visible = base.filter((a) => isBoostSlug(a.slug) || (s[a.slug] ?? 0) > 0);
    return {
      sortedAbilities: visible.filter((a) => !isBoostSlug(a.slug)),
      sortedBoosts: visible.filter((a) => isBoostSlug(a.slug)),
    };
  }, [abilities, abilityScrolls]);

  const handleAbilityClick = useCallback(
    (slug: string) => {
      onSelectAbility(selectedAbility === slug ? null : slug);
    },
    [selectedAbility, onSelectAbility]
  );

  const handleBoostClick = useCallback(
    (slug: string) => {
      onActivateBoost(slug);
    },
    [onActivateBoost]
  );

  if (sortedAbilities.length === 0 && sortedBoosts.length === 0) return null;

  return (
    <>
      {/* Desktop: vertical bar on left side */}
      <div
        data-tutorial="ability-bar"
        className="pointer-events-auto absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-2 rounded-xl border border-border bg-card/90 px-2 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:flex"
      >
        {sortedAbilities.map((ability) => (
          <AbilityButton
            key={ability.slug}
            ability={ability}
            abilityCooldowns={abilityCooldowns}
            currentTick={currentTick}
            myEnergy={myEnergy}
            isSelected={selectedAbility === ability.slug}
            onClick={handleAbilityClick}
            size="lg"
            locked={allowedAbility != null && allowedAbility !== ability.slug}
            remainingUses={abilityScrolls?.[ability.slug]}
            abilityLevel={abilityLevels?.[ability.slug]}
            myCosmetics={myCosmetics}
            isBoost={false}
          />
        ))}

        {/* Separator between abilities and boosts */}
        {sortedAbilities.length > 0 && sortedBoosts.length > 0 && (
          <div className="mx-auto h-px w-8 rounded-full bg-white/10" />
        )}

        {sortedBoosts.map((ability) => (
          <AbilityButton
            key={ability.slug}
            ability={ability}
            abilityCooldowns={abilityCooldowns}
            currentTick={currentTick}
            myEnergy={myEnergy}
            isSelected={false}
            onClick={handleBoostClick}
            size="lg"
            locked={allowedAbility != null && allowedAbility !== ability.slug}
            remainingUses={abilityScrolls?.[ability.slug]}
            abilityLevel={abilityLevels?.[ability.slug]}
            myCosmetics={myCosmetics}
            isBoost={true}
          />
        ))}
      </div>

      {/* Mobile: vertical bar on left side, compact */}
      <div className="pointer-events-auto absolute left-2 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-1 rounded-lg border border-border bg-card px-1 py-1.5 shadow-lg sm:hidden">
        {sortedAbilities.map((ability) => (
          <AbilityButton
            key={ability.slug}
            ability={ability}
            abilityCooldowns={abilityCooldowns}
            currentTick={currentTick}
            myEnergy={myEnergy}
            isSelected={selectedAbility === ability.slug}
            onClick={handleAbilityClick}
            size="sm"
            locked={allowedAbility != null && allowedAbility !== ability.slug}
            remainingUses={abilityScrolls?.[ability.slug]}
            abilityLevel={abilityLevels?.[ability.slug]}
            myCosmetics={myCosmetics}
            isBoost={false}
          />
        ))}

        {/* Separator between abilities and boosts */}
        {sortedAbilities.length > 0 && sortedBoosts.length > 0 && (
          <div className="mx-auto h-px w-6 rounded-full bg-white/10" />
        )}

        {sortedBoosts.map((ability) => (
          <AbilityButton
            key={ability.slug}
            ability={ability}
            abilityCooldowns={abilityCooldowns}
            currentTick={currentTick}
            myEnergy={myEnergy}
            isSelected={false}
            onClick={handleBoostClick}
            size="sm"
            locked={allowedAbility != null && allowedAbility !== ability.slug}
            remainingUses={abilityScrolls?.[ability.slug]}
            abilityLevel={abilityLevels?.[ability.slug]}
            myCosmetics={myCosmetics}
            isBoost={true}
          />
        ))}
      </div>
    </>
  );
});

function AbilityButton({
  ability,
  abilityCooldowns,
  currentTick,
  myEnergy,
  isSelected,
  onClick,
  size,
  locked = false,
  remainingUses,
  abilityLevel,
  myCosmetics,
  isBoost,
}: {
  ability: AbilityType;
  abilityCooldowns: Record<string, number>;
  currentTick: number;
  myEnergy: number;
  isSelected: boolean;
  onClick: (slug: string) => void;
  size: "sm" | "lg";
  locked?: boolean;
  /** When defined, shows a remaining-uses badge in the corner */
  remainingUses?: number;
  /** Ability level from the player's deck; shows a Lvl badge below the cost */
  abilityLevel?: number;
  /** Current player's cosmetics for overriding ability icons */
  myCosmetics?: Record<string, unknown>;
  /** Whether this item is a boost (affects styling and interaction) */
  isBoost: boolean;
}) {
  const cooldownReady = abilityCooldowns[ability.slug] ?? 0;
  const isOnCooldown = currentTick < cooldownReady;
  const cooldownRemaining = isOnCooldown ? cooldownReady - currentTick : 0;
  const totalCooldown = ability.cooldown_ticks;
  const cooldownProgress =
    isOnCooldown && totalCooldown > 0 ? cooldownRemaining / totalCooldown : 0;
  const level = abilityLevel ?? 1;
  const levelEnergyCost =
    ability.level_stats?.[String(level)]?.energy_cost ?? ability.energy_cost;
  const canAfford = myEnergy >= levelEnergyCost;
  const isDisabled = isOnCooldown || !canAfford || locked;

  const btnSize = size === "lg" ? "h-12 w-12 rounded-lg" : "h-9 w-9 rounded-md";
  const imgSize = size === "lg" ? "h-7 w-7" : "h-5 w-5";

  // Boost: amber/gold colour scheme; Ability: cyan/white scheme
  const idleStyle = isBoost
    ? "border-accent/30 bg-accent/10 hover:bg-accent/15 hover:border-accent/50 hover:shadow-[0_0_8px_rgba(251,191,36,0.15)]"
    : "border-border bg-muted/40 hover:bg-muted/60 hover:border-border hover:shadow-[0_0_8px_rgba(255,255,255,0.1)]";

  const selectedStyle = isBoost
    ? "border-accent bg-accent/20 shadow-[0_0_12px_rgba(251,191,36,0.3)]"
    : "border-primary bg-primary/20 shadow-[0_0_12px_rgba(34,211,238,0.25)]";

  const badgeColor = isBoost ? "text-accent" : "text-primary";

  return (
    <div className="relative">
      <button
        onClick={() => onClick(ability.slug)}
        disabled={isDisabled}
        title={`${ability.name}${isBoost ? " (Boost — aktywuje globalnie)" : ""} (${levelEnergyCost}⚡)${isOnCooldown ? ` - ${cooldownRemaining}s` : ""}${remainingUses !== undefined ? ` · Pozostało: ${remainingUses}` : ""}`}
        className={`relative flex items-center justify-center border-2 transition-colors ${btnSize} ${
          isSelected
            ? selectedStyle
            : isDisabled
              ? "border-border/50 bg-muted/20 opacity-45 grayscale-[40%]"
              : idleStyle
        }`}
      >
        <Image
          src={(() => {
            const v = myCosmetics?.[ability.asset_key];
            const url =
              typeof v === "string"
                ? v
                : typeof v === "object" && v !== null && "url" in v
                  ? (v as { url?: string | null }).url
                  : null;
            return (
              url ??
              ability.asset_url ??
              getAssetUrl(
                ability.asset_key,
                `/assets/abilities/${ability.asset_key}.webp`
              )
            );
          })()}
          alt={ability.name}
          width={40}
          height={40}
          className={`${imgSize} object-contain`}
        />

        {/* Radial cooldown sweep overlay */}
        {isOnCooldown && (
          <div
            className={`absolute inset-0 flex items-center justify-center ${size === "lg" ? "rounded-lg" : "rounded-md"}`}
          >
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="48" fill="rgba(0,0,0,0.6)" stroke="none" />
              {cooldownProgress > 0 && (
                <path
                  d={describeArc(50, 50, 48, 360 * (1 - cooldownProgress), 360)}
                  fill="rgba(0,0,0,0.75)"
                />
              )}
            </svg>
            <span
              className={`relative z-10 font-display font-extrabold tabular-nums text-accent drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] ${
                size === "lg" ? "text-base" : "text-xs"
              }`}
            >
              {cooldownRemaining}s
            </span>
          </div>
        )}

        {/* Remaining uses badge — top-right corner (hidden when unlimited / ≥100) */}
        {remainingUses !== undefined && remainingUses < 100 && (
          <span
            className={`absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-secondary font-display font-bold tabular-nums leading-none ${badgeColor} text-[10px]`}
          >
            {remainingUses}
          </span>
        )}

        {/* Boost indicator chip — bottom-left corner */}
        {isBoost && !isOnCooldown && (
          <span
            className="absolute -bottom-1 -left-1 rounded-sm border border-accent/40 bg-card/90 px-1 py-px font-bold uppercase leading-none tracking-widest text-accent text-[10px]"
          >
            BOOST
          </span>
        )}
      </button>

      {/* Cost badge — below button, always visible */}
      <div
        className={`mt-0.5 text-center font-display font-bold tabular-nums text-[10px] sm:text-xs ${
          canAfford ? "text-accent" : "text-destructive"
        }`}
      >
        {levelEnergyCost}⚡
      </div>

      {/* Level badge — shown when ability level is known */}
      {abilityLevel !== undefined && (
        <div
          className={`text-center font-display font-bold tabular-nums leading-none text-[10px] sm:text-xs ${
            abilityLevel >= 3
              ? "text-accent"
              : abilityLevel === 2
                ? "text-primary"
                : "text-muted-foreground"
          }`}
        >
          Lvl {abilityLevel}
        </div>
      )}
    </div>
  );
}

/** SVG arc path for radial cooldown sweep */
function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
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
