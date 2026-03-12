"use client";

import { useRef, useCallback, useEffect, useState } from "react";

export const MUSIC_TRACKS = [
  { src: "/assets/audio/music/maplord_marching_loop.ogg", name: "Marching" },
  { src: "/assets/audio/music/maplord_soviet_loop.ogg", name: "Soviet March" },
  { src: "/assets/audio/music/music.match.no_action.ogg", name: "No Action" },
  { src: "/assets/audio/music/maplord_lofi_loop.ogg", name: "Lofi" },
  { src: "/assets/audio/music/music.match.no_action_ac.ogg", name: "Acoustic" },
  { src: "/assets/audio/music/maplord_discorock.ogg", name: "Disco Rock" },
  { src: "/assets/audio/music/maplord_firstsong.ogg", name: "First Song" },
  { src: "/assets/audio/music/maplord_when_johny_home.ogg", name: "When Johnny Comes Home" },
];

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
} as const;

export type SoundKey = keyof typeof SOUNDS;

const LS_MUTED = "maplord:audio:muted";
const MAX_CONCURRENT_SOUNDS = 4;
const SOUND_COOLDOWN_MS = 80;

function readLS(): boolean {
  try {
    const val = localStorage.getItem(LS_MUTED);
    if (val === null) return true; // default: muted
    return val === "1";
  } catch {
    return true;
  }
}

export function useAudio() {
  const musicRef = useRef<HTMLAudioElement | null>(null);
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
    };
  }, []);

  return { startMusic, stopMusic, playSound, toggleMute, muted, currentTrackIndex, selectTrack };
}
