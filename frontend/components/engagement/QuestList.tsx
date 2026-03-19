"use client";

import { useState } from "react";
import { Coins, Star, Check, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { type QuestOut, type ClaimQuestOut } from "@/lib/api";

interface QuestListProps {
  quests: QuestOut[];
  onClaimQuest: (questId: string) => Promise<ClaimQuestOut>;
}

interface QuestRowProps {
  quest: QuestOut;
  onClaim: (questId: string) => Promise<ClaimQuestOut>;
}

const QUEST_TYPE_LABELS: Record<string, string> = {
  daily: "Dzienne",
  weekly: "Tygodniowe",
  monthly: "Miesięczne",
  special: "Specjalne",
};

function QuestRow({ quest, onClaim }: QuestRowProps) {
  const [loading, setLoading] = useState(false);
  const [claimed, setClaimed] = useState(quest.is_claimed);

  const handleClaim = async () => {
    if (loading || claimed || !quest.is_completed) return;
    setLoading(true);
    try {
      await onClaim(quest.id);
      setClaimed(true);
    } catch {
      // swallow
    } finally {
      setLoading(false);
    }
  };

  const progress = Math.min(quest.progress, quest.objective_count);
  const typeLabel = QUEST_TYPE_LABELS[quest.quest_type] ?? quest.quest_type;
  const isDone = quest.is_completed;

  return (
    <div
      className={[
        "flex items-center gap-3 rounded-xl px-3 py-3 transition-colors",
        isDone && !claimed ? "bg-primary/5" : "bg-transparent",
      ].join(" ")}
    >
      {/* Status dot */}
      <div
        className={[
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          claimed
            ? "bg-primary/15"
            : isDone
            ? "bg-primary/20 ring-1 ring-primary/30"
            : "bg-secondary/60",
        ].join(" ")}
      >
        {claimed ? (
          <Check className="h-4 w-4 text-primary" />
        ) : (
          <ScrollText className={`h-4 w-4 ${isDone ? "text-primary" : "text-muted-foreground"}`} />
        )}
      </div>

      {/* Text + progress */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p
            className={[
              "text-sm font-semibold leading-tight truncate",
              claimed ? "text-muted-foreground line-through" : "text-foreground",
            ].join(" ")}
          >
            {quest.title}
          </p>
          <Badge
            variant="outline"
            className={[
              "shrink-0 text-[10px] px-1.5 py-0 h-4",
              quest.quest_type === "weekly"
                ? "border-purple-500/30 text-purple-400"
                : "border-primary/30 text-primary/70",
            ].join(" ")}
          >
            {typeLabel}
          </Badge>
        </div>
        {!claimed && (
          <div className="flex items-center gap-2">
            <Progress
              value={progress}
              max={quest.objective_count}
              className={`h-1.5 flex-1 ${isDone ? "bg-primary/10 [&>div]:bg-primary" : ""}`}
            />
            <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
              {progress}/{quest.objective_count}
            </span>
          </div>
        )}
      </div>

      {/* Rewards + action */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="hidden sm:flex flex-col items-end gap-0.5">
          <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-400">
            <Coins className="h-3 w-3" />
            {quest.gold_reward}
          </span>
          <span className="flex items-center gap-1 text-[11px] font-semibold text-primary">
            <Star className="h-3 w-3" />
            {quest.xp_reward} XP
          </span>
        </div>

        {isDone && !claimed && (
          <Button
            size="sm"
            onClick={handleClaim}
            disabled={loading}
            className="h-7 rounded-lg px-3 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
          >
            {loading ? "..." : "Odbierz"}
          </Button>
        )}
        {claimed && (
          <span className="text-xs text-muted-foreground">Odebrano</span>
        )}
      </div>
    </div>
  );
}

export function QuestList({ quests, onClaimQuest }: QuestListProps) {
  if (quests.length === 0) return null;

  const completedCount = quests.filter((q) => q.is_completed && !q.is_claimed).length;

  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <ScrollText className="h-4 w-4 text-primary" />
        </div>
        <p className="flex-1 text-sm font-semibold text-foreground">Zadania</p>
        {completedCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
            {completedCount}
          </span>
        )}
      </div>

      {/* Quest rows */}
      <div className="px-1 pb-2 divide-y divide-border/50">
        {quests.map((quest) => (
          <QuestRow key={quest.id} quest={quest} onClaim={onClaimQuest} />
        ))}
      </div>
    </div>
  );
}
