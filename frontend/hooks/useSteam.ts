"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type SteamAchievement,
  type SteamUser,
  getSteamAchievements,
  getSteamUser,
  isSteamRunning,
  isTauri,
  setSteamAchievement,
  setSteamRichPresence,
} from "@/lib/steam";

interface UseSteamResult {
  /** Whether app is running inside Tauri (desktop) */
  isDesktop: boolean;
  /** Whether Steam client is connected */
  steamConnected: boolean;
  /** Current Steam user info */
  user: SteamUser | null;
  /** List of achievements with status */
  achievements: SteamAchievement[];
  /** Unlock an achievement by ID */
  unlockAchievement: (id: string) => Promise<void>;
  /** Set Steam Rich Presence (shown in friends list) */
  setPresence: (key: string, value: string) => Promise<void>;
}

export function useSteam(): UseSteamResult {
  const [isDesktop] = useState(() => isTauri());
  const [steamConnected, setSteamConnected] = useState(false);
  const [user, setUser] = useState<SteamUser | null>(null);
  const [achievements, setAchievements] = useState<SteamAchievement[]>([]);

  useEffect(() => {
    if (!isDesktop) return;

    async function init() {
      const running = await isSteamRunning();
      setSteamConnected(running);
      if (running) {
        const [steamUser, steamAchievements] = await Promise.all([
          getSteamUser(),
          getSteamAchievements(),
        ]);
        setUser(steamUser);
        setAchievements(steamAchievements);
      }
    }

    init();
  }, [isDesktop]);

  const unlockAchievement = useCallback(
    async (id: string) => {
      if (!steamConnected) return;
      await setSteamAchievement(id);
      setAchievements((prev) =>
        prev.map((a) => (a.id === id ? { ...a, achieved: true } : a)),
      );
    },
    [steamConnected],
  );

  const setPresence = useCallback(
    async (key: string, value: string) => {
      if (!steamConnected) return;
      await setSteamRichPresence(key, value);
    },
    [steamConnected],
  );

  return {
    isDesktop,
    steamConnected,
    user,
    achievements,
    unlockAchievement,
    setPresence,
  };
}
