import React, { useMemo } from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import type { SimState } from "../simulation";
import { provinces } from "../simulation";

// ─── Constants matching GameCanvas.tsx ────────────────────────────────────────

const DEFAULT_STROKE = "#1a3a2d";
const NORMAL_ALPHA = 0.60;
const WAR_STROKE = "#8b2020";
const NAP_STROKE = "#1a5c2d";
const CAPITAL_FILL = "#fbbf24";

export const PLAYER_COLORS = [
  "#e63946", // red
  "#457b9d", // blue
  "#2a9d8f", // teal
  "#e9c46a", // gold
];

// Player usernames for enemy province labels
const PLAYER_NAMES = ["Qwizi", "Wrog 1", "Wrog 2", "Wrog 3"];

// Coordinate mapping
const INT_X = -2891.9338;
const SLOPE_X = 3.622519;
const INT_Y = 7184.4125;
const SLOPE_Y = 3.248962;
export const TEX_W = 7452;
export const TEX_H = 4928;

const CHUNK_COLS = 27;
const CHUNK_ROWS = 16;
const CHUNK_W = 276;
const CHUNK_H = 308;

export function gameToTex(gx: number, gy: number): [number, number] {
  return [(gx - INT_X) / SLOPE_X, (gy - INT_Y) / SLOPE_Y];
}

// Province centroid cache
const centroidCache: Record<number, [number, number]> = {};
for (const p of provinces) {
  centroidCache[p.id] = gameToTex(p.centroid[0], p.centroid[1]);
}

// Pre-compute polygon paths in texture coords
const polyPathCache: Record<number, string[]> = {};
for (const p of provinces) {
  polyPathCache[p.id] = p.polygons.map((poly: number[][]) => {
    const pts = poly.map((pt: number[]) => gameToTex(pt[0], pt[1]));
    return pts.map((pt: number[], i: number) => `${i === 0 ? "M" : "L"}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(" ") + " Z";
  });
}

// ─── Label color constants matching GameCanvas.tsx exactly ────────────────────
// Own province:   fill 0x0a1a0a alpha 0.72, border 0x2a4a2a alpha 0.6
// Enemy province: fill 0x1a0a0a alpha 0.72, border 0x4a2a2a alpha 0.6
const OWN_FILL   = "rgba(10,26,10,0.72)";
const OWN_BORDER = "rgba(42,74,42,0.6)";
const ENE_FILL   = "rgba(26,10,10,0.72)";
const ENE_BORDER = "rgba(74,42,42,0.6)";

interface GameMapProps {
  simState: SimState;
  camera: { x: number; y: number; scale: number };
  viewerPlayer?: number;
  showUnits?: boolean;
  showCapitals?: boolean;
  /** Override canvas size (default 1920x1080) */
  width?: number;
  height?: number;
}

// ─── Rocket SVG helper ───────────────────────────────────────────────────────
// Renders a styled rocket (matching pixiAnimations.ts palette) centered at (0,0)
// pointing right (+X). Rotate via transform to align with flight direction.
const RocketSVG: React.FC<{ scale: number; progress: number; frame: number }> = ({ scale, progress, frame }) => {
  const wobble = Math.sin(progress * 40) * 0.06 * (1 - progress);
  const sz = 14 / scale; // rocket body half-length
  const hw = 3.5 / scale; // half-width

  return (
    <g transform={`rotate(${wobble * 57.3})`}>
      {/* Engine glow halo */}
      <ellipse cx={-sz * 0.6} cy={0} rx={sz * 0.55} ry={sz * 0.45}
        fill="rgba(255,102,0,0.15)" />

      {/* Exhaust flame — outer */}
      <ellipse cx={-sz} cy={0} rx={sz * 0.55} ry={hw * 0.7}
        fill="rgba(255,68,0,0.35)" />
      {/* Exhaust flame — inner */}
      <ellipse cx={-sz * 0.85} cy={0} rx={sz * 0.35} ry={hw * 0.45}
        fill="rgba(255,221,68,0.7)" />
      {/* Hot white core */}
      <ellipse cx={-sz * 0.7} cy={0} rx={sz * 0.15} ry={hw * 0.22}
        fill="rgba(255,255,255,0.9)" />

      {/* Fins — dark red */}
      <polygon points={`${-sz * 0.5},${hw} ${-sz},${hw * 2.2} ${-sz},0`}
        fill="#993322" />
      <polygon points={`${-sz * 0.5},${-hw} ${-sz},${-hw * 2.2} ${-sz},0`}
        fill="#993322" />

      {/* Rocket body — metallic gray */}
      <rect x={-sz * 0.6} y={-hw} width={sz * 1.1} height={hw * 2}
        rx={hw * 0.5}
        fill="#778899" stroke="#556677" strokeWidth={0.4 / scale} />

      {/* Yellow body stripe */}
      <rect x={-sz * 0.05} y={-hw} width={sz * 0.12} height={hw * 2}
        fill="#ffcc00" opacity={0.8} />

      {/* Nose cone — red */}
      <polygon points={`${sz * 0.5},0 ${-sz * 0.05},${-hw} ${-sz * 0.05},${hw}`}
        fill="#cc2200" />

      {/* Nose tip glow */}
      <circle cx={sz * 0.45} cy={0} r={hw * 0.35}
        fill="#ff4400" opacity={0.8} />
    </g>
  );
};

export const GameMap: React.FC<GameMapProps> = ({
  simState,
  camera,
  viewerPlayer = 0,
  showUnits = true,
  showCapitals = true,
  width: W = 1920,
  height: H = 1080,
}) => {
  const frame = useCurrentFrame();
  const { x: camX, y: camY, scale } = camera;

  // Compute viewBox from camera — uses actual canvas size
  const vbW = W / scale;
  const vbH = H / scale;
  const vbX = camX - vbW / 2;
  const vbY = camY - vbH / 2;

  // Chunk images within view
  const visibleChunks = useMemo(() => {
    const chunks: { cx: number; cy: number; x: number; y: number }[] = [];
    for (let cx = 0; cx < CHUNK_COLS; cx++) {
      for (let cy = 0; cy < CHUNK_ROWS; cy++) {
        const x = cx * CHUNK_W;
        const y = cy * CHUNK_H;
        // Rough visibility check
        if (x + CHUNK_W > vbX && x < vbX + vbW && y + CHUNK_H > vbY && y < vbY + vbH) {
          chunks.push({ cx, cy, x, y });
        }
      }
    }
    return chunks;
  }, [vbX, vbY, vbW, vbH]);

  return (
    <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, overflow: "hidden", background: "#08111d" }}>
      {/* Terrain chunk images */}
      {visibleChunks.map(({ cx, cy, x, y }) => (
        <Img
          key={`${cx}x${cy}`}
          src={staticFile(`assets/map_textures/map09/chunks_game/${cx}x${cy}.webp`)}
          style={{
            position: "absolute",
            left: (x - vbX) * scale,
            top: (y - vbY) * scale,
            width: CHUNK_W * scale,
            height: CHUNK_H * scale,
            imageRendering: "auto",
          }}
        />
      ))}

      {/* SVG overlay for provinces */}
      <svg
        width={W}
        height={H}
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        {/* Province fills and strokes */}
        {provinces.map((prov) => {
          const playerIdx = simState.ownership[prov.id];
          const isOwned = playerIdx !== undefined;
          const isViewer = playerIdx === viewerPlayer;
          const isSelected = simState.selectedProvince === prov.id;

          let fillColor = "transparent";
          let fillOpacity = 0;
          if (isOwned) {
            fillColor = PLAYER_COLORS[playerIdx % PLAYER_COLORS.length];
            fillOpacity = NORMAL_ALPHA;
          }

          let strokeColor = DEFAULT_STROKE;
          let showHatch = false;
          if (isOwned && !isViewer) {
            const isAtWar = simState.wars.some(([a, b]) =>
              (a === viewerPlayer && b === playerIdx) || (b === viewerPlayer && a === playerIdx));
            const hasNap = simState.pacts.some(([a, b]) =>
              (a === viewerPlayer && b === playerIdx) || (b === viewerPlayer && a === playerIdx));
            if (isAtWar) {
              strokeColor = WAR_STROKE;
              showHatch = true;
            } else if (hasNap) {
              strokeColor = NAP_STROKE;
              fillOpacity = 0.45;
            } else {
              showHatch = true;
            }
          }

          const paths = polyPathCache[prov.id] || [];
          const strokeWidth = isSelected ? 3 / scale : 2 / scale;
          const finalStroke = isSelected ? "#ffffff" : strokeColor;

          return (
            <g key={prov.id}>
              {paths.map((d, i) => (
                <path
                  key={i}
                  d={d}
                  fill={fillColor}
                  fillOpacity={fillOpacity}
                  stroke={finalStroke}
                  strokeWidth={strokeWidth}
                  strokeOpacity={0.8}
                />
              ))}
              {/* War pulse */}
              {isOwned && !isViewer && strokeColor === WAR_STROKE && paths.map((d, i) => {
                const pulse = 0.4 + 0.4 * Math.sin(frame * 0.2);
                return <path key={`wp-${i}`} d={d} fill="none" stroke="#ff3030" strokeWidth={3 / scale} strokeOpacity={pulse} />;
              })}
            </g>
          );
        })}

        {/* Troop movement — unit sprite icon + dashed trail + pulse ring */}
        {simState.troops.map((troop, i) => {
          const from = centroidCache[troop.fromId];
          const to = centroidCache[troop.toId];
          if (!from || !to) return null;
          const t = troop.progress;
          const cx = from[0] + (to[0] - from[0]) * t;
          const cy = from[1] + (to[1] - from[1]) * t;
          const color = PLAYER_COLORS[troop.playerIdx % PLAYER_COLORS.length];
          const iconSize = 28 / scale;
          const breathe = 1 + Math.sin(t * 12) * 0.08;
          const sz = iconSize * breathe;

          // Rotation toward direction of travel
          const dx = to[0] - from[0];
          const dy = to[1] - from[1];
          const rotation = Math.atan2(dx, -dy) * (180 / Math.PI);

          // Fade out near arrival
          const fadeOut = t > 0.85 ? Math.pow(1 - (t - 0.85) / 0.15, 2) : 1;

          // Pulse ring on target (attack only, near arrival)
          const showPulse = troop.type === "attack" && t > 0.6;
          const pulsePhase = showPulse ? ((frame * 0.15 + i * 2) % 1) : 0;
          const pulseR = pulsePhase * 30 / scale;
          const pulseAlpha = showPulse ? (1 - pulsePhase) * 0.35 * fadeOut : 0;

          return (
            <g key={`troop-${i}`} opacity={fadeOut}>
              {/* Dashed trail line */}
              <line x1={from[0]} y1={from[1]} x2={cx} y2={cy}
                stroke={color} strokeWidth={2 / scale} strokeOpacity={0.5}
                strokeDasharray={`${6 / scale} ${4 / scale}`} />

              {/* Glow trail */}
              <line x1={from[0]} y1={from[1]} x2={cx} y2={cy}
                stroke={color} strokeWidth={5 / scale} strokeOpacity={0.12} />

              {/* Player color circle behind icon */}
              <circle cx={cx} cy={cy} r={sz * 0.55}
                fill={color} fillOpacity={0.3}
                stroke={color} strokeWidth={1.5 / scale} strokeOpacity={0.6} />

              {/* Unit SVG icon — infantry soldier sprite, colored by player */}
              <g transform={`translate(${cx}, ${cy}) rotate(${rotation}) scale(${sz / 300})`}>
                <g transform="translate(-150, -150)" fill={color} fillOpacity={0.85}>
                  {/* Shadow */}
                  <ellipse cx="150" cy="268" rx="30" ry="7" fill={color} opacity="0.15"/>
                  {/* Legs */}
                  <rect x="130" y="205" width="13" height="50" rx="4" stroke={color} strokeWidth="1.5"/>
                  <rect x="157" y="205" width="13" height="50" rx="4" stroke={color} strokeWidth="1.5"/>
                  {/* Boots */}
                  <rect x="127" y="247" width="19" height="12" rx="3" stroke={color} strokeWidth="1"/>
                  <rect x="154" y="247" width="19" height="12" rx="3" stroke={color} strokeWidth="1"/>
                  {/* Body */}
                  <polygon points="127,130 173,130 180,205 120,205" stroke={color} strokeWidth="2"/>
                  {/* Belt */}
                  <rect x="122" y="185" width="56" height="6" rx="2"/>
                  {/* Arms */}
                  <rect x="108" y="132" width="14" height="50" rx="5" transform="rotate(8, 115, 132)"/>
                  <rect x="178" y="132" width="14" height="50" rx="5" transform="rotate(-12, 185, 132)"/>
                  {/* Rifle */}
                  <rect x="170" y="120" width="5" height="65" rx="2" transform="rotate(-20, 172, 152)"/>
                  {/* Head */}
                  <circle cx="150" cy="110" r="20" stroke={color} strokeWidth="2"/>
                  {/* Helmet */}
                  <path d="M130,105 Q130,85 150,82 Q170,85 170,105" stroke={color} strokeWidth="2"/>
                  <path d="M128,108 Q150,112 172,108" fill="none" stroke={color} strokeWidth="2"/>
                </g>
              </g>

              {/* Unit count label above icon */}
              <text x={cx} y={cy - sz * 0.6 - 4 / scale} textAnchor="middle" fill="#fff"
                fontSize={10 / scale} fontWeight="bold" fontFamily="monospace"
                opacity={fadeOut}>
                {troop.units}
              </text>

              {/* Pulse ring on target for attacks */}
              {showPulse && (
                <circle cx={to[0]} cy={to[1]} r={pulseR}
                  fill="none" stroke={color}
                  strokeWidth={1.5 / scale} strokeOpacity={pulseAlpha} />
              )}
            </g>
          );
        })}

        {/* Artillery rockets — parabolic arc with proper rocket rendering */}
        {simState.artillery.map((shot, i) => {
          const from = centroidCache[shot.fromId];
          const to = centroidCache[shot.toId];
          if (!from || !to) return null;

          const t = shot.progress;

          // Parabolic arc: lerp position + vertical arc offset
          const px = from[0] + (to[0] - from[0]) * t;
          const pyBase = from[1] + (to[1] - from[1]) * t;
          // Arc height scales with distance — rises then falls
          const dx = to[0] - from[0];
          const dy = to[1] - from[1];
          const dist = Math.sqrt(dx * dx + dy * dy);
          const arcHeight = Math.min(dist * 0.35, 300 / scale);
          const arcOffset = -arcHeight * Math.sin(t * Math.PI);
          const py = pyBase + arcOffset;

          // Flight angle: derivative of arc path
          const dtOffset = 0.01;
          const pxN = from[0] + (to[0] - from[0]) * (t + dtOffset);
          const pyBaseN = from[1] + (to[1] - from[1]) * (t + dtOffset);
          const arcOffsetN = -arcHeight * Math.sin((t + dtOffset) * Math.PI);
          const pyN = pyBaseN + arcOffsetN;
          const angleDeg = Math.atan2(pyN - py, pxN - px) * (180 / Math.PI);

          // Smoke trail — sample a few past positions
          const smokeCount = 5;
          const smokes: { sx: number; sy: number; alpha: number }[] = [];
          for (let s = 1; s <= smokeCount; s++) {
            const st = Math.max(0, t - s * 0.04);
            const sx = from[0] + (to[0] - from[0]) * st;
            const syBase = from[1] + (to[1] - from[1]) * st;
            const sArc = -arcHeight * Math.sin(st * Math.PI);
            smokes.push({ sx, sy: syBase + sArc, alpha: (1 - s / smokeCount) * 0.3 * t });
          }

          const impactProgress = t >= 0.9 ? (t - 0.9) / 0.1 : 0;

          return (
            <g key={`art-${i}`}>
              {/* Smoke trail */}
              {smokes.map((sm, si) => (
                <circle key={`sm-${si}`} cx={sm.sx} cy={sm.sy}
                  r={(2 + si * 0.8) / scale}
                  fill="#aaaaaa" fillOpacity={sm.alpha} />
              ))}

              {/* Rocket group — translated to position and rotated to face direction */}
              {t < 0.95 && (
                <g transform={`translate(${px},${py}) rotate(${angleDeg})`}>
                  <RocketSVG scale={scale} progress={t} frame={frame} />
                </g>
              )}

              {/* Impact explosion rings */}
              {impactProgress > 0 && (
                <>
                  {/* Outer expanding ring */}
                  <circle cx={to[0]} cy={to[1]}
                    r={impactProgress * 35 / scale}
                    fill="none" stroke="#ff6633"
                    strokeWidth={2 / scale}
                    strokeOpacity={(1 - impactProgress) * 0.9} />
                  {/* Mid ring */}
                  <circle cx={to[0]} cy={to[1]}
                    r={impactProgress * 20 / scale}
                    fill="none" stroke="#ffaa33"
                    strokeWidth={1.5 / scale}
                    strokeOpacity={(1 - impactProgress) * 0.7} />
                  {/* Inner glow fill */}
                  <circle cx={to[0]} cy={to[1]}
                    r={impactProgress * 10 / scale}
                    fill="#ff9933"
                    fillOpacity={(1 - impactProgress) * 0.5} />
                  {/* Bright center flash */}
                  {impactProgress < 0.4 && (
                    <circle cx={to[0]} cy={to[1]}
                      r={(0.4 - impactProgress) * 8 / scale}
                      fill="white"
                      fillOpacity={(0.4 - impactProgress) * 2.5} />
                  )}
                </>
              )}
            </g>
          );
        })}

        {/* Capital markers — capital_star.png sprite, same as game (26x26, offset left-up from centroid) */}
        {showCapitals && simState.capitals.map((capId) => {
          if (simState.ownership[capId] === undefined) return null;
          const c = centroidCache[capId];
          if (!c) return null;
          const starSize = 26 / scale;
          const time = frame / 30;
          // Game positions the star sprite at (cx - 28, cy - 30) relative to centroid
          const sx = c[0] - 28 / scale;
          const sy = c[1] - 30 / scale;

          return (
            <g key={`cap-${capId}`}>
              {/* capital_star.png from game assets */}
              <image
                href={staticFile("assets/units/capital_star.png")}
                x={sx}
                y={sy}
                width={starSize}
                height={starSize}
              />
              {/* Radar pulse rings */}
              {[0, 1].map((ring) => {
                const phase = (time * 0.8 + ring * 0.5) % 1.5;
                const radius = (phase * 30) / scale;
                const alpha = Math.max(0, 1 - phase / 1.5) * 0.4;
                return (
                  <circle key={ring} cx={c[0]} cy={c[1]} r={radius}
                    fill="none" stroke={CAPITAL_FILL} strokeWidth={1.5 / scale} strokeOpacity={alpha} />
                );
              })}
            </g>
          );
        })}

        {/* Unit labels — exact game style */}
        {showUnits && provinces.map((prov) => {
          const playerIdx = simState.ownership[prov.id];
          if (playerIdx === undefined) return null;
          const count = simState.units[prov.id] || 0;
          if (count <= 0) return null;
          const c = centroidCache[prov.id];
          if (!c) return null;

          const isViewer = playerIdx === viewerPlayer;

          // Enemy province: show username (first 8 chars) instead of unit count
          // unless they are being attacked (troop targeting them)
          const isBeingAttacked = simState.troops.some(
            (tr) => tr.toId === prov.id && tr.type === "attack"
          );
          const showUnits_ = isViewer || isBeingAttacked;

          // Build label text — "▸ XXX" for own, username for enemy
          let labelText: string;
          if (showUnits_) {
            labelText = `\u25B8 ${count}`;
          } else {
            // Show player username (first 8 chars)
            const name = PLAYER_NAMES[playerIdx % PLAYER_NAMES.length];
            labelText = name.slice(0, 8);
          }

          // Width: Math.max(text.length * 9, 20), height: 18 — all in game/texture space
          const charW = 9 / scale;
          const lw = Math.max(labelText.length * charW, 20 / scale);
          const lh = 18 / scale;
          const fs = 10 / scale;

          const fillColor   = isViewer ? OWN_FILL   : ENE_FILL;
          const strokeColor = isViewer ? OWN_BORDER : ENE_BORDER;

          return (
            <g key={`label-${prov.id}`}>
              <rect
                x={c[0] - lw / 2}
                y={c[1] + 10 / scale}
                width={lw}
                height={lh}
                rx={3 / scale}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={0.5 / scale}
              />
              <text
                x={c[0]}
                y={c[1] + 10 / scale + lh * 0.72}
                textAnchor="middle"
                fill="#fff"
                fontSize={fs}
                fontWeight="bold"
                fontFamily="monospace"
              >
                {labelText}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
