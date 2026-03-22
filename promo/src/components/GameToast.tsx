import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

// ─── Color constants (exact from game) ────────────────────────────────────────
const C = {
  cyan: "#22d3ee",
  fg: "#f1f5f9",
  mutedFg: "#94a3b8",
};

type ToastVariant = "war" | "peace" | "info";

interface ToastStyle {
  border: string;
  background: string;
  color: string;
  icon: string;
}

const VARIANTS: Record<ToastVariant, ToastStyle> = {
  war: {
    border: "rgba(239,68,68,0.3)",
    background: "rgba(239,68,68,0.1)",
    color: "#fca5a5",
    icon: "⚔",
  },
  peace: {
    border: "rgba(34,197,94,0.3)",
    background: "rgba(34,197,94,0.1)",
    color: "#86efac",
    icon: "🕊",
  },
  info: {
    border: "rgba(34,211,238,0.3)",
    background: "rgba(34,211,238,0.1)",
    color: C.cyan,
    icon: "ℹ",
  },
};

interface GameToastProps {
  message: string;
  variant?: ToastVariant;
  /** Frame within the parent Sequence when toast appears */
  showAt?: number;
  /** Frame within the parent Sequence when toast starts fading */
  hideAt?: number;
  rajdhani?: string;
  barlow?: string;
}

export const GameToast: React.FC<GameToastProps> = ({
  message,
  variant = "info",
  showAt = 0,
  hideAt = 60,
  rajdhani = "sans-serif",
  barlow = "sans-serif",
}) => {
  const frame = useCurrentFrame();
  const style = VARIANTS[variant];

  // Slide down + fade in
  const slideY = interpolate(
    frame,
    [showAt, showAt + 12],
    [-32, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const fadeIn = interpolate(
    frame,
    [showAt, showAt + 10],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const fadeOut = interpolate(
    frame,
    [hideAt, hideAt + 12],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <div
      style={{
        position: "absolute",
        top: 20,
        left: "50%",
        transform: `translateX(-50%) translateY(${slideY}px)`,
        opacity,
        minWidth: 360,
        borderRadius: 16,
        padding: "20px 24px",
        border: `2px solid ${style.border}`,
        background: style.background,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        backdropFilter: "blur(24px)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: barlow,
      }}
    >
      {/* Icon */}
      <span style={{ fontSize: 22, flexShrink: 0 }}>{style.icon}</span>

      {/* Message */}
      <span
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: style.color,
          fontFamily: barlow,
          letterSpacing: "0.01em",
        }}
      >
        {message}
      </span>
    </div>
  );
};
