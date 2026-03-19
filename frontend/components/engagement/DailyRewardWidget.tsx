"use client";

import { useState } from "react";
import { Gift, Coins, Star, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type DailyStatusOut, type ClaimDailyOut } from "@/lib/api";

interface DailyRewardWidgetProps {
  dailyStatus: DailyStatusOut;
  onClaim: () => Promise<ClaimDailyOut>;
}

export function DailyRewardWidget({ dailyStatus, onClaim }: DailyRewardWidgetProps) {
  const [loading, setLoading] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [result, setResult] = useState<ClaimDailyOut | null>(null);

  const { can_claim, current_streak, next_reward, rewards } = dailyStatus;

  const handleClaim = async () => {
    if (loading || claimed || !can_claim) return;
    setLoading(true);
    try {
      const res = await onClaim();
      setResult(res);
      setClaimed(true);
    } catch {
      // swallow — parent handles toasts if desired
    } finally {
      setLoading(false);
    }
  };

  // Show a 7-day window: days around the current streak
  const displayRewards = rewards.slice(0, 7);

  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
          <Gift className="h-4 w-4 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight">Dzienna nagroda</p>
          <p className="text-xs text-muted-foreground">
            Seria logowań: <span className="text-amber-400 font-semibold">{current_streak}</span> dni
          </p>
        </div>
        {result && (
          <div className="flex items-center gap-2 text-xs text-accent font-semibold animate-in fade-in slide-in-from-right-2 duration-300">
            <span>+{result.gold_earned} złota</span>
            <span className="text-muted-foreground">·</span>
            <span>+{result.xp_earned} XP</span>
          </div>
        )}
      </div>

      {/* 7-day circles */}
      {displayRewards.length > 0 && (
        <div className="px-4 pb-3">
          <div className="flex gap-1.5 justify-between">
            {displayRewards.map((reward) => {
              const isPast = reward.day < current_streak || (reward.day === current_streak && !can_claim);
              const isToday = reward.is_today;
              const isFuture = !isPast && !isToday;

              return (
                <div
                  key={reward.day}
                  className={[
                    "relative flex flex-1 flex-col items-center gap-1 rounded-xl py-2 px-1 transition-all",
                    isToday && can_claim
                      ? "bg-amber-500/15 ring-1 ring-amber-500/40"
                      : isToday && !can_claim
                      ? "bg-primary/10 ring-1 ring-primary/25"
                      : isPast
                      ? "bg-secondary/50"
                      : "bg-secondary/20",
                  ].join(" ")}
                >
                  {/* Day label */}
                  <span
                    className={[
                      "text-[9px] uppercase tracking-widest font-medium leading-none",
                      isToday ? "text-amber-400" : isPast ? "text-muted-foreground/60" : "text-muted-foreground/40",
                    ].join(" ")}
                  >
                    D{reward.day}
                  </span>

                  {/* Circle */}
                  <div
                    className={[
                      "flex h-7 w-7 items-center justify-center rounded-full text-sm",
                      isPast
                        ? "bg-primary/20 text-primary"
                        : isToday && can_claim
                        ? "bg-amber-500/25 text-amber-300"
                        : isToday
                        ? "bg-primary/20 text-primary"
                        : "bg-secondary/30 text-muted-foreground/30",
                    ].join(" ")}
                  >
                    {isPast ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <span className="text-[10px] font-bold">{reward.gold_reward}</span>
                    )}
                  </div>

                  {/* Gold label */}
                  <span
                    className={[
                      "text-[9px] font-medium leading-none",
                      isFuture ? "text-muted-foreground/30" : "text-muted-foreground/70",
                    ].join(" ")}
                  >
                    {isPast ? "OK" : `${reward.xp_reward}xp`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Next reward preview + claim button */}
      <div className="border-t border-border px-4 py-3 flex items-center gap-3">
        {next_reward && (
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex items-center gap-1 text-sm font-semibold text-amber-400">
              <Coins className="h-4 w-4 shrink-0" />
              <span className="tabular-nums">{next_reward.gold_reward}</span>
            </div>
            <div className="flex items-center gap-1 text-sm font-semibold text-primary">
              <Star className="h-4 w-4 shrink-0" />
              <span className="tabular-nums">{next_reward.xp_reward} XP</span>
            </div>
            {next_reward.bonus_description && (
              <span className="text-xs text-muted-foreground truncate hidden sm:block">
                {next_reward.bonus_description}
              </span>
            )}
          </div>
        )}

        {(can_claim || claimed) && (
          <Button
            size="sm"
            onClick={handleClaim}
            disabled={loading || claimed}
            className={[
              "shrink-0 rounded-xl font-semibold transition-all",
              claimed
                ? "bg-primary/20 text-primary hover:bg-primary/20 cursor-default"
                : can_claim
                ? "bg-amber-500 text-black hover:bg-amber-400 animate-pulse shadow-[0_0_16px_rgba(245,158,11,0.35)]"
                : "",
            ].join(" ")}
          >
            {claimed ? (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                Odebrano!
              </>
            ) : loading ? (
              "Odbieram..."
            ) : (
              <>
                <Gift className="mr-1.5 h-3.5 w-3.5" />
                Odbierz nagrodę!
              </>
            )}
          </Button>
        )}

        {!can_claim && !claimed && (
          <span className="text-xs text-muted-foreground shrink-0">Wróć jutro</span>
        )}
      </div>
    </div>
  );
}
