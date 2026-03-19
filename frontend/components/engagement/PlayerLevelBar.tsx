"use client";

import { Flame, Star } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { type PlayerProfileOut } from "@/lib/api";

interface PlayerLevelBarProps {
  profile: PlayerProfileOut;
}

export function PlayerLevelBar({ profile }: PlayerLevelBarProps) {
  const { level, xp, xp_for_next_level, xp_progress, login_streak } = profile;
  const pct = Math.min(100, Math.round(xp_progress * 100));

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card border border-border px-4 py-3">
      {/* Level badge */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
        <span className="font-display text-base font-bold text-primary leading-none">{level}</span>
      </div>

      {/* XP bar */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Poziom {level}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
            <Star className="h-3 w-3 text-amber-400" />
            {xp.toLocaleString("pl-PL")} / {xp_for_next_level.toLocaleString("pl-PL")} XP
          </span>
        </div>
        <Progress value={pct} max={100} className="h-1.5" />
      </div>

      {/* Streak */}
      {login_streak > 0 && (
        <div className="flex shrink-0 items-center gap-1 rounded-lg bg-orange-500/10 px-2.5 py-1.5 ring-1 ring-orange-500/20">
          <Flame className="h-4 w-4 text-orange-400" />
          <span className="text-sm font-bold text-orange-300 tabular-nums leading-none">{login_streak}</span>
        </div>
      )}
    </div>
  );
}
