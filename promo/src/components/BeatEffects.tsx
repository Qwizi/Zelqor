import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

// Beat times from audio analysis of "Crown of Ashes"
const BEATS = [
  3, 159, 213,            // intro hits
  426, 531, 636, 846,     // verse beats
  1377, 1428, 1440, 1455, 1482, 1545, 1560, 1587, 1629, 1668, 1692, // DROP
  1902, 2010, 2118,       // bridge
  2223, 2328, 2436, 2490, 2541, // build
  2646, 2754, 2793,       // finale
];

// Big impact moments (chorus hits, drops)
const BIG_HITS = [426, 846, 1377, 1440, 1902, 2223, 2646];

// The DROP zone (frames 1377-1700) — most intense
const DROP_START = 1377;
const DROP_END = 1700;

interface BeatEffectsProps {
  /** Optional: disable certain effects */
  disableFlash?: boolean;
  disableVignette?: boolean;
}

export const BeatEffects: React.FC<BeatEffectsProps> = ({
  disableFlash = false,
  disableVignette = false,
}) => {
  const frame = useCurrentFrame();

  // ── White flash on big beats ──────────────────────────────────────
  let flashAlpha = 0;
  if (!disableFlash) {
    for (const beat of BIG_HITS) {
      const diff = frame - beat;
      if (diff >= 0 && diff < 8) {
        // Quick white flash: peak at frame 1, fade by frame 8
        const intensity = diff === 0 ? 0.4 : diff === 1 ? 0.3 : Math.max(0, 0.25 - diff * 0.04);
        flashAlpha = Math.max(flashAlpha, intensity);
      }
    }
  }

  // ── Beat pulse (subtle zoom) — nearest beat proximity ─────────────
  let beatPulse = 0;
  for (const beat of BEATS) {
    const diff = Math.abs(frame - beat);
    if (diff < 6) {
      beatPulse = Math.max(beatPulse, (6 - diff) / 6);
    }
  }

  // ── Vignette — darker during quiet parts, lighter during drops ────
  let vignetteAlpha = 0;
  if (!disableVignette) {
    if (frame < 270) {
      // Intro: medium vignette
      vignetteAlpha = 0.3;
    } else if (frame >= DROP_START && frame <= DROP_END) {
      // Drop zone: reduce vignette (brighter = more energy)
      vignetteAlpha = 0.05;
    } else if (frame >= 1800 && frame < 2200) {
      // Diplomacy (quiet bridge): increase vignette
      vignetteAlpha = 0.25;
    } else {
      vignetteAlpha = 0.15;
    }
  }

  // ── Screen shake during DROP zone ─────────────────────────────────
  let shakeX = 0;
  let shakeY = 0;
  if (frame >= DROP_START && frame <= DROP_END) {
    const inDrop = frame - DROP_START;
    const shakeIntensity = 3 * Math.max(0, 1 - inDrop / (DROP_END - DROP_START));
    shakeX = Math.sin(frame * 1.7) * shakeIntensity;
    shakeY = Math.cos(frame * 2.3) * shakeIntensity;
  }
  // Also shake on big hits
  for (const beat of BIG_HITS) {
    const diff = frame - beat;
    if (diff >= 0 && diff < 5) {
      const intensity = (5 - diff) * 0.8;
      shakeX += Math.sin(diff * 3) * intensity;
      shakeY += Math.cos(diff * 4) * intensity;
    }
  }

  // ── Chromatic-style color tint pulse on DROP ──────────────────────
  let tintAlpha = 0;
  let tintColor = "rgba(34,211,238,0)";
  if (frame >= DROP_START && frame <= DROP_END) {
    for (const beat of BEATS) {
      const diff = frame - beat;
      if (diff >= 0 && diff < 4 && beat >= DROP_START && beat <= DROP_END) {
        tintAlpha = Math.max(tintAlpha, (4 - diff) * 0.05);
      }
    }
    tintColor = `rgba(34,211,238,${tintAlpha})`;
  }

  // ── Letterbox bars during cinematic moments ───────────────────────
  // Intro and CTA get letterbox bars for cinematic feel
  const letterboxHeight = frame < 270
    ? interpolate(frame, [0, 30], [60, 40], { extrapolateRight: "clamp" })
    : frame > 2600
      ? interpolate(frame, [2600, 2700], [0, 50], { extrapolateRight: "clamp" })
      : 0;

  return (
    <>
      {/* Screen shake wrapper — wraps everything via CSS transform on the container */}
      {(shakeX !== 0 || shakeY !== 0) && (
        <div
          style={{
            position: "absolute",
            inset: -10,
            transform: `translate(${shakeX}px, ${shakeY}px)`,
            pointerEvents: "none",
            zIndex: 90,
          }}
        />
      )}

      {/* White flash overlay */}
      {flashAlpha > 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `rgba(255,255,255,${flashAlpha})`,
            zIndex: 95,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Cyan tint pulse during DROP */}
      {tintAlpha > 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: tintColor,
            zIndex: 94,
            pointerEvents: "none",
            mixBlendMode: "screen",
          }}
        />
      )}

      {/* Vignette */}
      {vignetteAlpha > 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${vignetteAlpha}) 100%)`,
            zIndex: 92,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Letterbox bars */}
      {letterboxHeight > 0 && (
        <>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: letterboxHeight,
              background: "#000",
              zIndex: 96,
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: letterboxHeight,
              background: "#000",
              zIndex: 96,
            }}
          />
        </>
      )}

      {/* Beat pulse indicator — subtle border glow that pulses with beats */}
      {beatPulse > 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: `2px solid rgba(34,211,238,${beatPulse * 0.15})`,
            boxShadow: `inset 0 0 ${beatPulse * 30}px rgba(34,211,238,${beatPulse * 0.05})`,
            zIndex: 93,
            pointerEvents: "none",
          }}
        />
      )}
    </>
  );
};
