"use client";

import { Coins, Shield, Swords, TrendingUp, Zap } from "lucide-react";
import { memo, type ReactNode } from "react";

export interface ActiveBoost {
  slug: string;
  name?: string;
  params: Record<string, unknown>;
}

export interface ActiveMatchBoost {
  slug: string;
  effect_type: string;
  value: number;
  ticks_remaining: number;
}

export interface ActiveBoostsProps {
  boosts: ActiveBoost[];
  /** Time-limited boosts active during the match (e.g. from abilities). */
  matchBoosts?: ActiveMatchBoost[];
  /** Tick interval in ms — used to convert ticks_remaining to seconds. */
  tickIntervalMs?: number;
}

const BOOST_ICONS: Record<string, ReactNode> = {
  unit_bonus: <TrendingUp className="h-3 w-3" />,
  defense_bonus: <Shield className="h-3 w-3" />,
  attack_bonus: <Swords className="h-3 w-3" />,
  energy_bonus: <Coins className="h-3 w-3" />,
};

const BOOST_COLORS: Record<string, string> = {
  unit_bonus: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  defense_bonus: "text-blue-300 border-blue-500/30 bg-blue-500/10",
  attack_bonus: "text-red-300 border-red-500/30 bg-red-500/10",
  energy_bonus: "text-amber-300 border-amber-500/30 bg-amber-500/10",
};

const BOOST_LABELS: Record<string, string> = {
  unit_bonus: "Mobilizacja",
  defense_bonus: "Fortyfikacja",
  attack_bonus: "Blitzkrieg",
  energy_bonus: "Ekonomia",
};

function fallbackIcon() {
  return <Zap className="h-3 w-3" />;
}

export default memo(function ActiveBoosts({ boosts, matchBoosts = [], tickIntervalMs = 1000 }: ActiveBoostsProps) {
  if (boosts.length === 0 && matchBoosts.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {boosts.map((b) => {
        const effectType = (b.params?.effect_type as string) ?? "";
        const value = (b.params?.value as number) ?? 0;
        const colors = BOOST_COLORS[effectType] ?? "text-muted-foreground border-border bg-muted/30";
        const label = BOOST_LABELS[effectType] ?? effectType;
        return (
          <div
            key={b.slug}
            className={`flex items-center gap-1 rounded-full border px-2 py-1 text-caption sm:text-xs font-medium ${colors}`}
            title={`${label}: +${Math.round(value * 100)}% (cały mecz)`}
          >
            {BOOST_ICONS[effectType] ?? fallbackIcon()}
            <span>+{Math.round(value * 100)}%</span>
          </div>
        );
      })}
      {matchBoosts.map((b, i) => {
        const colors = BOOST_COLORS[b.effect_type] ?? "text-muted-foreground border-border bg-muted/30";
        const label = BOOST_LABELS[b.effect_type] ?? b.effect_type;
        const remainingSec = Math.ceil((b.ticks_remaining * tickIntervalMs) / 1000);
        return (
          <div
            key={`${b.slug}-${i}`}
            className={`flex items-center gap-1 rounded-full border px-2 py-1 text-caption sm:text-xs font-medium ${colors}`}
            title={`${label}: +${Math.round(b.value * 100)}% (${remainingSec}s)`}
          >
            {BOOST_ICONS[b.effect_type] ?? fallbackIcon()}
            <span>+{Math.round(b.value * 100)}%</span>
            <span className="font-display text-caption tabular-nums opacity-70">{remainingSec}s</span>
          </div>
        );
      })}
    </div>
  );
});
