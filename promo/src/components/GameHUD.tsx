import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

// ─── Color constants (exact from game) ────────────────────────────────────────
const C = {
  bg: "#020617",
  card: "#0f172a",
  cyan: "#22d3ee",
  fg: "#f1f5f9",
  muted: "#1e293b",
  mutedFg: "#94a3b8",
  border: "rgba(255,255,255,0.1)",
  amber: "#fbbf24",
  red: "#ef4444",
  emerald: "#34d399",
};

interface Player {
  name: string;
  color: string;
  regions: number;
  units: number;
  isAlive: boolean;
  relation?: "war" | "nap" | "neutral";
}

interface Proposal {
  from: string;
  type: "war" | "nap" | "peace";
}

interface GameHUDProps {
  tick: number;
  tickIntervalMs?: number;
  status: string;
  players: Player[];
  viewerIndex: number;
  energy: number;
  regionCount: number;
  unitCount: number;
  capitalProtectionRemaining?: number;
  fps?: number;
  ping?: number;
  proposals?: Proposal[];
  rajdhani?: string;
  barlow?: string;
}

function formatClock(tick: number, tickMs: number) {
  const s = Math.floor((tick * tickMs) / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export const GameHUD: React.FC<GameHUDProps> = ({
  tick,
  tickIntervalMs = 1000,
  status,
  players,
  viewerIndex,
  energy,
  regionCount,
  unitCount,
  capitalProtectionRemaining,
  fps = 60,
  ping = 24,
  proposals = [],
  rajdhani = "sans-serif",
  barlow = "sans-serif",
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });

  const protectionSeconds = capitalProtectionRemaining
    ? Math.ceil((capitalProtectionRemaining * tickIntervalMs) / 1000)
    : 0;

  const sorted = players
    .slice()
    .sort((a, b) => b.regions - a.regions);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        opacity,
        maxWidth: 268,
        fontFamily: barlow,
      }}
    >
      {/* ── Clock bar ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          background: "rgba(15,23,42,0.85)",
          borderRadius: 9999,
          padding: "6px 10px",
          border: `1px solid ${C.border}`,
          backdropFilter: "blur(24px)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
        }}
      >
        {/* Clock */}
        <span
          style={{
            fontFamily: rajdhani,
            fontSize: 16,
            fontWeight: 700,
            color: C.cyan,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatClock(tick, tickIntervalMs)}
        </span>

        {/* Status badge */}
        <span
          style={{
            background: "rgba(34,211,238,0.15)",
            color: C.cyan,
            padding: "2px 8px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
          }}
        >
          {status}
        </span>

        {/* FPS / ping */}
        <span
          style={{
            fontFamily: "monospace",
            fontVariantNumeric: "tabular-nums",
            fontSize: 12,
            color: C.mutedFg,
            fontWeight: 600,
            marginLeft: "auto",
            whiteSpace: "nowrap",
          }}
        >
          {fps}&nbsp;FPS&nbsp;·&nbsp;{ping}ms
        </span>
      </div>

      {/* ── Capital protection timer ───────────────────────────────────────────── */}
      {protectionSeconds > 0 && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "rgba(251,191,36,0.1)",
            border: "1px solid rgba(251,191,36,0.3)",
            borderRadius: 9999,
            padding: "5px 10px",
            fontSize: 12,
          }}
        >
          <span style={{ fontSize: 13 }}>🛡</span>
          <span style={{ color: "#fcd34d", fontWeight: 600, fontFamily: barlow }}>
            Ochrona stolic
          </span>
          <span
            style={{
              marginLeft: "auto",
              color: C.amber,
              fontWeight: 700,
              fontFamily: rajdhani,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {Math.floor(protectionSeconds / 60)}:
            {String(protectionSeconds % 60).padStart(2, "0")}
          </span>
        </div>
      )}

      {/* ── Stat cards (3-column) ──────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { label: "Energia", value: energy, icon: "⚡" },
          { label: "Regiony", value: regionCount, icon: "🗺" },
          { label: "Siła", value: unitCount, icon: "⚔" },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              background: "rgba(15,23,42,0.8)",
              border: `1px solid ${C.border}`,
              borderRadius: 16,
              padding: "6px 8px",
              backdropFilter: "blur(24px)",
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: C.mutedFg,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontFamily: barlow,
              }}
            >
              <span>{stat.icon}</span>
              {stat.label}
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: C.fg,
                marginTop: 4,
                fontFamily: rajdhani,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Ranking panel ─────────────────────────────────────────────────────── */}
      <div
        style={{
          background: "rgba(15,23,42,0.8)",
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 6,
          backdropFilter: "blur(24px)",
          boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: C.mutedFg,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            padding: "2px 6px 4px",
            fontFamily: barlow,
            fontWeight: 600,
          }}
        >
          RANKING
        </div>

        {sorted.map((player, rankIdx) => {
          const isViewer = players.indexOf(player) === viewerIndex;
          const isWar = player.relation === "war";
          const isNap = player.relation === "nap";

          return (
            <div
              key={player.name}
              style={{
                display: "grid",
                gridTemplateColumns: "18px 1fr auto",
                alignItems: "center",
                gap: 8,
                padding: "4px 8px",
                borderRadius: 8,
                background: isViewer ? "rgba(255,255,255,0.05)" : "transparent",
              }}
            >
              {/* Rank number */}
              <span
                style={{
                  color: C.mutedFg,
                  fontWeight: 600,
                  fontSize: 11,
                  fontFamily: rajdhani,
                }}
              >
                {rankIdx + 1}
              </span>

              {/* Color dot + name + badge */}
              <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: player.color,
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    color: player.isAlive ? C.fg : "rgba(255,255,255,0.3)",
                    textDecoration: player.isAlive ? "none" : "line-through",
                    fontFamily: barlow,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {player.name}
                  {isViewer ? " (Ty)" : ""}
                </span>

                {/* Relation badge */}
                {!isViewer && isWar && (
                  <span
                    style={{
                      background: "rgba(239,68,68,0.15)",
                      color: "#f87171",
                      borderRadius: 4,
                      padding: "1px 5px",
                      fontSize: 10,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    ⚔
                  </span>
                )}
                {!isViewer && isNap && (
                  <span
                    style={{
                      background: "rgba(16,185,129,0.15)",
                      color: C.emerald,
                      borderRadius: 4,
                      padding: "1px 5px",
                      fontSize: 10,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    🤝
                  </span>
                )}
              </div>

              {/* Stats: Xr · Yu */}
              <span
                style={{
                  color: C.mutedFg,
                  fontFamily: rajdhani,
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                {player.regions}r&nbsp;·&nbsp;{player.units}u
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Incoming proposals ────────────────────────────────────────────────── */}
      {proposals.length > 0 && (
        <div
          style={{
            background: "rgba(15,23,42,0.85)",
            border: "1px solid rgba(251,191,36,0.3)",
            borderRadius: 12,
            padding: 8,
            backdropFilter: "blur(24px)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: C.amber,
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              fontWeight: 600,
              fontFamily: barlow,
              marginBottom: 6,
              padding: "0 4px",
            }}
          >
            PROPOZYCJE
          </div>
          {proposals.map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "rgba(255,255,255,0.06)",
                borderRadius: 8,
                padding: "6px 8px",
                marginBottom: i < proposals.length - 1 ? 4 : 0,
              }}
            >
              <span style={{ fontSize: 12, color: C.fg, flex: 1, fontFamily: barlow }}>
                {p.from}{" "}
                <span style={{ color: C.mutedFg }}>
                  {p.type === "war" ? "ogłasza wojnę" : p.type === "nap" ? "proponuje NAP" : "proponuje pokój"}
                </span>
              </span>
              {/* Accept */}
              <span
                style={{
                  background: "rgba(34,211,238,0.15)",
                  color: C.cyan,
                  border: "1px solid rgba(34,211,238,0.3)",
                  borderRadius: 6,
                  padding: "2px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: barlow,
                }}
              >
                ✓
              </span>
              {/* Reject */}
              <span
                style={{
                  background: "rgba(239,68,68,0.15)",
                  color: "#f87171",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 6,
                  padding: "2px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: barlow,
                }}
              >
                ✕
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
