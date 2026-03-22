import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

const C = {
  cyan: "#22d3ee",
  mutedFg: "#94a3b8",
  border: "rgba(255,255,255,0.1)",
  amber: "#fbbf24",
};

interface AbilitySlot {
  color: string;
  cost: number;
  level: number;
}

const ABILITIES: AbilitySlot[] = [
  { color: "#e63946", cost: 30, level: 3 },
  { color: "#457b9d", cost: 20, level: 2 },
  { color: "#2a9d8f", cost: 45, level: 2 },
  { color: "#e9c46a", cost: 50, level: 1 },
  { color: "#8b5cf6", cost: 25, level: 2 },
  { color: "#f97316", cost: 35, level: 1 },
];

function levelColor(lvl: number): string {
  if (lvl >= 3) return C.amber;
  if (lvl >= 2) return C.cyan;
  return C.mutedFg;
}

interface AbilityBarProps {
  rajdhani?: string;
  barlow?: string;
  selectedIndex?: number;
}

export const AbilityBar: React.FC<AbilityBarProps> = ({
  rajdhani = "sans-serif",
  barlow = "sans-serif",
  selectedIndex = 0,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
  const slideIn = interpolate(frame, [0, 15], [-20, 0], { extrapolateRight: "clamp" });

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        top: "50%",
        transform: `translateY(calc(-50% + ${slideIn}px))`,
        opacity,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 8,
        background: "rgba(15,23,42,0.9)",
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        backdropFilter: "blur(24px)",
        fontFamily: barlow,
      }}
    >
      {ABILITIES.map((ab, i) => {
        const isSelected = i === selectedIndex;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
            }}
          >
            {/* Placeholder icon */}
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 8,
                background: isSelected ? "rgba(34,211,238,0.15)" : "rgba(255,255,255,0.06)",
                border: isSelected
                  ? "1px solid rgba(34,211,238,0.6)"
                  : `1px solid ${C.border}`,
                boxShadow: isSelected
                  ? "0 0 10px rgba(34,211,238,0.3), inset 0 0 6px rgba(34,211,238,0.1)"
                  : "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}
            >
              {/* Colored placeholder square */}
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  background: `linear-gradient(135deg, ${ab.color}, ${ab.color}88)`,
                  opacity: isSelected ? 1 : 0.6,
                }}
              />

              {/* Level badge */}
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  right: 3,
                  fontSize: 9,
                  fontWeight: 700,
                  fontFamily: rajdhani,
                  color: levelColor(ab.level),
                  lineHeight: 1,
                }}
              >
                {ab.level}
              </span>
            </div>

            {/* Cost */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                fontSize: 11,
                fontFamily: rajdhani,
                fontWeight: 700,
              }}
            >
              <span style={{ color: C.amber, fontSize: 10 }}>⚡</span>
              <span style={{ color: isSelected ? C.cyan : C.mutedFg }}>{ab.cost}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
