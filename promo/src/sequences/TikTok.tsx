import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  staticFile,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Rajdhani";
import { loadFont as loadBarlow } from "@remotion/google-fonts/Barlow";
import { GameMap, PLAYER_COLORS, TEX_W, TEX_H } from "../components/GameMap";
import { simulate } from "../simulation";

const { fontFamily: rajdhani } = loadFont();
const { fontFamily: barlow } = loadBarlow();

// ─── Color tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#020617",
  card: "rgba(15,23,42,0.85)",
  cyan: "#22d3ee",
  fg: "#f1f5f9",
  mutedFg: "#94a3b8",
  border: "rgba(255,255,255,0.1)",
  amber: "#fbbf24",
};

const textGlow = (color: string): React.CSSProperties => ({
  textShadow: `0 0 30px ${color}, 0 0 60px ${color}40`,
});

// ─── Timing: use the best 20s of "Crown of Ashes" (chorus 28-48s) ───────────
const FPS = 30;
const s = (sec: number) => Math.round(sec * FPS);

// Music: use 14-35s (verse "Maps on fire" → chorus "empires rise/fall")
// Beats in this range: 14.2, 17.7, 21.2, 28.2
const MUSIC_START_FRAME = s(14); // start from "Maps on fire"

// Scene timing matched to lyrics:
// 14s "Maps on fire"   → logo slam
// 17s "Names in smoke" → map reveal, expansion
// 21s "Every oath"     → close-up, action
// 24s "A loaded stroke" → strategy
// 28s "Empires rise"   → war, combat
// 31s "Empires fall"   → red spreading
// 34s "Claim the crown"→ dominance + CTA
const LOGO_DUR    = s(3);    // 0-3s   (music 14-17s) — logo on "Maps on fire"
const EXPAND_DUR  = s(4);    // 3-7s   (music 17-21s) — "Names in smoke", expansion
const ACTION_DUR  = s(3);    // 7-10s  (music 21-24s) — "Every oath", close-up
const WAR_DUR     = s(4);    // 10-14s (music 24-28s) — war, combat
const RISE_DUR    = s(3);    // 14-17s (music 28-31s) — "Empires rise", red spreading
const DOMINATE_DUR= s(3);    // 17-20s (music 31-34s) — "Empires fall", dominance
const CTA_DUR     = s(2);    // 20-22s (music 34-36s) — "Claim the crown", CTA

let offset = 0;
const LOGO     = offset; offset += LOGO_DUR;
const EXPAND   = offset; offset += EXPAND_DUR;
const ACTION   = offset; offset += ACTION_DUR;
const WAR      = offset; offset += WAR_DUR;
const RISE     = offset; offset += RISE_DUR;
const DOMINATE = offset; offset += DOMINATE_DUR;
const CTA_T    = offset; offset += CTA_DUR;
// Total: 660 frames = 22s

// ─── Vertical cameras for 1080x1920 ──────────────────────────────────────────
// viewBox: w=1080/scale, h=1920/scale. TEX is 7452x4928.
// scale 0.40 → vbW=2700 vbH=4800 — fills width, height clips ocean (OK)
// scale 0.55 → vbW=1964 vbH=3491 — tighter
const CENTER = { x: TEX_W / 2, y: TEX_H / 2 };
const VCAM_WORLD    = { x: CENTER.x, y: CENTER.y, scale: 0.40 };
const VCAM_AMERICAS = { x: 1500, y: CENTER.y, scale: 0.55 };
const VCAM_EUROPE   = { x: CENTER.x + 400, y: CENTER.y - 100, scale: 0.55 };
const VCAM_AFRICA   = { x: CENTER.x + 200, y: CENTER.y + 200, scale: 0.55 };
const VCAM_CLOSE    = { x: 1800, y: CENTER.y, scale: 0.70 };

// ─── Mobile HUD (compact, top-left, like real mobile game) ───────────────────
const MobileHUD: React.FC<{
  tick: number;
  energy: number;
  regions: number;
  units: number;
  status: string;
  players: { name: string; color: string; regions: number; units: number; isAlive: boolean }[];
}> = ({ tick, energy, regions, units, status, players }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const tickMs = 1000;
  const secs = Math.floor((tick * tickMs) / 1000);
  const clock = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div style={{ position: "absolute", top: 12, left: 8, right: 8, opacity, fontFamily: barlow, zIndex: 10 }}>
      {/* Clock bar */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        background: C.card, borderRadius: 9999, padding: "4px 10px",
        border: `1px solid ${C.border}`, fontSize: 10,
      }}>
        <span style={{ fontFamily: rajdhani, fontSize: 12, fontWeight: 700, color: C.cyan }}>{clock}</span>
        <span style={{ width: 3, height: 3, borderRadius: "50%", background: "rgba(255,255,255,0.2)" }} />
        <span style={{ background: "rgba(34,211,238,0.15)", color: C.cyan, padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600 }}>
          {status}
        </span>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {[
          { icon: "⚡", label: "Energia", value: energy },
          { icon: "🗺", label: "Regiony", value: regions },
          { icon: "⚔", label: "Siła", value: units },
        ].map((st) => (
          <div key={st.label} style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: "4px 6px", flex: 1,
          }}>
            <div style={{ fontSize: 8, color: C.mutedFg, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {st.icon} {st.label}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.fg, fontFamily: rajdhani, marginTop: 2 }}>
              {st.value}
            </div>
          </div>
        ))}
      </div>

      {/* Mini ranking — right side */}
      <div style={{
        position: "absolute", top: 0, right: 0,
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
        padding: 4, fontSize: 10,
      }}>
        {players.sort((a, b) => b.regions - a.regions).map((p, i) => (
          <div key={p.name} style={{
            display: "flex", alignItems: "center", gap: 4, padding: "1px 4px",
            opacity: p.isAlive ? 1 : 0.4,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
            <span style={{
              color: C.fg, fontSize: 9, fontFamily: barlow,
              textDecoration: p.isAlive ? "none" : "line-through",
              whiteSpace: "nowrap",
            }}>
              {p.name}
            </span>
            <span style={{ color: C.mutedFg, fontSize: 8, fontFamily: rajdhani, marginLeft: "auto" }}>
              {p.regions}r
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Mobile bottom bar ───────────────────────────────────────────────────────
const MobileBottomBar: React.FC = () => (
  <div style={{
    position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 10,
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 8, borderTop: `1px solid ${C.border}`, background: C.card,
    padding: "8px 12px",
  }}>
    <div style={{
      borderRadius: 9999, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.05)",
      padding: "6px 14px", fontSize: 10, color: "rgba(255,255,255,0.6)", fontFamily: barlow,
    }}>Wyjdz</div>
    <div style={{
      borderRadius: 9999, border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.1)",
      padding: "6px 14px", fontSize: 10, color: "#ef4444", fontFamily: barlow,
    }}>Opuść mecz</div>
  </div>
);

// ─── Overlay text on map ─────────────────────────────────────────────────────
const OverlayText: React.FC<{ text: string; sub?: string }> = ({ text, sub }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const scale = spring({ frame, fps, from: 1.3, to: 1, durationInFrames: 8, config: { damping: 8 } });
  const opacity = interpolate(frame, [0, 5, durationInFrames - 5, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  return (
    <div style={{
      position: "absolute", bottom: 80, left: 0, right: 0,
      textAlign: "center", opacity, transform: `scale(${scale})`,
      padding: "0 24px", zIndex: 5,
    }}>
      <h2 style={{
        fontFamily: rajdhani, fontSize: 48, fontWeight: 700,
        color: C.fg, letterSpacing: 2, margin: 0,
        ...textGlow(C.cyan),
      }}>{text}</h2>
      {sub && (
        <p style={{ fontFamily: barlow, fontSize: 18, color: C.mutedFg, letterSpacing: 2, margin: 0, marginTop: 6 }}>
          {sub}
        </p>
      )}
    </div>
  );
};

// ─── Game Scene (vertical) ───────────────────────────────────────────────────
interface VSceneProps {
  simTickStart: number;
  simTickEnd: number;
  cameraStart: { x: number; y: number; scale: number };
  cameraEnd: { x: number; y: number; scale: number };
  hudStatus?: string;
  showHUD?: boolean;
  showBottomBar?: boolean;
}

const VScene: React.FC<React.PropsWithChildren<VSceneProps>> = ({
  simTickStart, simTickEnd, cameraStart, cameraEnd,
  hudStatus = "W trakcie", showHUD = true, showBottomBar = false,
  children,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / Math.max(1, durationInFrames - 1);
  const simTick = Math.floor(simTickStart + (simTickEnd - simTickStart) * t);
  const sim = simulate(simTick);
  const camera = {
    x: cameraStart.x + (cameraEnd.x - cameraStart.x) * t,
    y: cameraStart.y + (cameraEnd.y - cameraStart.y) * t,
    scale: cameraStart.scale + (cameraEnd.scale - cameraStart.scale) * t,
  };

  const players = [
    { name: "Qwizi", color: PLAYER_COLORS[0], regions: sim.playerRegions[0], units: sim.playerUnits[0], isAlive: sim.playerAlive[0] },
    { name: "Wróg 1", color: PLAYER_COLORS[1], regions: sim.playerRegions[1], units: sim.playerUnits[1], isAlive: sim.playerAlive[1] },
    { name: "Wróg 2", color: PLAYER_COLORS[2], regions: sim.playerRegions[2], units: sim.playerUnits[2], isAlive: sim.playerAlive[2] },
    { name: "Wróg 3", color: PLAYER_COLORS[3], regions: sim.playerRegions[3], units: sim.playerUnits[3], isAlive: sim.playerAlive[3] },
  ];

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <GameMap simState={sim} camera={camera} viewerPlayer={0} showUnits={camera.scale > 0.6} showCapitals width={1080} height={1920} />
      {showHUD && (
        <MobileHUD tick={simTick} energy={sim.energy} regions={sim.playerRegions[0]}
          units={sim.playerUnits[0]} status={hudStatus} players={players} />
      )}
      {showBottomBar && <MobileBottomBar />}
      {children}
    </AbsoluteFill>
  );
};

// ─── Logo ────────────────────────────────────────────────────────────────────
const LogoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame: Math.max(0, frame - 2), fps, from: 1.8, to: 1, durationInFrames: 12, config: { damping: 7, mass: 0.4 } });
  const opacity = interpolate(frame, [0, 3], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [70, 90], [1, 0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: C.bg, opacity: fadeOut }}>
      <div style={{
        position: "absolute", top: "38%", left: "50%",
        transform: `translate(-50%,-50%) scale(${scale})`,
        opacity, textAlign: "center",
        display: "flex", flexDirection: "column", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            border: `1px solid ${C.border}`, background: "#1e293b",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
            </svg>
          </div>
          <h1 style={{ fontFamily: rajdhani, fontSize: 56, fontWeight: 700, color: C.fg, letterSpacing: 6, margin: 0, ...textGlow(C.cyan) }}>
            MAPLORD
          </h1>
        </div>
        <p style={{
          fontFamily: barlow, fontSize: 16, color: C.mutedFg, letterSpacing: 6, textTransform: "uppercase",
          margin: 0, marginTop: 12,
          opacity: interpolate(frame, [15, 30], [0, 1], { extrapolateRight: "clamp" }),
        }}>
          Strategia w czasie rzeczywistym
        </p>
      </div>
    </AbsoluteFill>
  );
};

// ─── CTA ─────────────────────────────────────────────────────────────────────
const CTAScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sim = simulate(500);
  const scale = spring({ frame, fps, from: 0.5, to: 1, durationInFrames: 15 });
  const opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  const pulse = 0.3 + Math.sin(frame * 0.15) * 0.2;

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <GameMap simState={sim} camera={VCAM_WORLD} viewerPlayer={0} showUnits={false} showCapitals={false} width={1080} height={1920} />
      <div style={{ position: "absolute", inset: 0, background: "rgba(2,6,23,0.55)" }} />
      <div style={{
        position: "absolute", top: "35%", left: "50%",
        transform: `translate(-50%,-50%) scale(${scale})`, opacity,
        textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            border: `1px solid ${C.border}`, background: "#1e293b",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
            </svg>
          </div>
          <h1 style={{ fontFamily: rajdhani, fontSize: 48, fontWeight: 700, color: C.fg, letterSpacing: 5, margin: 0, ...textGlow(C.cyan) }}>
            MAPLORD
          </h1>
        </div>
        <p style={{
          fontFamily: barlow, fontSize: 18, color: C.mutedFg, letterSpacing: 5, textTransform: "uppercase",
          margin: 0, marginTop: 12,
          opacity: interpolate(frame, [10, 20], [0, 1], { extrapolateRight: "clamp" }),
        }}>Podbij. Buduj. Rządź.</p>
        <div style={{ marginTop: 28, opacity: interpolate(frame, [20, 30], [0, 1], { extrapolateRight: "clamp" }) }}>
          <div style={{
            display: "inline-flex", background: `linear-gradient(135deg, ${C.cyan}, #0e7490)`,
            borderRadius: 10, padding: "10px 30px",
            border: `2px solid rgba(34,211,238,${pulse})`, boxShadow: "0 0 24px rgba(34,211,238,0.3)",
          }}>
            <span style={{ fontFamily: rajdhani, fontSize: 18, fontWeight: 700, color: C.bg, letterSpacing: 3, textTransform: "uppercase" }}>
              Zagraj teraz
            </span>
          </div>
        </div>
        <p style={{
          fontFamily: rajdhani, fontSize: 13, color: C.cyan, marginTop: 14, letterSpacing: 2,
          opacity: interpolate(frame, [30, 40], [0, 0.7], { extrapolateRight: "clamp" }),
        }}>maplord.qwizi.ovh</p>
      </div>
    </AbsoluteFill>
  );
};

// ─── Main TikTok Composition ─────────────────────────────────────────────────
export const TikTokTrailer: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {/* Music — start from 14s ("Maps on fire" verse) */}
      <Audio src={staticFile("assets/audio/music/trailer.mp3")} volume={0.95}
        startFrom={MUSIC_START_FRAME} />

      {/* 1. Logo (0-3s, music 14-17s) — "Maps on fire" beat at 14.2s */}
      <Sequence from={LOGO} durationInFrames={LOGO_DUR}>
        <LogoScene />
      </Sequence>

      {/* 2. Expansion (3-7s, music 17-21s) — "Names in smoke" */}
      <Sequence from={EXPAND} durationInFrames={EXPAND_DUR}>
        <VScene simTickStart={20} simTickEnd={150}
          cameraStart={VCAM_CLOSE} cameraEnd={VCAM_WORLD}>
          <OverlayText text="Mapy płoną" sub="Każdy ruch zostawia ślad" />
        </VScene>
      </Sequence>

      {/* 3. Action (7-10s, music 21-24s) — "Every oath / A loaded stroke" */}
      <Sequence from={ACTION} durationInFrames={ACTION_DUR}>
        <VScene simTickStart={150} simTickEnd={220}
          cameraStart={VCAM_AMERICAS} cameraEnd={VCAM_EUROPE}
          showBottomBar>
          <OverlayText text="Każda przysięga to ostrze" />
        </VScene>
      </Sequence>

      {/* 4. War (10-14s, music 24-28s) — build to chorus */}
      <Sequence from={WAR} durationInFrames={s(2)}>
        <VScene simTickStart={220} simTickEnd={260}
          cameraStart={VCAM_EUROPE} cameraEnd={VCAM_AFRICA}>
          <OverlayText text="Wybierz swoją wojnę" />
        </VScene>
      </Sequence>
      <Sequence from={WAR + s(2)} durationInFrames={s(2)}>
        <VScene simTickStart={260} simTickEnd={300}
          cameraStart={VCAM_AMERICAS} cameraEnd={VCAM_WORLD}>
          <OverlayText text="Walcz o koronę" />
        </VScene>
      </Sequence>

      {/* 5. Rise (14-17s, music 28-31s) — chorus "This is where empires RISE" */}
      <Sequence from={RISE} durationInFrames={RISE_DUR}>
        <VScene simTickStart={300} simTickEnd={400}
          cameraStart={VCAM_WORLD} cameraEnd={VCAM_AMERICAS}>
          <OverlayText text="Tu rodzą się imperia" />
        </VScene>
      </Sequence>

      {/* 6. Dominate (17-20s, music 31-34s) — "This is where empires FALL" */}
      <Sequence from={DOMINATE} durationInFrames={s(1.5)}>
        <VScene simTickStart={400} simTickEnd={460}
          cameraStart={VCAM_EUROPE} cameraEnd={VCAM_WORLD}>
          <OverlayText text="Tu upadają imperia" />
        </VScene>
      </Sequence>
      <Sequence from={DOMINATE + s(1.5)} durationInFrames={s(1.5)}>
        <VScene simTickStart={460} simTickEnd={500}
          cameraStart={VCAM_WORLD} cameraEnd={{ ...VCAM_WORLD, scale: 0.45 }}>
          <OverlayText text="Zdobądź koronę" />
        </VScene>
      </Sequence>

      {/* 7. CTA (20-22s, music 34-36s) — "Claim the crown" */}
      <Sequence from={CTA_T} durationInFrames={CTA_DUR}>
        <CTAScene />
      </Sequence>
    </AbsoluteFill>
  );
};
