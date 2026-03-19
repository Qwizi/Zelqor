"use client";

import { Coins, Star, Lock } from "lucide-react";
import { type AchievementOut } from "@/lib/api";

interface AchievementGridProps {
  achievements: AchievementOut[];
}

const RARITY_BORDER: Record<string, string> = {
  common: "border-slate-500/30",
  uncommon: "border-green-500/40",
  rare: "border-blue-500/40",
  epic: "border-purple-500/40",
  legendary: "border-amber-500/50",
};

const RARITY_GLOW: Record<string, string> = {
  common: "",
  uncommon: "shadow-[0_0_8px_rgba(34,197,94,0.12)]",
  rare: "shadow-[0_0_8px_rgba(59,130,246,0.15)]",
  epic: "shadow-[0_0_10px_rgba(168,85,247,0.18)]",
  legendary: "shadow-[0_0_12px_rgba(245,158,11,0.22)]",
};

const RARITY_ICON_BG: Record<string, string> = {
  common: "bg-slate-500/10",
  uncommon: "bg-green-500/12",
  rare: "bg-blue-500/12",
  epic: "bg-purple-500/12",
  legendary: "bg-amber-500/15",
};

const RARITY_LABEL: Record<string, string> = {
  common: "Pospolite",
  uncommon: "Rzadkie",
  rare: "Bardzo rzadkie",
  epic: "Epickie",
  legendary: "Legendarne",
};

const RARITY_LABEL_COLOR: Record<string, string> = {
  common: "text-slate-400",
  uncommon: "text-green-400",
  rare: "text-blue-400",
  epic: "text-purple-400",
  legendary: "text-amber-400",
};

interface AchievementCardProps {
  achievement: AchievementOut;
}

function AchievementCard({ achievement }: AchievementCardProps) {
  const {
    title,
    description,
    icon,
    rarity,
    gold_reward,
    xp_reward,
    is_unlocked,
    unlocked_at,
  } = achievement;

  const borderClass = RARITY_BORDER[rarity] ?? "border-slate-500/30";
  const glowClass = is_unlocked ? (RARITY_GLOW[rarity] ?? "") : "";
  const iconBgClass = RARITY_ICON_BG[rarity] ?? "bg-slate-500/10";
  const rarityLabel = RARITY_LABEL[rarity] ?? rarity;
  const rarityLabelColor = RARITY_LABEL_COLOR[rarity] ?? "text-slate-400";

  const unlockedDate = unlocked_at
    ? new Date(unlocked_at).toLocaleDateString("pl-PL", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div
      className={[
        "relative flex flex-col gap-3 rounded-2xl border p-3.5 transition-all",
        borderClass,
        glowClass,
        is_unlocked
          ? "bg-card"
          : "bg-card/40 opacity-55 grayscale",
      ].join(" ")}
    >
      {/* Icon + lock overlay */}
      <div className="flex items-start gap-3">
        <div
          className={[
            "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-2xl",
            iconBgClass,
          ].join(" ")}
        >
          <span role="img" aria-label={title}>
            {icon || "🏆"}
          </span>
          {!is_unlocked && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-card/60">
              <Lock className="h-4 w-4 text-muted-foreground/60" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p
            className={[
              "text-sm font-semibold leading-tight truncate",
              is_unlocked ? "text-foreground" : "text-muted-foreground",
            ].join(" ")}
          >
            {title}
          </p>
          <p
            className={[
              "mt-0.5 text-[11px] leading-snug line-clamp-2",
              rarityLabelColor,
            ].join(" ")}
          >
            {rarityLabel}
          </p>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground leading-snug line-clamp-2">
        {description}
      </p>

      {/* Footer: rewards + date */}
      <div className="flex items-center justify-between gap-2 mt-auto">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-400">
            <Coins className="h-3 w-3 shrink-0" />
            {gold_reward}
          </span>
          <span className="flex items-center gap-1 text-[11px] font-semibold text-primary">
            <Star className="h-3 w-3 shrink-0" />
            {xp_reward} XP
          </span>
        </div>

        {is_unlocked && unlockedDate && (
          <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
            {unlockedDate}
          </span>
        )}
      </div>
    </div>
  );
}

export function AchievementGrid({ achievements }: AchievementGridProps) {
  if (achievements.length === 0) return null;

  const unlockedCount = achievements.filter((a) => a.is_unlocked).length;

  // Sort: unlocked first, then by rarity weight descending
  const rarityOrder: Record<string, number> = {
    legendary: 5,
    epic: 4,
    rare: 3,
    uncommon: 2,
    common: 1,
  };

  const sorted = [...achievements].sort((a, b) => {
    if (a.is_unlocked !== b.is_unlocked) return a.is_unlocked ? -1 : 1;
    return (rarityOrder[b.rarity] ?? 0) - (rarityOrder[a.rarity] ?? 0);
  });

  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/12">
          <span className="text-base" role="img" aria-label="osiągnięcia">
            🏆
          </span>
        </div>
        <p className="flex-1 text-sm font-semibold text-foreground">
          Osiągnięcia
        </p>
        <span className="text-xs text-muted-foreground tabular-nums">
          <span className="text-foreground font-semibold">{unlockedCount}</span>
          {" / "}
          {achievements.length}
        </span>
      </div>

      {/* Grid */}
      <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-3 gap-2.5">
        {sorted.map((achievement) => (
          <AchievementCard key={achievement.id} achievement={achievement} />
        ))}
      </div>
    </div>
  );
}
