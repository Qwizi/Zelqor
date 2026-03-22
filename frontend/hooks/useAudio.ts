"use client";

import { useRef, useCallback, useEffect, useState } from "react";

// ── In-game music playlist ──────────────────────────────────────────────────
export const MUSIC_TRACKS = [
  { src: "/assets/audio/music/trailer.mp3", name: "Trailer Theme" },
];

// ── Menu background music ───────────────────────────────────────────────────
export const MENU_MUSIC_SRC = "/assets/audio/music/menu.mp3";

// ── One-shot jingles (victory, defeat, elimination) ─────────────────────────
export const JINGLES = {
  victory: "/assets/audio/music/jingle_victory.mp3",
  defeat: "/assets/audio/music/jingle_defeat.mp3",
  elimination: "/assets/audio/music/jingle_elimination.mp3",
} as const;

export type JingleKey = keyof typeof JINGLES;

export const SOUNDS = {
  click: "/assets/audio/gui/button_click_1.ogg",
  click2: "/assets/audio/gui/click2.ogg",
  tab: "/assets/audio/gui/tab_click.ogg",
  alert: "/assets/audio/gui/int_message_alert.ogg",
  popup: "/assets/audio/gui/int_popup.ogg",
  build: "/assets/audio/sounds/building.ogg",
  plane_start: "/assets/audio/sounds/plane_start.ogg",
  plane_detected: "/assets/audio/sounds/plane_detected.ogg",
  fail: "/assets/audio/sounds/fail.ogg",
  buzzer: "/assets/audio/sounds/buzzer.ogg",
  missile_explosion: "/assets/audio/sounds/missile_explosion.ogg",
  mine_explosion: "/assets/audio/sounds/mine-explosion.ogg",
  nuke: "/assets/audio/sounds/abilities/nuke.ogg",
  nuke_explosion: "/assets/audio/sounds/abilities/nuke_2.ogg",
  virus: "/assets/audio/sounds/abilities/virus.ogg",
  submarine: "/assets/audio/sounds/abilities/submarine.ogg",
  shield: "/assets/audio/sounds/abilities/shield.ogg",
  quick_gain: "/assets/audio/sounds/abilities/quick_gain.ogg",
} as const;

export type SoundKey = keyof typeof SOUNDS;

const LS_MUTED = "maplord:audio:muted";
const MAX_CONCURRENT_SOUNDS = 4;
const SOUND_COOLDOWN_MS = 80;

function readLS(): boolean {
  try {
    const val = localStorage.getItem(LS_MUTED);
    if (val === null) return false; // default: unmuted
    return val === "1";
  } catch {
    return true;
  }
}

export function useAudio() {
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const jingleRef = useRef<HTMLAudioElement | null>(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const trackIndexRef = useRef(0);
  const [muted, setMuted] = useState(() => readLS());
  const mutedRef = useRef(muted);
  const activeSoundsRef = useRef(0);
  const lastSoundTimeRef = useRef<Record<string, number>>({});

  useEffect(() => {
    mutedRef.current = muted;
    try { localStorage.setItem(LS_MUTED, muted ? "1" : "0"); } catch {}
    if (musicRef.current) musicRef.current.muted = muted;
    if (jingleRef.current) jingleRef.current.muted = muted;
  }, [muted]);

  const advanceTrack = useCallback(() => {
    const audio = musicRef.current;
    if (!audio || mutedRef.current) return;
    const nextIndex = (trackIndexRef.current + 1) % MUSIC_TRACKS.length;
    trackIndexRef.current = nextIndex;
    setCurrentTrackIndex(nextIndex);
    audio.src = MUSIC_TRACKS[nextIndex].src;
    audio.play().catch(() => {});
  }, []);

  const startMusic = useCallback(() => {
    if (musicRef.current) return;
    const shuffledIndex = Math.floor(Math.random() * MUSIC_TRACKS.length);
    trackIndexRef.current = shuffledIndex;
    setCurrentTrackIndex(shuffledIndex);
    const audio = new Audio(MUSIC_TRACKS[shuffledIndex].src);
    audio.volume = 0.10;
    audio.muted = mutedRef.current;
    audio.onended = advanceTrack;
    musicRef.current = audio;
    audio.play().catch(() => {});
  }, [advanceTrack]);

  const stopMusic = useCallback(() => {
    musicRef.current?.pause();
    musicRef.current = null;
  }, []);

  // ── Menu music (separate from in-game playlist) ─────────────────────────
  const menuPendingRef = useRef(false);
  const startMenuMusic = useCallback(() => {
    if (musicRef.current || menuPendingRef.current) return;
    menuPendingRef.current = true;
    const audio = new Audio(MENU_MUSIC_SRC);
    audio.volume = 0.08;
    audio.loop = true;
    audio.muted = mutedRef.current;
    audio.play().then(() => {
      musicRef.current = audio;
      menuPendingRef.current = false;
    }).catch(() => {
      menuPendingRef.current = false;
    });
  }, []);

  const stopMenuMusic = useCallback(() => {
    musicRef.current?.pause();
    musicRef.current = null;
  }, []);

  // ── Jingle playback (stops current music, plays once, optionally resumes) ──
  const playJingle = useCallback((key: JingleKey, { volume = 0.35, stopBgMusic = true } = {}) => {
    if (mutedRef.current) return;
    if (stopBgMusic && musicRef.current) {
      musicRef.current.pause();
    }
    jingleRef.current?.pause();
    const audio = new Audio(JINGLES[key]);
    audio.volume = volume;
    audio.muted = mutedRef.current;
    audio.onended = () => { jingleRef.current = null; };
    jingleRef.current = audio;
    audio.play().catch(() => {});
  }, []);

  const selectTrack = useCallback((index: number) => {
    if (index < 0 || index >= MUSIC_TRACKS.length) return;
    trackIndexRef.current = index;
    setCurrentTrackIndex(index);
    const audio = musicRef.current;
    if (audio) {
      audio.src = MUSIC_TRACKS[index].src;
      audio.play().catch(() => {});
    } else {
      const newAudio = new Audio(MUSIC_TRACKS[index].src);
      newAudio.volume = 0.10;
      newAudio.muted = mutedRef.current;
      newAudio.onended = advanceTrack;
      musicRef.current = newAudio;
      newAudio.play().catch(() => {});
    }
  }, [advanceTrack]);

  const playSound = useCallback((key: SoundKey) => {
    if (mutedRef.current) return;
    if (activeSoundsRef.current >= MAX_CONCURRENT_SOUNDS) return;
    const now = Date.now();
    const lastTime = lastSoundTimeRef.current[key] ?? 0;
    if (now - lastTime < SOUND_COOLDOWN_MS) return;
    lastSoundTimeRef.current[key] = now;
    activeSoundsRef.current++;
    const audio = new Audio(SOUNDS[key]);
    audio.volume = 0.55;
    const cleanup = () => { activeSoundsRef.current = Math.max(0, activeSoundsRef.current - 1); };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    audio.play().catch(cleanup);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
  }, []);

  useEffect(() => {
    return () => {
      musicRef.current?.pause();
      jingleRef.current?.pause();
    };
  }, []);

  return {
    startMusic, stopMusic,
    startMenuMusic, stopMenuMusic,
    playJingle,
    playSound, toggleMute, muted,
    currentTrackIndex, selectTrack,
  };
}
