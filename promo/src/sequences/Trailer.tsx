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
import { GameHUD } from "../components/GameHUD";
import { QuickActionPanel } from "../components/QuickActionPanel";
import { AbilityBar } from "../components/AbilityBar";
import { GameToast } from "../components/GameToast";
import { simulate } from "../simulation";
import { BeatEffects } from "../components/BeatEffects";

const { fontFamily: rajdhani } = loadFont();
const { fontFamily: barlow } = loadBarlow();

// ─── Scene durations matched to "Crown of Ashes" (95.3s) ─────────────────────
//
// Music structure:
//  0-2s   INTRO — short hit then silence
//  2-9s   QUIET — atmospheric build
//  9-14s  LOW — tension building
// 14-28s  MED/HIGH — verse 1 ("Maps on fire")
// 28-44s  HIGH — chorus ("empires rise/fall")
// 44-48s  DIP — brief pause
// 46-58s  PEAK — biggest drop
// 59-62s  MED — breathing room
// 63-76s  HIGH — verse 2 / bridge
// 77-87s  HIGH — build to finale
// 88-93s  PEAK — grand finale, loudest
// 93-95s  FADEOUT
//
const FPS = 30;
const s = (seconds: number) => Math.round(seconds * FPS);

// Beats at: 0.1, 5.3, 7.1, 14.2, 17.7, 21.2, 28.2, 45.9, 46-57(DROP), 63.4, 67, 70.6, 74.1, 77.6, 81.2, 88.2, 91.8, 93.1
// New narrative order:
// INTRO → MAP_REVEAL → SETUP → EXPAND → ACTION → STRATEGY → DIPLO → WAR → RISE → DOMINATE → CTA
//
const INTRO_DUR      = s(5);    // 0-5s    — logo PUNCH
const MAP_REVEAL_DUR = s(2.1);  // 5-7.1s  — map zooms out
const SETUP_DUR      = s(7);    // 7.1-14.2s — capitals appear
const EXPAND_DUR     = s(7);    // 14.2-21.2s — verse 1, expansion
const ACTION_DUR     = s(7);    // 21.2-28.2s — action panel close-up
const STRATEGY_DUR   = s(8);    // 28.2-36s — "Twoja strategia" chorus start
const DIPLO_DUR      = s(10);   // 36-46s  — diplomacy, pacts, wars
const WAR_DUR        = s(12);   // 46-58s  — DROP! war + combat
const RISE_DUR       = s(5);    // 58-63s  — "Imperium rośnie" red starts spreading
const DOMINATE_DUR   = s(14);   // 63-77s  — red takes over everything, enemies die
const BUILD_DUR      = s(11);   // 77-88s  — final domination, whole map red
const CTA_DUR        = s(7.3);  // 88-95.3s — grand finale

let offset = 0;
const INTRO       = offset;  offset += INTRO_DUR;
const MAP_REVEAL  = offset;  offset += MAP_REVEAL_DUR;
const SETUP       = offset;  offset += SETUP_DUR;
const EXPAND      = offset;  offset += EXPAND_DUR;
const ACTION      = offset;  offset += ACTION_DUR;
const STRATEGY    = offset;  offset += STRATEGY_DUR;
const DIPLO       = offset;  offset += DIPLO_DUR;
const WAR         = offset;  offset += WAR_DUR;
const RISE        = offset;  offset += RISE_DUR;
const DOMINATE    = offset;  offset += DOMINATE_DUR;
const BUILD       = offset;  offset += BUILD_DUR;
const CTA         = offset;  offset += CTA_DUR;
// Total: ~2860 frames = 95.3s

const textGlow = (color: string): React.CSSProperties => ({
  textShadow: `0 0 40px ${color}, 0 0 80px ${color}40`,
});

// ─── Camera presets ──────────────────────────────────────────────────────────

const CENTER = { x: TEX_W / 2, y: TEX_H / 2 };
// Cinematic camera positions — each named for the region it focuses on
const CAM_FULL     = { x: CENTER.x, y: CENTER.y, scale: 0.22 };
const CAM_AMERICAS = { x: CENTER.x - 1200, y: CENTER.y + 200, scale: 0.40 };
const CAM_EUROPE   = { x: CENTER.x + 400, y: CENTER.y - 400, scale: 0.42 };
const CAM_AFRICA   = { x: CENTER.x + 200, y: CENTER.y + 300, scale: 0.42 };
const CAM_ASIA     = { x: CENTER.x + 1200, y: CENTER.y - 200, scale: 0.38 };
const CAM_MID      = { x: CENTER.x - 400, y: CENTER.y - 100, scale: 0.35 };
const CAM_CLOSE    = { x: CENTER.x - 800, y: CENTER.y + 200, scale: 0.45 };
const CAM_RIGHT    = { x: CENTER.x + 600, y: CENTER.y - 100, scale: 0.32 };
const CAM_TIGHT    = { x: CENTER.x - 600, y: CENTER.y, scale: 0.55 }; // very close for detail
const CAM_ENDGAME  = { x: CENTER.x, y: CENTER.y, scale: 0.28 };

// ─── Intro ───────────────────────────────────────────────────────────────────

const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // PUNCH in on first beat — fast spring, aggressive damping
  const titleScale = spring({ frame: Math.max(0, frame - 2), fps, from: 1.5, to: 1, durationInFrames: 15, config: { damping: 8, mass: 0.4 } });
  const titleOpacity = interpolate(frame, [0, 3], [0, 1], { extrapolateRight: "clamp" });
  const subOpacity = interpolate(frame, [20, 35], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [120, 150], [1, 0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #020617, #0d1b2a, #0f172a)",
        opacity: fadeOut,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(-50%,-50%) scale(${titleScale})`,
          opacity: titleOpacity,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Logo — Globe icon + MAPLORD text, matching dashboard layout */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 20 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "#1e293b",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
              <path d="M2 12h20"/>
            </svg>
          </div>
          <h1
            style={{
              fontFamily: rajdhani,
              fontSize: 100,
              fontWeight: 700,
              color: "#f1f5f9",
              letterSpacing: 12,
              margin: 0,
              textTransform: "uppercase",
              ...textGlow("#22d3ee"),
            }}
          >
            MAPLORD
          </h1>
        </div>
        <p
          style={{
            fontFamily: barlow,
            fontSize: 28,
            color: "#94a3b8",
            letterSpacing: 14,
            textTransform: "uppercase",
            margin: 0,
            marginTop: 0,
            opacity: subOpacity,
          }}
        >
          Strategia w czasie rzeczywistym
        </p>
      </div>
    </AbsoluteFill>
  );
};

// ─── Game Scene ──────────────────────────────────────────────────────────────

interface GameSceneProps {
  simTickStart: number;
  simTickEnd: number;
  cameraStart: { x: number; y: number; scale: number };
  cameraEnd: { x: number; y: number; scale: number };
  overlayText?: string;
  overlaySubtext?: string;
  hudStatus?: string;
  capitalProtection?: number;
  showActionPanel?: boolean;
  actionPanelRegion?: string;
  actionPanelUnits?: number;
  showAbilityBar?: boolean;
  showWarToast?: boolean;
  warToastMessage?: string;
}

const GameScene: React.FC<GameSceneProps> = ({
  simTickStart,
  simTickEnd,
  cameraStart,
  cameraEnd,
  overlayText,
  overlaySubtext,
  hudStatus = "W trakcie",
  capitalProtection,
  showActionPanel,
  actionPanelRegion,
  actionPanelUnits,
  showAbilityBar,
  showWarToast,
  warToastMessage = "⚔ Wojna z Wróg 1!",
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = frame / Math.max(1, durationInFrames - 1);

  const simTick = Math.floor(simTickStart + (simTickEnd - simTickStart) * progress);
  const sim = simulate(simTick);

  const camera = {
    x: cameraStart.x + (cameraEnd.x - cameraStart.x) * progress,
    y: cameraStart.y + (cameraEnd.y - cameraStart.y) * progress,
    scale: cameraStart.scale + (cameraEnd.scale - cameraStart.scale) * progress,
  };

  const players = [
    {
      name: "Qwizi",
      color: PLAYER_COLORS[0],
      regions: sim.playerRegions[0],
      units: sim.playerUnits[0],
      isAlive: sim.playerAlive[0],
      relation: undefined as "war" | "nap" | "neutral" | undefined,
    },
    {
      name: "Wróg 1",
      color: PLAYER_COLORS[1],
      regions: sim.playerRegions[1],
      units: sim.playerUnits[1],
      isAlive: sim.playerAlive[1],
      relation: sim.wars.some(([a, b]) => (a === 0 && b === 1) || (a === 1 && b === 0))
        ? ("war" as const)
        : sim.pacts.some(([a, b]) => (a === 0 && b === 1) || (a === 1 && b === 0))
          ? ("nap" as const)
          : ("neutral" as const),
    },
    {
      name: "Wróg 2",
      color: PLAYER_COLORS[2],
      regions: sim.playerRegions[2],
      units: sim.playerUnits[2],
      isAlive: sim.playerAlive[2],
      relation: sim.pacts.some(([a, b]) => (a === 0 && b === 2) || (a === 2 && b === 0))
        ? ("nap" as const)
        : ("neutral" as const),
    },
    {
      name: "Wróg 3",
      color: PLAYER_COLORS[3],
      regions: sim.playerRegions[3],
      units: sim.playerUnits[3],
      isAlive: sim.playerAlive[3],
      relation: sim.wars.some(([a, b]) => (a === 0 && b === 3) || (a === 3 && b === 0))
        ? ("war" as const)
        : ("neutral" as const),
    },
  ];

  const overlayOpacity = overlayText
    ? interpolate(
        frame,
        [10, 25, durationInFrames - 15, durationInFrames],
        [0, 1, 1, 0],
        { extrapolateRight: "clamp", extrapolateLeft: "clamp" }
      )
    : 0;

  return (
    <AbsoluteFill style={{ background: "#020617" }}>
      <GameMap
        simState={sim}
        camera={camera}
        viewerPlayer={0}
        showUnits={camera.scale > 0.25}
        showCapitals
      />

      <GameHUD
        tick={simTick}
        status={hudStatus}
        players={players}
        viewerIndex={0}
        energy={sim.energy}
        regionCount={sim.playerRegions[0]}
        unitCount={sim.playerUnits[0]}
        capitalProtectionRemaining={
          capitalProtection ? Math.max(0, capitalProtection - simTick) : undefined
        }
        rajdhani={rajdhani}
        barlow={barlow}
      />

      {showAbilityBar && (
        <AbilityBar rajdhani={rajdhani} barlow={barlow} selectedIndex={0} />
      )}

      {showActionPanel && (
        <QuickActionPanel
          regionName={actionPanelRegion || "Prowincja"}
          unitCount={actionPanelUnits || sim.playerUnits[0]}
          playerColor={PLAYER_COLORS[0]}
          selectedPercent={50}
          rajdhani={rajdhani}
          barlow={barlow}
        />
      )}

      {showWarToast && (
        <GameToast
          message={warToastMessage}
          variant="war"
          showAt={20}
          hideAt={durationInFrames - 20}
          rajdhani={rajdhani}
          barlow={barlow}
        />
      )}

      {overlayText && (
        <div
          style={{
            position: "absolute",
            bottom: showActionPanel ? 310 : 100,
            left: "50%",
            transform: "translateX(-50%)",
            opacity: overlayOpacity,
            textAlign: "center",
          }}
        >
          <h2
            style={{
              fontFamily: rajdhani,
              fontSize: 48,
              fontWeight: 700,
              color: "#f1f5f9",
              letterSpacing: 2,
              margin: 0,
              ...textGlow("#22d3ee"),
            }}
          >
            {overlayText}
          </h2>
          {overlaySubtext && (
            <p
              style={{
                fontFamily: barlow,
                fontSize: 20,
                color: "#94a3b8",
                letterSpacing: 3,
                margin: 0,
                marginTop: 6,
              }}
            >
              {overlaySubtext}
            </p>
          )}
        </div>
      )}
    </AbsoluteFill>
  );
};

// ─── CTA ─────────────────────────────────────────────────────────────────────

const CTAScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sim = simulate(500); // 100% red map — total victory
  const titleScale = spring({ frame, fps, from: 0.5, to: 1, durationInFrames: 25 });
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
  const pulse = 0.3 + Math.sin(frame * 0.1) * 0.15;

  return (
    <AbsoluteFill style={{ background: "#020617" }}>
      <GameMap simState={sim} camera={CAM_FULL} viewerPlayer={0} showUnits={false} showCapitals={false} />
      <div style={{ position: "absolute", inset: 0, background: "rgba(2,6,23,0.6)" }} />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(-50%,-50%) scale(${titleScale})`,
          opacity,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Logo — Globe + MAPLORD */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "#1e293b",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
              <path d="M2 12h20"/>
            </svg>
          </div>
          <h1
            style={{
              fontFamily: rajdhani,
              fontSize: 80,
              fontWeight: 700,
              color: "#f1f5f9",
              letterSpacing: 10,
              margin: 0,
              ...textGlow("#22d3ee"),
            }}
          >
            MAPLORD
          </h1>
        </div>
        <p
          style={{
            fontFamily: barlow,
            fontSize: 28,
            color: "#94a3b8",
            letterSpacing: 10,
            textTransform: "uppercase",
            margin: 0,
            marginTop: 18,
            opacity: interpolate(frame, [25, 40], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          Podbij. Buduj. Rządź.
        </p>
        <div
          style={{
            marginTop: 44,
            opacity: interpolate(frame, [40, 55], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          <div
            style={{
              display: "inline-flex",
              background: "linear-gradient(135deg, #22d3ee, #0e7490)",
              borderRadius: 14,
              padding: "14px 44px",
              border: `2px solid rgba(34,211,238,${pulse})`,
              boxShadow: "0 0 36px rgba(34,211,238,0.3)",
            }}
          >
            <span
              style={{
                fontFamily: rajdhani,
                fontSize: 22,
                fontWeight: 700,
                color: "#020617",
                letterSpacing: 4,
                textTransform: "uppercase",
              }}
            >
              Zagraj teraz
            </span>
          </div>
        </div>
        <p
          style={{
            fontFamily: rajdhani,
            fontSize: 16,
            color: "#22d3ee",
            marginTop: 20,
            opacity: interpolate(frame, [55, 70], [0, 0.7], { extrapolateRight: "clamp" }),
            letterSpacing: 3,
          }}
        >
          maplord.qwizi.ovh
        </p>
      </div>
    </AbsoluteFill>
  );
};

// ─── Composition ─────────────────────────────────────────────────────────────

export const MapLordTrailer: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: "#020617" }}>
      {/* Music — full track */}
      <Audio src={staticFile("assets/audio/music/trailer.mp3")} volume={0.85} />

      {/* 1. INTRO (0-5s) — Logo PUNCHES in on first beat, subtitle fades in */}
      <Sequence from={INTRO} durationInFrames={INTRO_DUR}>
        <IntroScene />
      </Sequence>

      {/* 2. MAP REVEAL (5-7.1s) — map zooms out fast from tight close-up, beat at 5.3s */}
      <Sequence from={MAP_REVEAL} durationInFrames={MAP_REVEAL_DUR}>
        <GameScene
          simTickStart={0}
          simTickEnd={5}
          cameraStart={CAM_TIGHT}
          cameraEnd={CAM_FULL}
          hudStatus="Wybór stolicy"
          capitalProtection={300}
        />
      </Sequence>

      {/* 3. SETUP (7-14s) — "Maps on fire" verse intro */}
      <Sequence from={SETUP} durationInFrames={SETUP_DUR}>
        <GameScene simTickStart={5} simTickEnd={30}
          cameraStart={CAM_FULL} cameraEnd={CAM_AMERICAS}
          hudStatus="Wybór stolicy" capitalProtection={300}
          overlayText="Wybierz stolicę"
          overlaySubtext="Rozpocznij swoją historię" />
      </Sequence>

      {/* 4. EXPAND (14-21s) — "Maps on fire / Names in smoke" */}
      <Sequence from={EXPAND} durationInFrames={EXPAND_DUR}>
        <GameScene simTickStart={30} simTickEnd={120}
          cameraStart={CAM_EUROPE} cameraEnd={CAM_FULL}
          capitalProtection={300}
          overlayText="Mapy płoną"
          overlaySubtext="Każdy ruch zostawia ślad" />
      </Sequence>

      {/* 5. ACTION (21-28s) — "Every oath / A loaded stroke" — manage forces */}
      <Sequence from={ACTION} durationInFrames={ACTION_DUR}>
        <GameScene simTickStart={120} simTickEnd={160}
          cameraStart={CAM_CLOSE} cameraEnd={{ ...CAM_CLOSE, x: CAM_CLOSE.x + 150 }}
          showActionPanel showAbilityBar
          actionPanelRegion="Mexico City" actionPanelUnits={342}
          overlayText="Każda przysięga to ostrze" />
      </Sequence>

      {/* 6. STRATEGY (28-36s) — chorus: "This is where empires RISE" */}
      <Sequence from={STRATEGY} durationInFrames={STRATEGY_DUR}>
        <GameScene simTickStart={160} simTickEnd={200}
          cameraStart={CAM_FULL} cameraEnd={CAM_MID}
          overlayText="Tu rodzą się imperia"
          overlaySubtext="Atakuj · Buduj · Zawieraj sojusze" />
      </Sequence>

      {/* 7. DIPLO (36-46s) — "This is where empires FALL / Choose your war" */}
      <Sequence from={DIPLO} durationInFrames={s(3.3)}>
        <GameScene simTickStart={200} simTickEnd={220}
          cameraStart={CAM_MID} cameraEnd={CAM_EUROPE}
          overlayText="Tu upadają imperia" />
      </Sequence>
      <Sequence from={DIPLO + s(3.3)} durationInFrames={s(3.3)}>
        <GameScene simTickStart={220} simTickEnd={240}
          cameraStart={CAM_AFRICA} cameraEnd={CAM_AMERICAS}
          overlayText="Wybierz swoją wojnę" />
      </Sequence>
      <Sequence from={DIPLO + s(6.6)} durationInFrames={s(3.4)}>
        <GameScene simTickStart={240} simTickEnd={260}
          cameraStart={CAM_FULL} cameraEnd={CAM_RIGHT}
          overlaySubtext="Sojusze · Zdrada · Dyplomacja" />
      </Sequence>

      {/* 8. WAR (46-58s) — DROP! "Draw your line / Claim the crown" */}
      <Sequence from={WAR} durationInFrames={s(4)}>
        <GameScene simTickStart={260} simTickEnd={280}
          cameraStart={CAM_RIGHT} cameraEnd={CAM_MID}
          showWarToast warToastMessage="⚔ Wojna z Wróg 1!"
          overlayText="Wyznacz granicę" />
      </Sequence>
      <Sequence from={WAR + s(4)} durationInFrames={s(4)}>
        <GameScene simTickStart={270} simTickEnd={285}
          cameraStart={CAM_AMERICAS} cameraEnd={CAM_EUROPE}
          overlayText="Walcz o koronę"
          overlaySubtext="Piechota · Czołgi · Artyleria · Lotnictwo" />
      </Sequence>
      <Sequence from={WAR + s(8)} durationInFrames={s(4)}>
        <GameScene simTickStart={280} simTickEnd={300}
          cameraStart={CAM_AFRICA} cameraEnd={CAM_FULL}
          overlayText="Albo strać wszystko" />
      </Sequence>

      {/* 9. RISE (58-63s) — bridge, red starts spreading */}
      <Sequence from={RISE} durationInFrames={RISE_DUR}>
        <GameScene simTickStart={300} simTickEnd={340}
          cameraStart={CAM_FULL} cameraEnd={CAM_MID}
          overlayText="Imperium rośnie" />
      </Sequence>

      {/* 10. DOMINATE (63-77s) — verse 2, red takes over progressively */}
      <Sequence from={DOMINATE} durationInFrames={s(3.5)}>
        <GameScene simTickStart={340} simTickEnd={370}
          cameraStart={CAM_AMERICAS} cameraEnd={{ ...CAM_AMERICAS, scale: 0.38 }}
          overlayText="Nie ma odwrotu" />
      </Sequence>
      <Sequence from={DOMINATE + s(3.5)} durationInFrames={s(3.5)}>
        <GameScene simTickStart={370} simTickEnd={400}
          cameraStart={CAM_EUROPE} cameraEnd={CAM_RIGHT}
          overlayText="Wrogowie padają" />
      </Sequence>
      <Sequence from={DOMINATE + s(7)} durationInFrames={s(3.5)}>
        <GameScene simTickStart={400} simTickEnd={430}
          cameraStart={CAM_FULL} cameraEnd={CAM_AFRICA}
          overlayText="Każda decyzja ma znaczenie" />
      </Sequence>
      <Sequence from={DOMINATE + s(10.5)} durationInFrames={s(3.5)}>
        <GameScene simTickStart={430} simTickEnd={460}
          cameraStart={CAM_ASIA} cameraEnd={CAM_FULL}
          overlayText="Świat drży" />
      </Sequence>

      {/* 11. BUILD (77-88s) — "Claim the crown / Or lose it all" — final domination */}
      <Sequence from={BUILD} durationInFrames={s(3.5)}>
        <GameScene simTickStart={460} simTickEnd={480}
          cameraStart={CAM_FULL} cameraEnd={CAM_CLOSE}
          overlayText="Zdobądź koronę" />
      </Sequence>
      <Sequence from={BUILD + s(3.5)} durationInFrames={s(3.5)}>
        <GameScene simTickStart={480} simTickEnd={500}
          cameraStart={CAM_EUROPE} cameraEnd={CAM_RIGHT}
          overlayText="Albo strać wszystko" />
      </Sequence>
      <Sequence from={BUILD + s(7)} durationInFrames={s(4)}>
        <GameScene simTickStart={500} simTickEnd={520}
          cameraStart={CAM_FULL} cameraEnd={CAM_ENDGAME}
          overlayText="Podbij świat" />
      </Sequence>

      {/* 12. CTA (88-95.3s) — grand finale + fadeout, biggest beats */}
      <Sequence from={CTA} durationInFrames={CTA_DUR}>
        <CTAScene />
      </Sequence>

      {/* Beat-synced effects overlay — flashes, vignette, shake, letterbox */}
      <BeatEffects />
    </AbsoluteFill>
  );
};
