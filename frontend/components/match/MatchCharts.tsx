"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  XAxis,
  YAxis,
} from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { Match, MatchResult } from "@/lib/api";

type TabKey = "comparison" | "radar";

interface MatchChartsProps {
  match: Match;
  result: MatchResult;
}

const PLAYER_COLORS = ["#22d3ee", "#fbbf24", "#4ade80", "#f43f5e", "#a78bfa", "#fb923c"];

export default function MatchCharts({ match, result }: MatchChartsProps) {
  const [tab, setTab] = useState<TabKey>("comparison");

  const players = result.player_results;

  // Build chart config from players
  const chartConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {};
    players.forEach((p, i) => {
      cfg[p.username] = {
        label: p.username,
        color: match.players.find((mp) => mp.user_id === p.user_id)?.color ?? PLAYER_COLORS[i % PLAYER_COLORS.length],
      };
    });
    return cfg;
  }, [players, match.players]);

  // Bar chart — stats per category, grouped by player
  const barData = useMemo(() => {
    const categories = [
      { key: "regions_conquered", label: "Regiony" },
      { key: "units_produced", label: "Jednostki" },
      { key: "units_lost", label: "Straty" },
      { key: "buildings_built", label: "Budynki" },
    ];

    return categories.map((cat) => {
      const row: Record<string, string | number> = { category: cat.label };
      players.forEach((p) => {
        row[p.username] = p[cat.key as keyof typeof p] as number;
      });
      return row;
    });
  }, [players]);

  // Radar chart data
  const radarData = useMemo(() => {
    const metrics = [
      { key: "regions_conquered", label: "Regiony" },
      { key: "units_produced", label: "Jednostki" },
      { key: "buildings_built", label: "Budynki" },
    ];

    // Normalize to 0-100 scale per metric
    return metrics.map((m) => {
      const values = players.map((p) => p[m.key as keyof typeof p] as number);
      const max = Math.max(...values, 1);
      const row: Record<string, string | number> = { metric: m.label };
      players.forEach((p) => {
        row[p.username] = Math.round(((p[m.key as keyof typeof p] as number) / max) * 100);
      });
      return row;
    });
  }, [players]);

  if (players.length === 0) return null;

  const tabs: { key: TabKey; label: string; mobileLabel: string }[] = [
    { key: "comparison", label: "Porównanie", mobileLabel: "Stats" },
    { key: "radar", label: "Radar", mobileLabel: "Radar" },
  ];

  return (
    <div className="md:rounded-2xl md:border md:border-border md:bg-card md:p-5">
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

      {/* Comparison Bar Chart */}
      {tab === "comparison" && (
        <ChartContainer config={chartConfig} className="h-[200px] md:h-[260px] w-full">
          <BarChart data={barData} margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="category"
              tick={{ fontSize: 11 }}
              stroke="var(--color-muted-foreground)"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              stroke="var(--color-muted-foreground)"
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            {players.map((p, i) => (
              <Bar
                key={p.user_id}
                dataKey={p.username}
                fill={
                  match.players.find((mp) => mp.user_id === p.user_id)?.color ?? PLAYER_COLORS[i % PLAYER_COLORS.length]
                }
                radius={[3, 3, 0, 0]}
              />
            ))}
          </BarChart>
        </ChartContainer>
      )}

      {/* Radar Chart */}
      {tab === "radar" && (
        <ChartContainer config={chartConfig} className="h-[280px] md:h-[360px] w-full">
          <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="80%">
            <PolarGrid stroke="var(--color-border)" />
            <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
            {players.map((p, i) => (
              <Radar
                key={p.user_id}
                name={p.username}
                dataKey={p.username}
                stroke={
                  match.players.find((mp) => mp.user_id === p.user_id)?.color ?? PLAYER_COLORS[i % PLAYER_COLORS.length]
                }
                fill={
                  match.players.find((mp) => mp.user_id === p.user_id)?.color ?? PLAYER_COLORS[i % PLAYER_COLORS.length]
                }
                fillOpacity={0.15}
                strokeWidth={2}
              />
            ))}
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            <ChartTooltip content={<ChartTooltipContent />} />
          </RadarChart>
        </ChartContainer>
      )}
    </div>
  );
}
