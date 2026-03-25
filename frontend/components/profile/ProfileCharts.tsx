"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { Match } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

type TabKey = "elo" | "results" | "activity";

interface ProfileChartsProps {
  matches: Match[];
  userId: string;
  currentElo: number;
}

// ─── Chart configs ───────────────────────────────────────────────────────────

const eloConfig: ChartConfig = {
  elo: { label: "ELO", color: "var(--color-accent)" },
};

const _resultsConfig: ChartConfig = {
  wins: { label: "Wygrane", color: "#4ade80" },
  losses: { label: "Przegrane", color: "#ef4444" },
  other: { label: "Inne", color: "var(--color-muted-foreground)" },
};

const activityConfig: ChartConfig = {
  count: { label: "Mecze", color: "var(--color-primary)" },
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function ProfileCharts({ matches, userId, currentElo }: ProfileChartsProps) {
  const [tab, setTab] = useState<TabKey>("elo");

  // Sort matches by date (oldest first)
  const sorted = useMemo(
    () =>
      [...matches]
        .filter((m) => m.status === "finished")
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [matches],
  );

  // ELO history — simulate from current ELO walking backwards through results
  const eloData = useMemo(() => {
    if (sorted.length === 0) return [];

    let elo = currentElo;

    const reversed = [...sorted].reverse();
    const eloHistory = [elo];
    for (const match of reversed) {
      const isWinner = match.winner_id === userId;
      const myPlayer = match.players.find((p) => p.user_id === userId);
      const isLoss = !isWinner && myPlayer && !myPlayer.is_alive;
      if (isWinner) elo -= 25;
      else if (isLoss) elo += 20;
      eloHistory.push(elo);
    }

    eloHistory.reverse();

    return sorted.map((_m, i) => ({
      label: `#${i + 1}`,
      elo: eloHistory[i + 1],
    }));
  }, [sorted, currentElo, userId]);

  // Win/Loss pie data
  const resultsData = useMemo(() => {
    let wins = 0;
    let losses = 0;
    let other = 0;
    for (const m of sorted) {
      const isWinner = m.winner_id === userId;
      const myPlayer = m.players.find((p) => p.user_id === userId);
      const isLoss = !isWinner && myPlayer && !myPlayer.is_alive;
      if (isWinner) wins++;
      else if (isLoss) losses++;
      else other++;
    }
    return [
      { name: "Wygrane", value: wins, fill: "#4ade80" },
      { name: "Przegrane", value: losses, fill: "#ef4444" },
      ...(other > 0 ? [{ name: "Inne", value: other, fill: "var(--color-muted-foreground)" }] : []),
    ];
  }, [sorted, userId]);

  // Activity — matches per day (last 14 days)
  const activityData = useMemo(() => {
    const days: Record<string, number> = {};
    const now = Date.now();
    // Init last 14 days
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const key = d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
      days[key] = 0;
    }
    for (const m of sorted) {
      const d = new Date(m.finished_at ?? m.created_at);
      const key = d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
      if (key in days) days[key]++;
    }
    return Object.entries(days).map(([date, count]) => ({ date, count }));
  }, [sorted]);

  const totalWins = resultsData.find((r) => r.name === "Wygrane")?.value ?? 0;
  const totalLosses = resultsData.find((r) => r.name === "Przegrane")?.value ?? 0;

  const tabs: { key: TabKey; label: string; mobileLabel: string }[] = [
    { key: "elo", label: "ELO Historia", mobileLabel: "ELO" },
    { key: "results", label: "Wyniki", mobileLabel: "W/L" },
    { key: "activity", label: "Aktywność", mobileLabel: "Mecze" },
  ];

  if (sorted.length === 0) return null;

  return (
    <div className="md:rounded-2xl md:border md:border-border md:bg-card md:p-5">
      {/* Tabs */}
      <div className="flex gap-1 mb-3 md:mb-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full md:rounded-lg px-3 py-1.5 md:px-4 md:py-2 text-xs md:text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-primary/15 text-primary border border-primary/25"
                : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
            }`}
          >
            <span className="md:hidden">{t.mobileLabel}</span>
            <span className="hidden md:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ELO Chart */}
      {tab === "elo" && (
        <ChartContainer config={eloConfig} className="h-[180px] md:h-[220px] w-full">
          <AreaChart data={eloData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="eloGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              stroke="var(--color-muted-foreground)"
              tickLine={false}
              axisLine={false}
              interval={Math.max(0, Math.floor(eloData.length / 10) - 1)}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              stroke="var(--color-muted-foreground)"
              tickLine={false}
              axisLine={false}
              domain={["dataMin - 30", "dataMax + 30"]}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area type="monotone" dataKey="elo" stroke="var(--color-accent)" strokeWidth={2} fill="url(#eloGrad)" />
          </AreaChart>
        </ChartContainer>
      )}

      {/* Results — horizontal bar chart instead of pie */}
      {tab === "results" && (
        <div className="h-[180px] md:h-[220px] flex flex-col justify-center gap-4 md:gap-5">
          {/* Win rate big number */}
          <div className="text-center">
            <span className="font-display text-4xl md:text-5xl tabular-nums text-foreground">
              {sorted.length > 0 ? Math.round((totalWins / sorted.length) * 100) : 0}%
            </span>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">Win Rate · {sorted.length} meczy</p>
          </div>

          {/* Stacked bar */}
          <div className="px-2 md:px-8">
            <div className="flex h-4 md:h-5 rounded-full overflow-hidden bg-secondary">
              {totalWins > 0 && (
                <div
                  className="bg-green-400 transition-[flex-basis] duration-300"
                  style={{ flexBasis: `${(totalWins / sorted.length) * 100}%` }}
                />
              )}
              {totalLosses > 0 && (
                <div
                  className="bg-red-500 transition-[flex-basis] duration-300"
                  style={{ flexBasis: `${(totalLosses / sorted.length) * 100}%` }}
                />
              )}
            </div>
            <div className="flex justify-between mt-2 md:mt-3">
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
                <span className="text-xs md:text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{totalWins}</span> wygranych
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                <span className="text-xs md:text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{totalLosses}</span> przegranych
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Activity Bar Chart */}
      {tab === "activity" && (
        <ChartContainer config={activityConfig} className="h-[180px] md:h-[220px] w-full">
          <BarChart data={activityData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9 }}
              stroke="var(--color-muted-foreground)"
              tickLine={false}
              axisLine={false}
              interval={1}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              stroke="var(--color-muted-foreground)"
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}
