"use client";

import { useRef, useCallback, useEffect, useState } from "react";

const MUSIC_TRACKS = [
  "/assets/audio/music/maplord_marching_loop.ogg",
  "/assets/audio/music/maplord_soviet_loop.ogg",
  "/assets/audio/music/music.match.no_action.ogg",
  "/assets/audio/music/maplord_lofi_loop.ogg",
  "/assets/audio/music/music.match.no_action_ac.ogg",
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

function readLS(): boolean {
  try {
    return localStorage.getItem(LS_MUTED) === "1";
  } catch {
    return false;
  }
}

export function useAudio() {
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const trackIndexRef = useRef(0);
  const [muted, setMuted] = useState(() => readLS());
  const mutedRef = useRef(muted);

  useEffect(() => {
    mutedRef.current = muted;
    try { localStorage.setItem(LS_MUTED, muted ? "1" : "0"); } catch {}
    if (musicRef.current) musicRef.current.muted = muted;
  }, [muted]);

  const advanceTrack = useCallback(() => {
    const audio = musicRef.current;
    if (!audio || mutedRef.current) return;
    trackIndexRef.current = (trackIndexRef.current + 1) % MUSIC_TRACKS.length;
    audio.src = MUSIC_TRACKS[trackIndexRef.current];
    audio.play().catch(() => {});
  }, []);

  const startMusic = useCallback(() => {
    if (musicRef.current) return;
    const audio = new Audio(MUSIC_TRACKS[0]);
    audio.volume = 0.25;
    audio.muted = mutedRef.current;
    audio.onended = advanceTrack;
    musicRef.current = audio;
    audio.play().catch(() => {});
  }, [advanceTrack]);

  const stopMusic = useCallback(() => {
    musicRef.current?.pause();
    musicRef.current = null;
  }, []);

  const playSound = useCallback((key: SoundKey) => {
    if (mutedRef.current) return;
    const audio = new Audio(SOUNDS[key]);
    audio.volume = 0.55;
    audio.play().catch(() => {});
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
  }, []);

  useEffect(() => {
    return () => {
      musicRef.current?.pause();
    };
  }, []);

  return { startMusic, stopMusic, playSound, toggleMute, muted };
}
