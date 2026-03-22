import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

// Exact game color tokens
const C = {
  cyan: "#22d3ee",
  fg: "#f1f5f9",
  mutedFg: "#94a3b8",
  mutedFg60: "rgba(148,163,184,0.6)",
  border: "rgba(255,255,255,0.1)",
  amber: "#fbbf24",
  green: "#22c55e",
  red: "#ef4444",
};

interface QuickActionPanelProps {
  regionName: string;
  unitCount: number;
  playerColor: string;
  selectedPercent?: number;
  rajdhani?: string;
  barlow?: string;
}

export const QuickActionPanel: React.FC<QuickActionPanelProps> = ({
  regionName,
  unitCount,
  playerColor,
  selectedPercent = 50,
  rajdhani = "sans-serif",
  barlow = "sans-serif",
}) => {
  const frame = useCurrentFrame();
  const slideIn = interpolate(frame, [0, 12], [60, 0], { extrapolateRight: "clamp" });
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });

  const tankCount = 3;
  const tankMp = 9;
  const availableInfantry = unitCount - tankMp;

  const PERCENTS = [25, 50, 75, 100] as const;

  const UNIT_PILLS = [
    { label: `${availableInfantry}`, type: "infantry", active: true },
    { label: `${tankCount}(${tankMp})`, type: "tank", active: false },
  ];

  const BUILDINGS = [
    { name: "Baza", cost: 40, affordable: true, color: "#ef4444" },
    { name: "Fabryka", cost: 25, affordable: true, color: "#fbbf24" },
    { name: "Radar", cost: 15, affordable: true, color: "#22d3ee" },
    { name: "Port", cost: 30, affordable: false, color: "#457b9d" },
    { name: "Lotnisko", cost: 35, affordable: false, color: "#8b5cf6" },
  ];

  const PRODUCE = [
    { name: "Czolg", cost: 25, mp: 3, affordable: true, color: "#2a9d8f" },
    { name: "Artyleria", cost: 30, mp: 5, affordable: true, color: "#e9c46a" },
  ];

  return (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        left: "50%",
        transform: `translateX(-50%) translateY(${slideIn}px)`,
        opacity,
        width: 540,
        fontFamily: barlow,
      }}
    >
      <div
        style={{
          background: "rgba(15,23,42,0.9)",
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
          backdropFilter: "blur(24px)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: playerColor, flexShrink: 0, boxShadow: "0 0 0 1px rgba(255,255,255,0.2)" }} />
          <span style={{ color: C.fg, fontSize: 14, fontWeight: 600, fontFamily: barlow, flex: 1, letterSpacing: "0.02em" }}>{regionName}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.mutedFg, fontVariantNumeric: "tabular-nums" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: playerColor, opacity: 0.7 }} />
              <span style={{ fontWeight: 600, color: "rgba(241,245,249,0.8)" }}>{availableInfantry}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: "#2a9d8f", opacity: 0.7 }} />
              <span style={{ fontWeight: 600, fontSize: 10, color: "rgba(241,245,249,0.7)" }}>{tankCount}</span>
            </div>
            <span style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
            <span style={{ color: "rgba(255,255,0,0.8)", fontSize: 11 }}>⚡</span>
            <span style={{ fontWeight: 600, color: "rgba(241,245,249,0.7)", fontFamily: rajdhani }}>{500}</span>
          </div>
        </div>

        {/* Move section */}
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: C.mutedFg60, marginRight: 4, fontWeight: 600 }}>Wyslij</span>
            {PERCENTS.map((pct) => {
              const active = pct === selectedPercent;
              return (
                <div key={pct} style={{
                  padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: "monospace", fontVariantNumeric: "tabular-nums",
                  border: active ? "1px solid rgba(34,211,238,0.6)" : "1px solid rgba(255,255,255,0.1)",
                  background: active ? "rgba(34,211,238,0.2)" : "rgba(255,255,255,0.05)",
                  color: active ? C.cyan : C.mutedFg,
                  boxShadow: active ? "0 0 4px rgba(34,211,238,0.2)" : "none",
                }}>{pct === 100 ? "MAX" : `${pct}%`}</div>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {UNIT_PILLS.map((u) => (
              <div key={u.type} style={{
                display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 9999,
                border: u.active ? "1px solid rgba(34,211,238,0.6)" : "1px solid rgba(255,255,255,0.12)",
                background: u.active ? "rgba(34,211,238,0.2)" : "rgba(255,255,255,0.06)",
                color: u.active ? C.cyan : "rgba(255,255,255,0.6)",
                padding: "4px 10px", fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums",
              }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: u.active ? C.cyan : C.mutedFg, opacity: u.active ? 0.8 : 0.4 }} />
                {u.label}
              </div>
            ))}
          </div>
        </div>

        {/* Buildings */}
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 12px" }}>
          <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: C.mutedFg60, marginBottom: 8, fontWeight: 600, margin: 0, marginBottom: 8 }}>Budynki</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
            {BUILDINGS.map((b) => (
              <div key={b.name} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                border: b.affordable ? "1px solid rgba(34,197,94,0.25)" : `1px solid ${C.border}`,
                background: b.affordable ? "rgba(20,83,11,0.15)" : "rgba(255,255,255,0.03)",
                borderRadius: 8, padding: 6, opacity: b.affordable ? 1 : 0.55,
              }}>
                <div style={{ width: 20, height: 20, borderRadius: 4, background: `linear-gradient(135deg, ${b.color}, ${b.color}88)` }} />
                <span style={{ fontSize: 8, fontWeight: 500, color: C.mutedFg, textAlign: "center", lineHeight: 1.2 }}>{b.name}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span style={{ fontSize: 9, color: "#eab308" }}>⚡</span>
                  <span style={{ fontSize: 10, fontWeight: 700, fontFamily: rajdhani, fontVariantNumeric: "tabular-nums", color: b.affordable ? C.green : C.red }}>{b.cost}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Production */}
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 12px" }}>
          <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: C.mutedFg60, marginBottom: 8, fontWeight: 600, margin: 0, marginBottom: 8 }}>Produkcja</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
            {PRODUCE.map((u) => (
              <div key={u.name} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                border: u.affordable ? "1px solid rgba(34,197,94,0.25)" : `1px solid ${C.border}`,
                background: u.affordable ? "rgba(20,83,11,0.15)" : "rgba(255,255,255,0.03)",
                borderRadius: 8, padding: 6,
              }}>
                <div style={{ width: 20, height: 20, borderRadius: 4, background: `linear-gradient(135deg, ${u.color}, ${u.color}88)` }} />
                <span style={{ fontSize: 8, fontWeight: 500, color: C.mutedFg, textAlign: "center", lineHeight: 1.2 }}>{u.name}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span style={{ fontSize: 9, color: "#eab308" }}>⚡</span>
                  <span style={{ fontSize: 10, fontWeight: 700, fontFamily: rajdhani, fontVariantNumeric: "tabular-nums", color: u.affordable ? C.green : C.red }}>{u.cost}</span>
                  <span style={{ fontSize: 8, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: C.mutedFg }}>{u.mp}♟</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
