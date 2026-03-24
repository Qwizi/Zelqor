"use client";

import type { WeatherState } from "@/hooks/useGameSocket";

const PHASE_LABELS: Record<string, string> = {
  day: "Dzień",
  night: "Noc",
  dawn: "Świt",
  dusk: "Zmierzch",
};

const CONDITION_LABELS: Record<string, string> = {
  clear: "Czyste niebo",
  cloudy: "Pochmurno",
  rain: "Deszcz",
  fog: "Mgła",
  storm: "Burza",
};

const CONDITION_ICONS: Record<string, string> = {
  clear: "☀",
  cloudy: "☁",
  rain: "🌧",
  fog: "🌫",
  storm: "⛈",
};

const PHASE_ICONS: Record<string, string> = {
  day: "☀",
  night: "🌙",
  dawn: "🌅",
  dusk: "🌇",
};

interface Props {
  weather: WeatherState;
}

export default function WeatherIndicator({ weather }: Props) {
  const phaseIcon = PHASE_ICONS[weather.phase] ?? "☀";
  const condIcon = CONDITION_ICONS[weather.condition] ?? "";
  const phaseLabel = PHASE_LABELS[weather.phase] ?? weather.phase;
  const condLabel = CONDITION_LABELS[weather.condition] ?? weather.condition;

  const modifiers: string[] = [];
  if (weather.defense_modifier > 1.01) modifiers.push(`Obrona +${Math.round((weather.defense_modifier - 1) * 100)}%`);
  if (weather.randomness_modifier > 1.01)
    modifiers.push(`Chaos +${Math.round((weather.randomness_modifier - 1) * 100)}%`);
  if (weather.energy_modifier < 0.99) modifiers.push(`Energia ${Math.round((weather.energy_modifier - 1) * 100)}%`);
  if (weather.unit_gen_modifier < 0.99)
    modifiers.push(`Rekrutacja ${Math.round((weather.unit_gen_modifier - 1) * 100)}%`);

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-black/60 backdrop-blur-sm px-3 py-1.5 text-xs">
      <span className="text-base leading-none">{weather.condition === "clear" ? phaseIcon : condIcon}</span>
      <div className="flex flex-col">
        <span className="font-medium text-foreground">
          {phaseLabel} · {condLabel}
        </span>
        {modifiers.length > 0 && <span className="text-[10px] text-muted-foreground">{modifiers.join(" · ")}</span>}
      </div>
    </div>
  );
}
